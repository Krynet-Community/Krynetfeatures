///////////////////////////////
// Platform Types
///////////////////////////////

type SciterView = {
    open(url: string): void;
};

declare const view:
    | SciterView
    | undefined;

declare const Sciter:
    | SciterView
    | undefined;

///////////////////////////////
// Service Types
///////////////////////////////

type Service = {
    id: string;
    match(url: URL): boolean;
    transform(url: URL): string;
};

///////////////////////////////
// Helpers
///////////////////////////////

function isHost(
    url: URL,
    hosts: string[]
): boolean {
    const hostname =
        url.hostname.toLowerCase();

    return hosts.some(
        host =>
            hostname === host ||
            hostname.endsWith(`.${host}`)
    );
}

function getPathParts(
    url: URL
): string[] {
    return url.pathname
        .split("/")
        .filter(Boolean);
}

///////////////////////////////
// Service Rules
///////////////////////////////

const SERVICES: Service[] = [
    {
        id: "spotify",

        match(url) {
            if (
                !isHost(url, [
                    "open.spotify.com"
                ])
            ) {
                return false;
            }

            const parts =
                getPathParts(url);

            const offset =
                parts[0]?.startsWith(
                    "intl-"
                )
                    ? 1
                    : 0;

            const type =
                parts[offset];

            const id =
                parts[offset + 1];

            return Boolean(
                type &&
                id &&
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
            const parts =
                getPathParts(url);

            const offset =
                parts[0]?.startsWith(
                    "intl-"
                )
                    ? 1
                    : 0;

            return (
                `spotify://${parts[offset]}/` +
                `${parts[offset + 1]}`
            );
        }
    },

    {
        id: "steam",

        match(url) {
            return isHost(url, [
                "steamcommunity.com",
                "store.steampowered.com"
            ]);
        },

        transform(url) {
            return (
                `steam://openurl/${url.href}`
            );
        }
    },

    {
        id: "epic",

        match(url) {
            return isHost(url, [
                "store.epicgames.com"
            ]);
        },

        transform(url) {
            const path =
                url.pathname.replace(
                    /^\/+/,
                    ""
                );

            return (
                `com.epicgames.launcher://` +
                `store/${path}`
            );
        }
    },

    {
        id: "tidal",

        match(url) {
            if (
                !isHost(url, [
                    "tidal.com",
                    "listen.tidal.com"
                ])
            ) {
                return false;
            }

            const parts =
                getPathParts(url);

            const browse =
                parts[0] === "browse"
                    ? 1
                    : 0;

            const type =
                parts[browse];

            const id =
                parts[browse + 1];

            if (!type || !id) {
                return false;
            }

            if (
                ![
                    "track",
                    "album",
                    "artist",
                    "playlist",
                    "user",
                    "video",
                    "mix"
                ].includes(type)
            ) {
                return false;
            }

            return /^[a-f0-9-]+$/i.test(
                id
            );
        },

        transform(url) {
            const parts =
                getPathParts(url);

            const browse =
                parts[0] === "browse"
                    ? 1
                    : 0;

            return (
                `tidal://${parts[browse]}/` +
                `${parts[browse + 1]}`
            );
        }
    },

    {
        id: "appleMusic",

        match(url) {
            return isHost(url, [
                "music.apple.com"
            ]);
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

        match(url) {
            return isHost(url, [
                "music.youtube.com"
            ]);
        },

        transform(url) {
            return (
                `vnd.youtube.music://open?` +
                `url=${encodeURIComponent(
                    url.href
                )}`
            );
        }
    },

    {
        id: "roblox",

        match(url) {
            if (
                !isHost(url, [
                    "roblox.com",
                    "www.roblox.com"
                ])
            ) {
                return false;
            }

            const parts =
                getPathParts(url);

            return (
                parts[0] === "games" &&
                /^\d+$/.test(
                    parts[1] ?? ""
                )
            );
        },

        transform(url) {
            const parts =
                getPathParts(url);

            return (
                `roblox-player://placeId=` +
                `${parts[1]}`
            );
        }
    }
];

///////////////////////////////
// URL Parsing
///////////////////////////////

function parseHttpUrl(
    value: string
): URL | null {
    try {
        const url =
            new URL(value);

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
// URL Transform
///////////////////////////////

export function transformUrl(
    value: string
): string {
    const url =
        parseHttpUrl(value);

    if (!url) {
        return value;
    }

    for (
        const service
        of SERVICES
    ) {
        try {
            if (service.match(url)) {
                return service.transform(
                    url
                );
            }
        } catch {
            // One broken service rule
            // should not break navigation.
        }
    }

    return value;
}

///////////////////////////////
// External Open
///////////////////////////////

function openExternal(
    url: string,
    fallbackUrl?: string
): void {
    try {
        if (
            typeof view !==
                "undefined" &&
            typeof view?.open ===
                "function"
        ) {
            view.open(url);
            return;
        }

        if (
            typeof Sciter !==
                "undefined" &&
            typeof Sciter?.open ===
                "function"
        ) {
            Sciter.open(url);
            return;
        }

        /*
         * Browser fallback.
         *
         * Assigning location is useful for
         * custom protocols because the browser
         * can hand them to the registered app.
         */
        window.location.href = url;

        if (fallbackUrl) {
            window.setTimeout(() => {
                /*
                 * Only open the HTTP URL if the
                 * custom protocol didn't take over.
                 */
                window.open(
                    fallbackUrl,
                    "_blank",
                    "noopener,noreferrer"
                );
            }, 1500);
        }
    } catch {
        if (!fallbackUrl) {
            return;
        }

        window.open(
            fallbackUrl,
            "_blank",
            "noopener,noreferrer"
        );
    }
}

///////////////////////////////
// Click Handler
///////////////////////////////

function handleClick(
    event: MouseEvent
): void {
    /*
     * Ignore modified clicks.
     *
     * Ctrl/Cmd click,
     * middle click,
     * Shift click, etc.
     * should retain normal browser behavior.
     */
    if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
    ) {
        return;
    }

    const target =
        event.target;

    if (
        !(target instanceof Element)
    ) {
        return;
    }

    const anchor =
        target.closest(
            "a[href]"
        );

    if (
        !(anchor instanceof
            HTMLAnchorElement)
    ) {
        return;
    }

    /*
     * Don't hijack downloads.
     */
    if (
        anchor.hasAttribute(
            "download"
        )
    ) {
        return;
    }

    const originalUrl =
        anchor.href;

    const transformed =
        transformUrl(
            originalUrl
        );

    if (
        transformed ===
        originalUrl
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    openExternal(
        transformed,
        originalUrl
    );
}

///////////////////////////////
// Public Init
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
