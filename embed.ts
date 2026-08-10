import { Reactions } from "./reactions.js";

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */

type CSSProperties =
    Partial<CSSStyleDeclaration>;

function style(
    element: HTMLElement,
    styles: CSSProperties
): void {
    Object.assign(
        element.style,
        styles
    );
}

function createElement<
    K extends keyof HTMLElementTagNameMap
>(
    tag: K
): HTMLElementTagNameMap[K] {
    return document.createElement(tag);
}

/*
 * Matches URLs while avoiding common trailing
 * punctuation from normal sentences.
 */
const URL_REGEX =
    /https?:\/\/[^\s<>"']+?(?=[\s<>"']|$)/gi;

/* ---------------------------------------------------------
   TYPES
--------------------------------------------------------- */

type NoEmbedResponse = {
    title?: string;
    description?: string;
    provider_name?: string;
    thumbnail_url?: string;
    url?: string;
};

type EmbedCache = {
    meta: NoEmbedResponse;
    mime: string;
};

type MediaElement =
    | HTMLImageElement
    | HTMLVideoElement
    | HTMLAudioElement
    | HTMLIFrameElement
    | HTMLDivElement;

/* ---------------------------------------------------------
   CONSTANTS
--------------------------------------------------------- */

const NOEMBED_API =
    "https://noembed.com/embed";

const MAX_MEDIA_WIDTH =
    "400px";

const META_CACHE =
    new Map<string, Promise<EmbedCache>>();

/* ---------------------------------------------------------
   URL HELPERS
--------------------------------------------------------- */

function normalizeURL(
    value: string
): string | null {
    try {
        const url =
            new URL(value);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return null;
        }

        return url.href;
    } catch {
        return null;
    }
}

function getFilename(
    url: string
): string {
    try {
        const parsed =
            new URL(url);

        const pathname =
            decodeURIComponent(
                parsed.pathname
            );

        const name =
            pathname.split(
                "/"
            ).filter(Boolean).pop();

        return name || parsed.hostname;
    } catch {
        return url;
    }
}

/* ---------------------------------------------------------
   NETWORK
--------------------------------------------------------- */

async function getMime(
    url: string
): Promise<string> {
    /*
     * HEAD is not universally supported.
     * Use GET with a Range request first.
     */
    try {
        const response =
            await fetch(url, {
                method: "GET",
                headers: {
                    Range: "bytes=0-0"
                }
            });

        return (
            response.headers.get(
                "content-type"
            ) ?? ""
        );
    } catch {
        return "";
    }
}

async function getMeta(
    url: string
): Promise<NoEmbedResponse> {
    try {
        const endpoint =
            `${NOEMBED_API}?url=${encodeURIComponent(
                url
            )}`;

        const response =
            await fetch(endpoint);

        if (!response.ok) {
            return {};
        }

        const data =
            await response.json();

        if (
            !data ||
            typeof data !== "object"
        ) {
            return {};
        }

        return data as NoEmbedResponse;
    } catch {
        return {};
    }
}

async function getEmbedData(
    url: string
): Promise<EmbedCache> {
    const cached =
        META_CACHE.get(url);

    if (cached) {
        return cached;
    }

    const request =
        Promise.all([
            getMeta(url),
            getMime(url)
        ]).then(
            ([meta, mime]) => ({
                meta,
                mime
            })
        );

    META_CACHE.set(
        url,
        request
    );

    return request;
}

/* ---------------------------------------------------------
   MEDIA
--------------------------------------------------------- */

function applyMediaStyle(
    element: HTMLElement
): void {
    style(element, {
        maxWidth:
            MAX_MEDIA_WIDTH,
        width: "100%",
        borderRadius: "6px",
        marginTop: "6px",
        display: "block"
    });
}

function createMedia(
    url: string,
    mime: string,
    meta: NoEmbedResponse
): MediaElement | null {
    /*
     * Never inject meta.html directly.
     *
     * noembed's HTML may contain arbitrary
     * provider markup, scripts, embeds, etc.
     */

    if (
        meta.thumbnail_url
    ) {
        const image =
            createElement("img");

        image.src =
            meta.thumbnail_url;

        image.alt =
            meta.title ??
            "Embedded media";

        image.loading =
            "lazy";

        image.referrerPolicy =
            "no-referrer";

        applyMediaStyle(
            image
        );

        return image;
    }

    if (
        mime.startsWith(
            "image/"
        )
    ) {
        const image =
            createElement("img");

        image.src = url;
        image.alt =
            getFilename(url);

        image.loading =
            "lazy";

        applyMediaStyle(
            image
        );

        return image;
    }

    if (
        mime.startsWith(
            "video/"
        )
    ) {
        const video =
            createElement("video");

        video.src = url;
        video.controls = true;
        video.preload =
            "metadata";

        applyMediaStyle(
            video
        );

        return video;
    }

    if (
        mime.startsWith(
            "audio/"
        )
    ) {
        const audio =
            createElement("audio");

        audio.src = url;
        audio.controls = true;
        audio.preload =
            "metadata";

        style(audio, {
            width: "100%",
            marginTop: "6px"
        });

        return audio;
    }

    if (
        mime ===
        "application/pdf"
    ) {
        const frame =
            createElement("iframe");

        frame.src = url;
        frame.loading =
            "lazy";

        frame.title =
            "PDF document";

        frame.referrerPolicy =
            "no-referrer";

        style(frame, {
            width: "100%",
            height: "400px",
            border: "none",
            borderRadius: "6px",
            marginTop: "6px"
        });

        return frame;
    }

    /*
     * Generic file.
     */
    const file =
        createElement("div");

    file.textContent =
        getFilename(url);

    style(file, {
        background: "#3a3b3c",
        padding: "8px",
        borderRadius: "6px",
        marginTop: "6px",
        fontSize: "13px"
    });

    return file;
}

