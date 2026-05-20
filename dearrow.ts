(() => {
    const LICENSE = "FR3Lo-e986a";

    /* -------------------------
       TYPES
    ------------------------- */

    type DeArrowBranding = {
        titles?: { title: string; votes: number }[];
        thumbnails?: {
            timestamp: number;
            votes: number;
            original?: boolean;
        }[];
    };

    type DeArrowContainer = HTMLElement & {
        __dearrowDone?: boolean;
    };

    type ToggleButton = HTMLButtonElement & {
        dataset: {
            state?: "dearrow" | "original";
        };
    };

    /* -------------------------
       YOUTUBE ID DETECTION
    ------------------------- */

    const YT_REGEX =
        /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|piped\.[^/]+\/watch\?v=|invidious\.[^/]+\/watch\?v=)([a-zA-Z0-9_-]{11})/;

    function extractID(url: string): string | null {
        const match = url.match(YT_REGEX);
        if (match) return match[1];

        const fallback = url.match(/[a-zA-Z0-9_-]{11}/);
        return fallback ? fallback[0] : null;
    }

    /* -------------------------
       API
    ------------------------- */

    async function fetchBranding(
        id: string
    ): Promise<DeArrowBranding | null> {
        try {
            const res = await fetch(
                `https://sponsor.ajay.app/api/branding?videoID=${id}&license=${LICENSE}`
            );

            if (!res.ok) return null;

            return (await res.json()) as DeArrowBranding;
        } catch {
            return null;
        }
    }

    /* -------------------------
       ELEMENT HELPERS
    ------------------------- */

    function findTitle(container: Element): HTMLElement | null {
        return (
            container.querySelector<HTMLElement>("[data-embed-title]") ||
            container.querySelector<HTMLElement>(".embed-title") ||
            container.querySelector<HTMLElement>("a[href]")
        );
    }

    function findThumbnail(container: Element): HTMLImageElement | null {
        return (
            container.querySelector<HTMLImageElement>(
                "[data-embed-thumbnail]"
            ) ||
            container.querySelector<HTMLImageElement>(".embed-thumbnail") ||
            container.querySelector<HTMLImageElement>("img")
        );
    }

    /* -------------------------
       MAIN PROCESSOR
    ------------------------- */

    async function processEmbed(container: DeArrowContainer): Promise<void> {
        if (container.__dearrowDone) return;

        const iframe = container.querySelector<HTMLIFrameElement>("iframe");
        const video = container.querySelector<HTMLVideoElement>("video");

        const url = iframe?.src || video?.src;
        if (!url) return;

        const id = extractID(url);
        if (!id) return;

        const data = await fetchBranding(id);
        if (!data) return;

        const titleEl = findTitle(container);
        const thumbEl = findThumbnail(container);

        if (!titleEl && !thumbEl) return;

        const orig = {
            title: titleEl?.textContent ?? null,
            thumb: thumbEl?.src ?? null
        };

        const newTitle =
            data.titles?.[0]?.votes !== undefined &&
            data.titles[0].votes >= 0
                ? data.titles[0].title.replace(/(^|\s)>(\S)/g, "$1$2")
                : null;

        const newThumb =
            data.thumbnails?.[0]?.votes !== undefined &&
            data.thumbnails[0].votes >= 0 &&
            !data.thumbnails[0].original
                ? `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${id}&time=${data.thumbnails[0].timestamp}&license=${LICENSE}`
                : null;

        if (!newTitle && !newThumb) return;

        /* apply initial state */
        if (titleEl && newTitle) titleEl.textContent = newTitle;
        if (thumbEl && newThumb) thumbEl.src = newThumb;

        /* toggle button */
        const btn = document.createElement("button") as ToggleButton;

        btn.textContent = "DeArrow";
        btn.dataset.state = "dearrow";

        Object.assign(btn.style, {
            position: "absolute",
            top: "6px",
            right: "6px",
            background: "#2f3136",
            color: "#fff",
            border: "none",
            borderRadius: "6px",
            fontSize: "11px",
            padding: "3px 6px",
            cursor: "pointer",
            zIndex: "10"
        } as CSSStyleDeclaration);

        btn.onclick = () => {
            if (btn.dataset.state === "dearrow") {
                if (titleEl && orig.title) titleEl.textContent = orig.title;
                if (thumbEl && orig.thumb) thumbEl.src = orig.thumb;

                btn.dataset.state = "original";
            } else {
                if (titleEl && newTitle) titleEl.textContent = newTitle;
                if (thumbEl && newThumb) thumbEl.src = newThumb;

                btn.dataset.state = "dearrow";
            }
        };

        container.style.position ||= "relative";
        container.appendChild(btn);

        container.__dearrowDone = true;
    }

    /* -------------------------
       SCANNER
    ------------------------- */

    function scan(): void {
        const embeds = document.querySelectorAll<
            HTMLIFrameElement | HTMLVideoElement
        >("iframe, video");

        embeds.forEach(node => {
            const container =
                node.closest(".embed") ||
                node.closest(".message") ||
                node.parentElement;

            if (container) {
                processEmbed(container as DeArrowContainer);
            }
        });
    }

    /* -------------------------
       OBSERVER
    ------------------------- */

    const observer = new MutationObserver(scan);

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    /* initial run */
    scan();
})();
