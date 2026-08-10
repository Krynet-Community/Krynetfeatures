(() => {
    "use strict";

    const API = "https://sponsor.ajay.app/api";

    const CONFIG = {
        service: "Spotify",
        embedSelector: ".krynet-embed, .embed, [data-embed]",
        requestTimeout: 10_000,
        scanDelay: 100,
        seekCooldown: 500,
        maxCacheEntries: 100
    } as const;

    /* ---------------------------------------------------------
       TYPES
    --------------------------------------------------------- */

    type Segment = {
        start: number;
        end: number;
        category: string;
    };

    type RawSegment = {
        segment?: [number, number];
        category?: string;
    };

    type PlayerState = {
        audio: HTMLMediaElement;
        segments: Segment[];
        lastSegment: Segment | null;
        lastSeek: number;
        onTimeUpdate: () => void;
        onReset: () => void;
    };

    type ProtectedEmbed = HTMLElement & {
        __sponsorBlockState?: PlayerState;
        __sponsorBlockProcessing?: boolean;
    };

    /* ---------------------------------------------------------
       STATE
    --------------------------------------------------------- */

    const segmentCache = new Map<string, Segment[]>();
    const pendingRequests = new Map<string, Promise<Segment[]>>();

    let scanTimer: ReturnType<typeof setTimeout> | null = null;

    /* ---------------------------------------------------------
       SPOTIFY ID
    --------------------------------------------------------- */

    function getSpotifyID(embed: Element): string | null {
        const explicitID = embed.getAttribute(
            "data-spotify-episode-id"
        );

        if (explicitID) {
            return explicitID;
        }

        const iframe = embed.querySelector<HTMLIFrameElement>(
            "iframe"
        );

        if (!iframe?.src) {
            return null;
        }

        try {
            const url = new URL(iframe.src);

            const match = url.pathname.match(
                /(?:embed\/)?episode\/([a-zA-Z0-9]+)/
            );

            return match?.[1] ?? null;
        } catch {
            return null;
        }
    }

    /* ---------------------------------------------------------
       MEDIA
    --------------------------------------------------------- */

    function getMedia(
        embed: Element
    ): HTMLMediaElement | null {
        return embed.querySelector<HTMLMediaElement>(
            "audio, video"
        );
    }

    /* ---------------------------------------------------------
       FETCH
    --------------------------------------------------------- */

    async function fetchJSON<T>(
        url: string | URL,
        options: RequestInit = {}
    ): Promise<T> {
        const controller = new AbortController();

        const timeout = setTimeout(
            () => controller.abort(),
            CONFIG.requestTimeout
        );

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            return await response.json() as T;
        } finally {
            clearTimeout(timeout);
        }
    }

    /* ---------------------------------------------------------
       SEGMENT NORMALIZATION
    --------------------------------------------------------- */

    function normalizeSegments(
        data: RawSegment[]
    ): Segment[] {
        if (!Array.isArray(data)) {
            return [];
        }

        return data
            .filter(item => {
                const segment = item.segment;

                if (!segment) {
                    return false;
                }

                const [start, end] = segment;

                return (
                    Number.isFinite(start) &&
                    Number.isFinite(end) &&
                    start >= 0 &&
                    end > start
                );
            })
            .map(item => ({
                start: item.segment![0],
                end: item.segment![1],
                category: item.category ?? "unknown"
            }))
            .sort((a, b) => a.start - b.start);
    }

    /* ---------------------------------------------------------
       CACHE
    --------------------------------------------------------- */

    function trimCache(): void {
        while (
            segmentCache.size >
            CONFIG.maxCacheEntries
        ) {
            const oldest =
                segmentCache.keys().next().value;

            if (oldest === undefined) {
                return;
            }

            segmentCache.delete(oldest);
        }
    }

    /* ---------------------------------------------------------
       GET SEGMENTS
    --------------------------------------------------------- */

    async function getSegments(
        id: string
    ): Promise<Segment[]> {
        const cached = segmentCache.get(id);

        if (cached) {
            return cached;
        }

        const pending = pendingRequests.get(id);

        if (pending) {
            return pending;
        }

        const request = (async () => {
            try {
                const url = new URL(
                    `${API}/skipSegments`
                );

                url.searchParams.set(
                    "videoID",
                    id
                );

                url.searchParams.set(
                    "service",
                    CONFIG.service
                );

                const data =
                    await fetchJSON<RawSegment[]>(
                        url
                    );

                const segments =
                    normalizeSegments(data);

                segmentCache.set(id, segments);

                trimCache();

                return segments;
            } catch (error) {
                console.warn(
                    "[SponsorBlock] Failed to fetch segments:",
                    error
                );

                return [];
            }
        })();

        pendingRequests.set(id, request);

        try {
            return await request;
        } finally {
            pendingRequests.delete(id);
        }
    }

    /* ---------------------------------------------------------
       SEGMENT LOOKUP
    --------------------------------------------------------- */

    function findSegment(
        segments: Segment[],
        time: number
    ): Segment | null {
        let low = 0;
        let high = segments.length - 1;

        while (low <= high) {
            const middle =
                (low + high) >> 1;

            const segment = segments[middle];

            if (time < segment.start) {
                high = middle - 1;
                continue;
            }

            if (time >= segment.end) {
                low = middle + 1;
                continue;
            }

            return segment;
        }

        return null;
    }

    /* ---------------------------------------------------------
       SKIPPING
    --------------------------------------------------------- */

    function skipCurrentSegment(
        state: PlayerState
    ): void {
        const {
            audio,
            segments
        } = state;

        if (!segments.length) {
            return;
        }

        const now = performance.now();

        if (
            now - state.lastSeek <
            CONFIG.seekCooldown
        ) {
            return;
        }

        const segment = findSegment(
            segments,
            audio.currentTime
        );

        if (!segment) {
            state.lastSegment = null;
            return;
        }

        if (
            state.lastSegment === segment
        ) {
            return;
        }

        state.lastSegment = segment;
        state.lastSeek = now;

        try {
            audio.currentTime = segment.end;
        } catch {
            // Player may have been destroyed.
        }
    }

    /* ---------------------------------------------------------
       CLEANUP
    --------------------------------------------------------- */

    function cleanup(
        embed: ProtectedEmbed
    ): void {
        const state =
            embed.__sponsorBlockState;

        if (!state) {
            return;
        }

        state.audio.removeEventListener(
            "timeupdate",
            state.onTimeUpdate
        );

        state.audio.removeEventListener(
            "loadedmetadata",
            state.onReset
        );

        state.audio.removeEventListener(
            "seeking",
            state.onReset
        );

        delete embed.__sponsorBlockState;
        delete embed.__sponsorBlockProcessing;
    }

    /* ---------------------------------------------------------
       MARK UI
    --------------------------------------------------------- */

    function addMarkUI(
        embed: ProtectedEmbed,
        audio: HTMLMediaElement,
        id: string
    ): void {
        if (
            embed.querySelector(
                "[data-sponsor-mark]"
            )
        ) {
            return;
        }

        const button =
            document.createElement("button");

        button.type = "button";
        button.dataset.sponsorMark = "true";
        button.textContent = "Mark Sponsor";

        Object.assign(button.style, {
            position: "absolute",
            bottom: "10px",
            right: "10px",
            zIndex: "9999",
            padding: "7px 10px",
            background: "#1DB954",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "12px",
            fontFamily: "inherit"
        });

        let markStart: number | null = null;
        let submitting = false;

        button.addEventListener(
            "click",
            async () => {
                if (submitting) {
                    return;
                }

                const currentTime =
                    audio.currentTime;

                if (markStart === null) {
                    markStart = currentTime;
                    button.textContent = "Mark End";
                    return;
                }

                const start = markStart;
                const end = currentTime;

                markStart = null;

                if (end <= start) {
                    button.textContent =
                        "Invalid Segment";

                    setTimeout(() => {
                        if (button.isConnected) {
                            button.textContent =
                                "Mark Sponsor";
                        }
                    }, 1500);

                    return;
                }

                submitting = true;
                button.disabled = true;
                button.textContent = "Submitting...";

                try {
                    await fetchJSON<{
                        success?: boolean;
                        error?: string;
                    }>(
                        `${API}/submitSegment`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json",
                                "Accept":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                videoID: id,
                                segment: [
                                    start,
                                    end
                                ],
                                category: "sponsor",
                                service:
                                    CONFIG.service
                            })
                        }
                    );

                    button.textContent =
                        "Submitted ✓";
                } catch (error) {
                    console.warn(
                        "[SponsorBlock] Submission failed:",
                        error
                    );

                    button.textContent =
                        "Submit Failed";
                } finally {
                    submitting = false;

                    setTimeout(() => {
                        if (!button.isConnected) {
                            return;
                        }

                        button.disabled = false;
                        button.textContent =
                            "Mark Sponsor";
                    }, 1500);
                }
            }
        );

        if (
            getComputedStyle(embed).position ===
            "static"
        ) {
            embed.style.position = "relative";
        }

        embed.appendChild(button);
    }

    /* ---------------------------------------------------------
       ATTACH SPONSORBLOCK
    --------------------------------------------------------- */

    async function attachSponsorBlock(
        embed: ProtectedEmbed,
        audio: HTMLMediaElement,
        id: string
    ): Promise<void> {
        if (
            embed.__sponsorBlockState ||
            embed.__sponsorBlockProcessing
        ) {
            return;
        }

        // Set before awaiting anything so the observer
        // cannot initialize the same embed twice.
        embed.__sponsorBlockProcessing = true;

        const state: PlayerState = {
            audio,
            segments: [],
            lastSegment: null,
            lastSeek: 0,

            onTimeUpdate: () => {
                skipCurrentSegment(state);
            },

            onReset: () => {
                state.lastSegment = null;
            }
        };

        embed.__sponsorBlockState = state;

        try {
            state.segments =
                await getSegments(id);

            if (
                !embed.isConnected ||
                !audio.isConnected
            ) {
                cleanup(embed);
                return;
            }

            if (!state.segments.length) {
                return;
            }

            audio.addEventListener(
                "timeupdate",
                state.onTimeUpdate
            );

            audio.addEventListener(
                "loadedmetadata",
                state.onReset
            );

            audio.addEventListener(
                "seeking",
                state.onReset
            );
        } catch (error) {
            cleanup(embed);

            console.warn(
                "[SponsorBlock] Failed to attach:",
                error
            );
        }
    }

    /* ---------------------------------------------------------
       PROCESS EMBED
    --------------------------------------------------------- */

    function processEmbed(
        embed: ProtectedEmbed
    ): void {
        if (
            embed.__sponsorBlockProcessing ||
            embed.__sponsorBlockState
        ) {
            return;
        }

        const id = getSpotifyID(embed);

        if (!id) {
            return;
        }

        const audio = getMedia(embed);

        if (!audio) {
            return;
        }

        void attachSponsorBlock(
            embed,
            audio,
            id
        );

        addMarkUI(
            embed,
            audio,
            id
        );
    }

    /* ---------------------------------------------------------
       SCAN
    --------------------------------------------------------- */

    function scan(
        root: ParentNode = document
    ): void {
        const embeds: ProtectedEmbed[] = [];

        if (
            root instanceof Element &&
            root.matches(CONFIG.embedSelector)
        ) {
            embeds.push(
                root as ProtectedEmbed
            );
        }

        root
            .querySelectorAll<HTMLElement>(
                CONFIG.embedSelector
            )
            .forEach(element => {
                embeds.push(
                    element as ProtectedEmbed
                );
            });

        for (const embed of embeds) {
            processEmbed(embed);
        }
    }

    /* ---------------------------------------------------------
       DEBOUNCED SCAN
    --------------------------------------------------------- */

    function scheduleScan(): void {
        if (scanTimer !== null) {
            return;
        }

        scanTimer = setTimeout(() => {
            scanTimer = null;
            scan();
        }, CONFIG.scanDelay);
    }

    /* ---------------------------------------------------------
       DOM OBSERVER
    --------------------------------------------------------- */

    const observer =
        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (
                    mutation.addedNodes.length
                ) {
                    scheduleScan();
                    return;
                }
            }
        });

    /* ---------------------------------------------------------
       REMOVAL CLEANUP
    --------------------------------------------------------- */

    const removalObserver =
        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.removedNodes) {
                    if (
                        !(node instanceof Element)
                    ) {
                        continue;
                    }

                    if (
                        node.matches(
                            CONFIG.embedSelector
                        )
                    ) {
                        cleanup(
                            node as ProtectedEmbed
                        );
                    }

                    node
                        .querySelectorAll<HTMLElement>(
                            CONFIG.embedSelector
                        )
                        .forEach(element => {
                            cleanup(
                                element as ProtectedEmbed
                            );
                        });
                }
            }
        });

    /* ---------------------------------------------------------
       INITIALIZE
    --------------------------------------------------------- */

    function initialize(): void {
        scan();

        if (!document.body) {
            return;
        }

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        removalObserver.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        console.log(
            "[SponsorBlock] Spotify integration loaded."
        );
    }

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();
