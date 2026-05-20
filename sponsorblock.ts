///////////////////////////////
// Types
///////////////////////////////

type SkipCategory = "sponsor" | "selfpromo" | "interaction" | string;

type SponsorSegment = {
    category: SkipCategory;
    segment: [number, number];
};

///////////////////////////////
// Constants
///////////////////////////////

const SKIP_CATEGORIES: ReadonlySet<string> = new Set([
    "sponsor",
    "selfpromo",
    "interaction"
]);

///////////////////////////////
// Fetch sponsor segments
///////////////////////////////

async function getSegments(videoId: string): Promise<SponsorSegment[]> {
    try {
        const res = await fetch(
            `https://sponsor.ajay.app/api/skipSegments?videoID=${videoId}`
        );

        if (!res.ok) return [];

        const data: SponsorSegment[] = await res.json();

        return data.filter((seg) =>
            SKIP_CATEGORIES.has(seg.category)
        );
    } catch {
        return [];
    }
}

///////////////////////////////
// Extract YouTube ID
///////////////////////////////

function extractVideoId(url: string): string | null {
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();

        const isYouTube =
            host.includes("youtube.com") ||
            host === "youtu.be" ||
            host.includes("invidious") ||
            host.includes("piped");

        if (!isYouTube) return null;

        const vParam = u.searchParams.get("v");
        if (vParam && vParam.length === 11) return vParam;

        const parts = u.pathname.split("/").filter(Boolean);

        if (host === "youtu.be" && parts[0]?.length === 11) {
            return parts[0];
        }

        const watchIndex = parts.indexOf("watch");
        if (watchIndex !== -1 && parts[watchIndex + 1]?.length === 11) {
            return parts[watchIndex + 1];
        }

        const embedIndex = parts.indexOf("embed");
        if (embedIndex !== -1 && parts[embedIndex + 1]?.length === 11) {
            return parts[embedIndex + 1];
        }

        for (const part of parts.reverse()) {
            if (part.length === 11) return part;
        }
    } catch {
        return null;
    }

    return null;
}

///////////////////////////////
// Attach sponsor block logic
///////////////////////////////

async function attachSB(
    video: HTMLVideoElement,
    videoId: string | null
): Promise<void> {
    if (!videoId || video.dataset.sbAttached === "true") return;

    const segments = await getSegments(videoId);
    if (!segments.length) return;

    video.addEventListener("timeupdate", () => {
        const t = video.currentTime;

        for (const s of segments) {
            const [start, end] = s.segment;

            if (t >= start && t < end) {
                video.currentTime = end;
                break;
            }
        }
    });

    video.dataset.sbAttached = "true";
}

///////////////////////////////
// Scan videos in DOM
///////////////////////////////

async function scanVideos(root: ParentNode = document): Promise<void> {
    const videos = Array.from(root.querySelectorAll("video"));

    for (const video of videos) {
        const el = video as HTMLVideoElement;

        const videoId =
            el.dataset.youtubeId ||
            extractVideoId(window.location.href);

        await attachSB(el, videoId);
    }

    const iframes = Array.from(root.querySelectorAll("iframe"));

    for (const iframe of iframes) {
        const el = iframe as HTMLIFrameElement;

        try {
            const videoId = extractVideoId(el.src);
            if (!videoId) continue;

            let videoInside: HTMLVideoElement | null = null;

            try {
                const doc =
                    el.contentDocument ||
                    el.contentWindow?.document;

                videoInside = doc?.querySelector("video") ?? null;
            } catch {
                continue;
            }

            if (videoInside) {
                await attachSB(videoInside, videoId);
            }
        } catch {
            continue;
        }
    }
}

///////////////////////////////
// Observer bootstrap
///////////////////////////////

const observer = new MutationObserver(() => {
    scanVideos().catch(() => {});
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

scanVideos().catch(() => {});
