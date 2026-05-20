(() => {
    const API = "https://sponsor.ajay.app/api";

    const cache = new Map<string, any>();
    let markStart: number | null = null;

    /* -------------------------
       TYPES
    ------------------------- */

    type Segment = {
        segment: [number, number];
        category?: string;
    };

    /* -------------------------
       EXTRACT SPOTIFY EPISODE ID
    ------------------------- */

    function getSpotifyID(embed: Element): string | null {
        const iframe = embed.querySelector("iframe") as HTMLIFrameElement | null;
        if (!iframe?.src) return null;

        try {
            const url = new URL(iframe.src);

            const match =
                url.pathname.match(/episode\/([a-zA-Z0-9]+)/) ||
                url.pathname.match(/embed\/episode\/([a-zA-Z0-9]+)/);

            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    /* -------------------------
       FETCH SEGMENTS
    ------------------------- */

    async function getSegments(id: string): Promise<Segment[]> {
        if (cache.has(id)) return cache.get(id) as Segment[];

        try {
            const res = await fetch(
                `${API}/skipSegments?videoID=${id}&service=Spotify`
            );

            if (!res.ok) return [];

            const data: Segment[] = await res.json();
            cache.set(id, data);

            return data;
        } catch {
            return [];
        }
    }

    /* -------------------------
       ATTACH SKIP LOGIC
    ------------------------- */

    async function attachSB(embed: HTMLElement): Promise<void> {
        if ((embed as any).__sb) return;

        const id = getSpotifyID(embed);
        if (!id) return;

        const audio = embed.querySelector("audio, video") as HTMLMediaElement | null;
        if (!audio) return;

        const segments = await getSegments(id);

        if (!segments.length) {
            (embed as any).__sb = true;
            return;
        }

        audio.addEventListener("timeupdate", () => {
            const t = audio.currentTime;

            for (const s of segments) {
                const [start, end] = s.segment;

                if (t >= start && t < end) {
                    audio.currentTime = end;
                    break;
                }
            }
        });

        (embed as any).__sb = true;
    }

    /* -------------------------
       OPTIONAL SUBMIT UI
    ------------------------- */

    function addUI(embed: HTMLElement, audio: HTMLMediaElement, id: string): void {
        if (embed.querySelector(".sb-mark")) return;

        const btn = document.createElement("button");

        btn.className = "sb-mark";
        btn.textContent = "Mark Sponsor";

        Object.assign(btn.style, {
            position: "absolute",
            bottom: "10px",
            right: "10px",
            zIndex: 999,
            padding: "6px 10px",
            background: "#1DB954",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "12px"
        } as CSSStyleDeclaration);

        btn.onclick = async () => {
            if (markStart === null) {
                markStart = audio.currentTime;
                btn.textContent = "Mark End";
            } else {
                const start = markStart;
                const end = audio.currentTime;

                markStart = null;
                btn.textContent = "Mark Sponsor";

                if (end > start) {
                    await fetch(`${API}/submitSegment`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            videoID: id,
                            segment: [start, end],
                            category: "sponsor",
                            service: "Spotify"
                        })
                    });
                }
            }
        };

        embed.style.position ||= "relative";
        embed.appendChild(btn);
    }

    /* -------------------------
       SCAN EMBEDS
    ------------------------- */

    function scan(): void {
        const embeds = document.querySelectorAll<HTMLElement>(
            ".krynet-embed, .embed, [data-embed]"
        );

        for (const embed of embeds) {
            if ((embed as any).__sb) continue;

            const id = getSpotifyID(embed);
            if (!id) continue;

            const audio = embed.querySelector("audio, video") as HTMLMediaElement | null;
            if (!audio) continue;

            attachSB(embed);
            addUI(embed, audio, id);
        }
    }

    /* -------------------------
       OBSERVER
    ------------------------- */

    new MutationObserver(scan).observe(document.body, {
        childList: true,
        subtree: true
    });

    scan();
})();
