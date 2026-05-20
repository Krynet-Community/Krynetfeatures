///////////////////////////////
// Platform Types
///////////////////////////////

type SciterView = {
    open: (url: string) => void;
};

declare const view: SciterView | undefined;
declare const Sciter: SciterView | undefined;

///////////////////////////////
// Service Types
///////////////////////////////

type Service = {
    id: string;
    match: RegExp;
    replace: (...args: string[]) => string;
};

///////////////////////////////
// Rules
///////////////////////////////

const SERVICES: Service[] = [
    {
        id: "spotify",
        match:
            /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|artist|playlist|user|episode|prerelease)\/([^?]+)/i,
        replace: (_full, type, id) =>
            `spotify://${type}/${id}`
    },
    {
        id: "steam",
        match:
            /^https:\/\/(steamcommunity\.com|store\.steampowered\.com)\/.+/i,
        replace: (url) => `steam://openurl/${url}`
    },
    {
        id: "epic",
        match:
            /^https:\/\/store\.epicgames\.com\/(.+)/i,
        replace: (_full, path) =>
            `com.epicgames.launcher://store/${path}`
    },
    {
        id: "tidal",
        match:
            /^https:\/\/(?:listen\.)?tidal\.com\/(?:browse\/)?(track|album|artist|playlist|user|video|mix)\/([a-f0-9-]+)/i,
        replace: (_full, type, id) =>
            `tidal://${type}/${id}`
    },
    {
        id: "appleMusic",
        match: /^https:\/\/music\.apple\.com\/.+/i,
        replace: (url) => url.replace(/^https:/i, "itunes:")
    },
    {
        id: "youtubeMusic",
        match: /^https:\/\/music\.youtube\.com\/.+/i,
        replace: (url) =>
            `vnd.youtube.music://open?url=${encodeURIComponent(url)}`
    },
    {
        id: "roblox",
        match: /^https:\/\/www\.roblox\.com\/games\/(\d+)/i,
        replace: (_full, gameId) =>
            `roblox-player://placeId=${gameId}`
    }
];

///////////////////////////////
// External Open
///////////////////////////////

function openExternal(url: string, fallbackUrl?: string): void {
    try {
        if (typeof view?.open === "function") {
            view.open(url);
            return;
        }

        if (typeof Sciter?.open === "function") {
            Sciter.open(url);
            return;
        }

        window.location.href = url;

        if (fallbackUrl) {
            window.setTimeout(() => {
                window.open(fallbackUrl, "_blank");
            }, 1500);
        }
    } catch {
        if (fallbackUrl) {
            window.open(fallbackUrl, "_blank");
        }
    }
}

///////////////////////////////
// URL Transform
///////////////////////////////

export function transformUrl(url: string): string {
    for (const service of SERVICES) {
        if (service.match.test(url)) {
            return url.replace(service.match, service.replace);
        }
    }

    return url;
}

///////////////////////////////
// Click Handler
///////////////////////////////

function handleClick(event: MouseEvent): void {
    const target = event.target;

    if (!(target instanceof Element)) return;

    const anchor = target.closest("a[href]");

    if (!(anchor instanceof HTMLAnchorElement)) return;

    const originalUrl = anchor.href;

    const transformed = transformUrl(originalUrl);

    if (transformed !== originalUrl) {
        event.preventDefault();
        openExternal(transformed, originalUrl);
    }
}

///////////////////////////////
// Public Init
///////////////////////////////

export function initOpenInApp(): void {
    document.addEventListener("click", handleClick, true);
}
