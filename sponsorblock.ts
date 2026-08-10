///////////////////////////////
// Types
///////////////////////////////

type SponsorSegment = {
    category: string;
    segment: [number, number];
};

type AttachedVideo = {
    video: HTMLVideoElement;
    videoId: string;
    segments: SponsorSegment[];
    raf: number;
};

///////////////////////////////
// Constants
///////////////////////////////

const API_URL =
    "https://sponsor.ajay.app/api/skipSegments";

const SKIP_CATEGORIES = new Set([
    "sponsor",
    "selfpromo",
    "interaction"
]);

const VIDEO_ID_LENGTH = 11;

///////////////////////////////
// State
///////////////////////////////

const segmentCache =
    new Map<string, SponsorSegment[]>();

const loadingIds =
    new Map<string, Promise<SponsorSegment[]>>();

const attachedVideos =
    new WeakMap<HTMLVideoElement, AttachedVideo>();

let observer: MutationObserver | null = null;

///////////////////////////////
// Sponsor segments
///////////////////////////////

async function getSegments(
    videoId: string
): Promise<SponsorSegment[]> {
    const cached =
        segmentCache.get(videoId);

    if (cached) {
        return cached;
    }

    const loading =
        loadingIds.get(videoId);

    if (loading) {
        return loading;
    }

    const request =
        fetch(
            `${API_URL}?videoID=${encodeURIComponent(
                videoId
            )}`
        )
            .then(async response => {
                if (!response.ok) {
                    return [];
                }

                const data =
                    (await response.json()) as unknown;

                if (!Array.isArray(data)) {
                    return [];
                }

                const segments =
                    data
                        .filter(isValidSegment)
                        .filter(segment =>
                            SKIP_CATEGORIES.has(
                                segment.category
                            )
                        )
                        .map(normalizeSegment)
                        .filter(Boolean)
                        .sort(
                            (a, b) =>
                                a.segment[0] -
                                b.segment[0]
                        );

                segmentCache.set(
                    videoId,
                    segments
                );

                return segments;
            })
            .catch(() => [])
            .finally(() => {
                loadingIds.delete(videoId);
            });

    loadingIds.set(videoId, request);

    return request;
}

function isValidSegment(
    value: unknown
): value is SponsorSegment {
    if (
        !value ||
        typeof value !== "object"
    ) {
        return false;
    }

    const segment =
        value as Partial<SponsorSegment>;

    return (
        typeof segment.category === "string" &&
        Array.isArray(segment.segment) &&
        segment.segment.length === 2 &&
        typeof segment.segment[0] === "number" &&
        typeof segment.segment[1] === "number"
    );
}

function normalizeSegment(
    segment: SponsorSegment
): SponsorSegment | null {
    const start =
        Math.max(0, segment.segment[0]);

    const end =
        Math.max(0, segment.segment[1]);

    if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
    ) {
        return null;
    }

    return {
        category: segment.category,
        segment: [start, end]
    };
}

///////////////////////////////
// YouTube ID
///////////////////////////////

function isVideoId(
    value: string | null
): value is string {
    return (
        value !== null &&
        /^[a-zA-Z0-9_-]{11}$/.test(value)
    );
}

function extractVideoId(
    source: string
): string | null {
    try {
        const url =
            new URL(source);

        const host =
            url.hostname.toLowerCase();

        ///////////////////////////////
        // youtu.be/VIDEO_ID
        ///////////////////////////////

        if (
            host === "youtu.be"
        ) {
            const id =
                url.pathname
                    .split("/")
                    .filter(Boolean)[0] ?? null;

            return isVideoId(id)
                ? id
                : null;
        }

        ///////////////////////////////
        // YouTube / Invidious / Piped
        ///////////////////////////////

        const queryId =
            url.searchParams.get("v");

        if (isVideoId(queryId)) {
            return queryId;
        }

        const parts =
            url.pathname
                .split("/")
                .filter(Boolean);

        const prefixes = [
            "embed",
            "shorts",
            "live"
        ];

        for (const prefix of prefixes) {
            const index =
                parts.indexOf(prefix);

            if (index === -1) {
                continue;
            }

            const id =
                parts[index + 1] ?? null;

            if (isVideoId(id)) {
                return id;
            }
        }

        /*
         * Piped/Invidious instances can use
         * slightly different paths. Look for
         * an obvious 11-character ID rather than
         * assuming the whole URL structure.
         */
        for (const part of parts) {
            if (isVideoId(part)) {
                return part;
            }
        }
    } catch {
        return null;
    }

    return null;
}

///////////////////////////////
// Find video ID
///////////////////////////////

