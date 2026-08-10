(() => {
    ///////////////////////////////
    // Frontend detection
    ///////////////////////////////

    const host = location.hostname;

    const isSupportedFrontend =
        /(?:youtube\.com|youtube-nocookie\.com)$/i.test(host) ||
        /(?:invidio\.us|invidious)/i.test(host) ||
        /piped/i.test(host) ||
        location.pathname.startsWith("/embed/");

    if (!isSupportedFrontend) return;

    ///////////////////////////////
    // Types
    ///////////////////////////////

    type UnknownObject = Record<string, unknown>;

    ///////////////////////////////
    // Ad response fields
    ///////////////////////////////

    const AD_FIELDS: Readonly<Record<string, unknown>> = {
        adPlacements: [],
        playerAds: [],
        adBreakHeartbeatParams: null,
        adSlots: []
    };

    ///////////////////////////////
    // Helpers
    ///////////////////////////////

    function isObject(value: unknown): value is UnknownObject {
        return (
            typeof value === "object" &&
            value !== null
        );
    }

    function rewriteAds(
        value: unknown,
        seen = new WeakSet<object>()
    ): void {
        if (!isObject(value)) return;

        if (seen.has(value)) return;
        seen.add(value);

        for (const key of Object.keys(value)) {
            if (key in AD_FIELDS) {
                value[key] = AD_FIELDS[key];
                continue;
            }

            const child = value[key];

            if (isObject(child)) {
                rewriteAds(child, seen);
            }
        }
    }

    function isJsonResponse(response: Response): boolean {
        const contentType =
            response.headers.get("content-type") ?? "";

        return contentType
            .toLowerCase()
            .includes("application/json");
    }

    ///////////////////////////////
    // Fetch interception
    ///////////////////////////////

    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> => {
        const response = await nativeFetch(input, init);

        if (!isJsonResponse(response)) {
            return response;
        }

        try {
            const data: unknown = await response.clone().json();

            rewriteAds(data);

            const headers = new Headers(response.headers);

            /*
             * The original response body has already been consumed
             * by the clone. Return a replacement response containing
             * the rewritten JSON while preserving normal metadata.
             */
            return new Response(JSON.stringify(data), {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        } catch {
            return response;
        }
    };

    ///////////////////////////////
    // JSON.parse interception
    ///////////////////////////////

    const nativeJSONParse = JSON.parse.bind(JSON);

    JSON.parse = (
        text: string,
        reviver?: (
            this: unknown,
            key: string,
            value: unknown
        ) => unknown
    ): unknown => {
        const parsed = nativeJSONParse(text, reviver);

        rewriteAds(parsed);

        return parsed;
    };

    ///////////////////////////////
    // Tracking parameter cleanup
    ///////////////////////////////

    const TRACKING_PARAMS = new Set([
        "si",
        "feature",
        "pp"
    ]);

    function cleanCurrentURL(): void {
        const url = new URL(location.href);
        let changed = false;

        for (const key of [...url.searchParams.keys()]) {
            if (
                key.toLowerCase().startsWith("utm_") ||
                TRACKING_PARAMS.has(key)
            ) {
                url.searchParams.delete(key);
                changed = true;
            }
        }

        if (!changed) return;

        history.replaceState(
            history.state,
            "",
            url.toString()
        );
    }

    cleanCurrentURL();

    ///////////////////////////////
    // Cosmetic filters
    ///////////////////////////////

    const COSMETIC_SELECTORS = [
        ".ytp-ad-overlay-container",
        ".ytp-ad-module",
        ".ytd-display-ad-renderer",
        ".ytd-promoted-video-renderer",
        ".video-ads",
        ".ytp-ad-player-overlay",
        ".ytp-ad-text-overlay",
        ".ytp-ad-overlay-slot",
        "[class*='promoted']",
        "[class*='ad-container']",
        ".sponsor",
        ".promoted"
    ];

    function installStyle(
        id: string,
        selectors: readonly string[]
    ): void {
        if (document.getElementById(id)) return;

        const style = document.createElement("style");

        style.id = id;
        style.textContent = selectors
            .map((selector) => {
                return `${selector}{display:none!important}`;
            })
            .join("\n");

        document.head.appendChild(style);
    }

    installStyle(
        "krynet-ad-filters",
        COSMETIC_SELECTORS
    );

    ///////////////////////////////
    // Ad state detection
    ///////////////////////////////

    function isVideoShowingAd(): boolean {
        return Boolean(
            document.querySelector(".ad-showing") ||
            document.querySelector(".ytp-ad-player-overlay") ||
            document.querySelector(".video-ads")
        );
    }

    function findVideo(): HTMLVideoElement | null {
        return document.querySelector("video");
    }

    ///////////////////////////////
    // Skip button
    ///////////////////////////////

    function clickSkipButton(): boolean {
        const button = document.querySelector<HTMLButtonElement>(
            [
                ".ytp-ad-skip-button",
                ".ytp-skip-ad-button",
                ".ytp-ad-skip-button-modern"
            ].join(",")
        );

        if (!button) return false;

        if (button.disabled) return false;

        button.click();

        return true;
    }

    ///////////////////////////////
    // Auto skip
    ///////////////////////////////

    function skipCurrentAd(): void {
        const video = findVideo();

        if (!video) return;

        if (clickSkipButton()) return;

        if (!isVideoShowingAd()) return;

        if (
            Number.isFinite(video.duration) &&
            video.duration > 0
        ) {
            try {
                video.currentTime = video.duration;
            } catch {
                // Video may have changed underneath us.
            }
        }
    }

    ///////////////////////////////
    // Mutation observer
    ///////////////////////////////

    let skipScheduled = false;

    function scheduleSkip(): void {
        if (skipScheduled) return;

        skipScheduled = true;

        queueMicrotask(() => {
            skipScheduled = false;
            skipCurrentAd();
        });
    }

    const observer = new MutationObserver(scheduleSkip);

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            "class",
            "style"
        ]
    });

    ///////////////////////////////
    // Video events
    ///////////////////////////////

    document.addEventListener(
        "play",
        scheduleSkip,
        true
    );

    document.addEventListener(
        "loadedmetadata",
        scheduleSkip,
        true
    );

    ///////////////////////////////
    // Embedded players
    ///////////////////////////////

    function patchEmbed(iframe: HTMLIFrameElement): void {
        const src = iframe.src;

        if (!src) return;

        try {
            const url = new URL(src);

            const host = url.hostname.toLowerCase();

            const supported =
                host.includes("youtube") ||
                host.includes("piped") ||
                host.includes("invidious");

            if (!supported) return;

            let changed = false;

            const params: Record<string, string> = {
                autoplay: "1",
                modestbranding: "1",
                rel: "0"
            };

            for (const [key, value] of Object.entries(params)) {
                if (url.searchParams.get(key) !== value) {
                    url.searchParams.set(key, value);
                    changed = true;
                }
            }

            if (changed) {
                iframe.src = url.toString();
            }
        } catch {
            // Invalid iframe URL.
        }
    }

    function scanEmbeds(root: ParentNode = document): void {
        for (const iframe of root.querySelectorAll<HTMLIFrameElement>(
            "iframe"
        )) {
            patchEmbed(iframe);
        }
    }

    scanEmbeds();

    const embedObserver = new MutationObserver(() => {
        scanEmbeds();
    });

    embedObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    ///////////////////////////////
    // Initial skip
    ///////////////////////////////

    skipCurrentAd();

    ///////////////////////////////
    // Periodic fallback
    ///////////////////////////////

    const skipTimer = window.setInterval(
        skipCurrentAd,
        500
    );

    ///////////////////////////////
    // Public cleanup
    ///////////////////////////////

    function destroy(): void {
        observer.disconnect();
        embedObserver.disconnect();

        document.removeEventListener(
            "play",
            scheduleSkip,
            true
        );

        document.removeEventListener(
            "loadedmetadata",
            scheduleSkip,
            true
        );

        window.clearInterval(skipTimer);

        window.fetch = nativeFetch;
        JSON.parse = nativeJSONParse;
    }

    ///////////////////////////////
    // Global API
    ///////////////////////////////

    declare global {
        interface Window {
            KrynetAdBlock?: {
                destroy: () => void;
                skip: () => void;
            };
        }
    }

    window.KrynetAdBlock = {
        destroy,
        skip: skipCurrentAd
    };

    console.log("[Krynet] Ad handling initialized");
})();
