///////////////////////////////
// Platform Types
///////////////////////////////

type SciterView = {
    open(url: string): void;
};

declare const view: SciterView | undefined;
declare const Sciter: SciterView | undefined;

///////////////////////////////
// Service Types
///////////////////////////////

type Service = {
    id: string;
    matches(url: URL): boolean;
    transform(url: URL): string;
};

///////////////////////////////
// Helpers
///////////////////////////////

function isHost(url: URL, hostname: string): boolean {
    return url.hostname.toLowerCase() === hostname;
}

function getPathParts(url: URL): string[] {
    return url.pathname
        .split("/")
        .filter(Boolean);
}

function parseUrl(value: string): URL | null {
    try {
        const url = new URL(value);

        if (
            url.protocol !== "http:" &&
            url.protocol !== "https:"
        ) {
            return null;
        }

        return url;
    } catch {
        return null;
    }
}

///////////////////////////////
// Services
///////////////////////////////

const SERVICES: Service[] = [
    {
        id: "spotify",

        matches(url) {
            if (!isHost(url, "open.spotify.com")) {
                return false;
            }

            const parts = getPathParts(url);

            if (parts[0]?.startsWith("intl-")) {
                parts.shift();
            }

            const type = parts[0];
            const id = parts[1];

            return (
                !!type &&
                !!id &&
                [
                    "track",
                    "album",
                    "artist",
                    "playlist",
                    "user",
                    "episode",
                    "prerelease"
                ].includes(type)
            );
        },

        transform(url) {
            const parts = getPathParts(url);

            if (parts[0]?.startsWith("intl-")) {
                parts.shift();
            }

            return `spotify://${parts[0]}/${parts[1]}`;
        }
    },

    {
        id: "steam",

        matches(url) {
            return (
                isHost(url, "steamcommunity.com") ||
                isHost(url, "store.steampowered.com")
            );
        },

        transform(url) {
            return `steam://openurl/${url.href}`;
        }
    },

    {
        id: "epic",

        matches(url) {
            return isHost(
                url,
                "store.epicgames.com"
            );
        },

        transform(url) {
            const path = url.pathname.replace(
                /^\/+/,
                ""
            );

            return `com.epicgames.launcher://store/${path}`;
        }
    },

    {
        id: "tidal",

        matches(url) {
            if (
                !isHost(url, "tidal.com") &&
                !isHost(url, "listen.tidal.com")
            ) {
                return false;
            }

            const parts = getPathParts(url);

            if (parts[0] === "browse") {
                parts.shift();
            }

            const type = parts[0];
            const id = parts[1];

            return (
                !!type &&
                !!id &&
                [
                    "track",
                    "album",
                    "artist",
                    "playlist",
                    "user",
                    "video",
                    "mix"
                ].includes(type) &&
                /^[a-f0-9-]+$/i.test(id)
            );
        },

        transform(url) {
            const parts = getPathParts(url);

            if (parts[0] === "browse") {
                parts.shift();
            }

            return `tidal://${parts[0]}/${parts[1]}`;
        }
    },

    {
        id: "appleMusic",

        matches(url) {
            return isHost(
                url,
                "music.apple.com"
            );
        },

        transform(url) {
            return url.href.replace(
                /^https:/i,
                "itunes:"
            );
        }
    },

    {
        id: "youtubeMusic",

        matches(url) {
            return isHost(
                url,
                "music.youtube.com"
            );
        },

        transform(url) {
            return (
                "vnd.youtube.music://open?url=" +
                encodeURIComponent(url.href)
            );
        }
    },

    {
        id: "roblox",

        matches(url) {
            if (!isHost(url, "www.roblox.com")) {
                return false;
            }

            const parts = getPathParts(url);

            return (
                parts[0] === "games" &&
                /^\d+$/.test(parts[1] ?? "")
            );
        },

        transform(url) {
            const parts = getPathParts(url);

            return `roblox-player://placeId=${parts[1]}`;
        }
    }
];

///////////////////////////////
// Transform URL
///////////////////////////////

export function transformUrl(value: string): string {
    const url = parseUrl(value);

    if (!url) {
        return value;
    }

    for (const service of SERVICES) {
        if (!service.matches(url)) {
            continue;
        }

        return service.transform(url);
    }

    return value;
}

///////////////////////////////
// Open External App
///////////////////////////////

function openExternal(
    appUrl: string,
    fallbackUrl: string
): void {
    try {
        if (
            typeof view !== "undefined" &&
            typeof view.open === "function"
        ) {
            view.open(appUrl);
            return;
        }

        if (
            typeof Sciter !== "undefined" &&
            typeof Sciter.open === "function"
        ) {
            Sciter.open(appUrl);
            return;
        }

        window.location.href = appUrl;

        window.setTimeout(() => {
            window.open(
                fallbackUrl,
                "_blank",
                "noopener,noreferrer"
            );
        }, 1500);
    } catch {
        window.open(
            fallbackUrl,
            "_blank",
            "noopener,noreferrer"
        );
    }
}

///////////////////////////////
// Click Handling
///////////////////////////////

function handleClick(event: MouseEvent): void {
    // Only handle normal left clicks.
    if (
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
        return;
    }

    const anchor = target.closest("a[href]");

    if (!(anchor instanceof HTMLAnchorElement)) {
        return;
    }

    if (anchor.hasAttribute("download")) {
        return;
    }

    const originalUrl = anchor.href;
    const appUrl = transformUrl(originalUrl);

    if (appUrl === originalUrl) {
        return;
    }

    event.preventDefault();

    openExternal(
        appUrl,
        originalUrl
    );
}

///////////////////////////////
// Init
///////////////////////////////

let initialized = false;

export function initOpenInApp(): void {
    if (initialized) {
        return;
    }

    initialized = true;

    document.addEventListener(
        "click",
        handleClick,
        true
    );
}