function getVideoId(
    video: HTMLVideoElement
): string | null {
    /*
     * Explicit data attribute wins.
     */
    const dataId =
        video.dataset.youtubeId;

    if (isVideoId(dataId ?? null)) {
        return dataId!;
    }

    /*
     * Some players expose their source
     * directly on the video element.
     */
    const sourceId =
        extractVideoId(
            video.currentSrc ||
            video.src
        );

    if (sourceId) {
        return sourceId;
    }

    /*
     * Finally inspect the closest iframe.
     */
    const iframe =
        video.closest("iframe");

    if (iframe) {
        return extractVideoId(
            iframe.src
        );
    }

    /*
     * Do not use window.location.href here.
     * A random video on a YouTube page should
     * not automatically inherit the page ID.
     */
    return null;
}

///////////////////////////////
// Skip controller
///////////////////////////////

function startSkipping(
    video: HTMLVideoElement,
    videoId: string,
    segments: SponsorSegment[]
): void {
    if (
        attachedVideos.has(video) ||
        !segments.length
    ) {
        return;
    }

    let lastSkippedEnd = -1;

    const state: AttachedVideo = {
        video,
        videoId,
        segments,
        raf: 0
    };

    const tick = (): void => {
        if (
            video.paused ||
            video.ended
        ) {
            state.raf =
                requestAnimationFrame(tick);

            return;
        }

        const time =
            video.currentTime;

        for (const segment of segments) {
            const [start, end] =
                segment.segment;

            if (time < start) {
                break;
            }

            if (
                time >= start &&
                time < end &&
                end !== lastSkippedEnd
            ) {
                lastSkippedEnd = end;

                /*
                 * Keep the seek inside the
                 * media duration when known.
                 */
                const duration =
                    Number.isFinite(
                        video.duration
                    )
                        ? video.duration
                        : end;

                video.currentTime =
                    Math.min(
                        end,
                        duration
                    );

                break;
            }
        }

        /*
         * Once playback moves away from the
         * previous segment, allow it to be
         * skipped again if necessary.
         */
        if (
            lastSkippedEnd >= 0 &&
            time > lastSkippedEnd
        ) {
            lastSkippedEnd = -1;
        }

        state.raf =
            requestAnimationFrame(tick);
    };

    attachedVideos.set(
        video,
        state
    );

    state.raf =
        requestAnimationFrame(tick);
}

///////////////////////////////
// Attach video
///////////////////////////////

async function attachVideo(
    video: HTMLVideoElement
): Promise<void> {
    if (attachedVideos.has(video)) {
        return;
    }

    const videoId =
        getVideoId(video);

    if (!videoId) {
        return;
    }

    const segments =
        await getSegments(videoId);

    /*
     * The element may have been removed
     * while the request was running.
     */
    if (!video.isConnected) {
        return;
    }

    if (!segments.length) {
        /*
         * Cache the fact that this video
         * has already been checked.
         */
        video.dataset.sbChecked = "true";
        return;
    }

    startSkipping(
        video,
        videoId,
        segments
    );
}

///////////////////////////////
// Scan
///////////////////////////////

function scanVideos(
    root: ParentNode = document
): void {
    const videos =
        root.querySelectorAll<HTMLVideoElement>(
            "video"
        );

    for (const video of videos) {
        if (
            video.dataset.sbChecked ===
            "true" ||
            attachedVideos.has(video)
        ) {
            continue;
        }

        void attachVideo(video);
    }
}

///////////////////////////////
// Cleanup
///////////////////////////////

function detachVideo(
    video: HTMLVideoElement
): void {
    const state =
        attachedVideos.get(video);

    if (!state) {
        return;
    }

    cancelAnimationFrame(
        state.raf
    );

    attachedVideos.delete(video);
}

///////////////////////////////
// Mutation observer
///////////////////////////////

function startObserver(): void {
    if (observer) {
        return;
    }

    observer =
        new MutationObserver(
            mutations => {
                for (const mutation of mutations) {
                    for (
                        const node
                        of mutation.addedNodes
                    ) {
                        if (
                            node.nodeType !==
                            Node.ELEMENT_NODE
                        ) {
                            continue;
                        }

                        scanVideos(
                            node as Element
                        );
                    }
                }
            }
        );

    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );
}

///////////////////////////////
// Initial scan
///////////////////////////////

scanVideos();
startObserver();

///////////////////////////////
// Public API
///////////////////////////////

export const SponsorBlock = {
    scan(): void {
        scanVideos();
    },

    clearCache(): void {
        segmentCache.clear();
    },

    stop(): void {
        observer?.disconnect();
        observer = null;

        /*
         * WeakMap isn't iterable, so existing
         * controllers naturally disappear with
         * their video elements. The observer is
         * what controls future work.
         */
    }
};