/* ---------------------------------------------------------
   EMBED CARD
--------------------------------------------------------- */

async function buildEmbed(
    url: string
): Promise<HTMLElement> {
    const {
        meta,
        mime
    } = await getEmbedData(
        url
    );

    const card =
        createElement("div");

    card.className =
        "kr-embed";

    style(card, {
        display: "flex",
        background: "#2f3136",
        borderRadius: "8px",
        maxWidth: "480px",
        marginTop: "6px",
        overflow: "hidden",
        fontFamily:
            "gg sans, Arial, sans-serif"
    });

    /* Accent bar */

    const bar =
        createElement("div");

    style(bar, {
        width: "4px",
        flexShrink: "0",
        background: "#5865F2"
    });

    /* Body */

    const body =
        createElement("div");

    style(body, {
        padding: "10px",
        flex: "1",
        minWidth: "0",
        display: "flex",
        flexDirection: "column",
        gap: "4px"
    });

    card.append(
        bar,
        body
    );

    /* Title */

    const title =
        createElement("a");

    title.href = url;
    title.target =
        "_blank";

    title.rel =
        "noopener noreferrer";

    title.textContent =
        meta.title ||
        url;

    style(title, {
        color: "#00aff4",
        fontWeight: "600",
        fontSize: "14px",
        textDecoration: "none",
        overflowWrap:
            "anywhere"
    });

    body.appendChild(
        title
    );

    /* Description */

    if (
        meta.description
    ) {
        const description =
            createElement("div");

        description.textContent =
            meta.description;

        style(description, {
            fontSize: "12px",
            color: "#b9bbbe",
            overflowWrap:
                "anywhere"
        });

        body.appendChild(
            description
        );
    }

    /* Media */

    const media =
        createMedia(
            url,
            mime,
            meta
        );

    if (media) {
        body.appendChild(
            media
        );
    }

    /* Provider */

    if (
        meta.provider_name
    ) {
        const provider =
            createElement("div");

        provider.textContent =
            meta.provider_name;

        style(provider, {
            fontSize: "11px",
            color: "#72767d",
            marginTop: "4px"
        });

        body.appendChild(
            provider
        );
    }

    /* Reactions */

    const reactions =
        createElement("div");

    reactions.className =
        "kr-embed-reactions";

    style(reactions, {
        marginTop: "6px"
    });

    card.appendChild(
        reactions
    );

    new Reactions(
        reactions
    );

    return card;
}

/* ---------------------------------------------------------
   LAZY EMBED
--------------------------------------------------------- */

function lazyEmbed(
    container: HTMLElement,
    url: string
): void {
    const placeholder =
        createElement("div");

    placeholder.className =
        "kr-embed-placeholder";

    style(placeholder, {
        minHeight: "20px",
        marginTop: "6px"
    });

    container.appendChild(
        placeholder
    );

    if (
        typeof IntersectionObserver ===
        "undefined"
    ) {
        void loadEmbed(
            placeholder,
            url
        );

        return;
    }

    const observer =
        new IntersectionObserver(
            entries => {
                const entry =
                    entries[0];

                if (
                    !entry?.isIntersecting
                ) {
                    return;
                }

                observer.disconnect();

                void loadEmbed(
                    placeholder,
                    url
                );
            },
            {
                rootMargin:
                    "200px"
            }
        );

    observer.observe(
        placeholder
    );
}

async function loadEmbed(
    placeholder: HTMLElement,
    url: string
): Promise<void> {
    try {
        const embed =
            await buildEmbed(
                url
            );

        if (
            !placeholder.isConnected
        ) {
            return;
        }

        placeholder.replaceWith(
            embed
        );
    } catch (error) {
        console.warn(
            "[Embed] Failed to build embed:",
            url,
            error
        );

        if (
            placeholder.isConnected
        ) {
            placeholder.remove();
        }
    }
}

/* ---------------------------------------------------------
   MESSAGE SCANNING
--------------------------------------------------------- */

function extractURLs(
    text: string
): string[] {
    const matches =
        text.match(
            URL_REGEX
        );

    if (!matches) {
        return [];
    }

    const unique =
        new Set<string>();

    for (
        const match
        of matches
    ) {
        const url =
            normalizeURL(
                match
            );

        if (url) {
            unique.add(url);
        }
    }

    return Array.from(
        unique
    );
}

const processedMessages =
    new WeakSet<HTMLElement>();

function processMessage(
    message: HTMLElement
): void {
    if (
        processedMessages.has(
            message
        )
    ) {
        return;
    }

    processedMessages.add(
        message
    );

    const text =
        message.innerText;

    const urls =
        extractURLs(
            text
        );

    if (!urls.length) {
        return;
    }

    for (
        const url
        of urls
    ) {
        lazyEmbed(
            message,
            url
        );
    }
}

/* ---------------------------------------------------------
   PUBLIC API
--------------------------------------------------------- */

export const Embed = {
    scanMessages(
        selector: string
    ): void {
        document
            .querySelectorAll<HTMLElement>(
                selector
            )
            .forEach(
                processMessage
            );
    }
};
