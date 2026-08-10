type RateLimitConfig = {
    maxRequests: number;
    windowMs: number;
    maxTrackedIPs: number;
};

type GeoIPRange = {
    start: number;
    end: number;
    country: string;
};

type RawGeoIPRange = {
    start: string;
    end: string;
    country: string;
};

type RateLimitEntry = {
    timestamps: number[];
    lastSeen: number;
};

type Config = {
    blockedCountries: Set<string>;
    geoIPRanges: GeoIPRange[];
    abusiveIPs: Set<string>;
    rateLimit: RateLimitConfig;
};

const CONFIG: Config = {
    blockedCountries: new Set([
        "CN",
        "RU",
        "IR",
        "KP",
        "BY",
        "SY",
        "CU",
        "VE",
        "TM",
        "EG",
        "SA",
        "AE",
        "TR",
        "PK"
    ]),

    geoIPRanges: [],

    abusiveIPs: new Set<string>(),

    rateLimit: {
        maxRequests: 5,
        windowMs: 10_000,
        maxTrackedIPs: 50_000
    }
};

const ipAccess =
    new Map<string, RateLimitEntry>();

/* ---------------------------------------------------------
   IPv4
--------------------------------------------------------- */

function ipToNumber(ip: string): number {
    const parts = ip.trim().split(".");

    if (parts.length !== 4) {
        throw new Error(
            `Invalid IPv4 address: ${ip}`
        );
    }

    const octets = parts.map(part => {
        if (!/^\d{1,3}$/.test(part)) {
            throw new Error(
                `Invalid IPv4 address: ${ip}`
            );
        }

        const value = Number(part);

        if (
            !Number.isInteger(value) ||
            value < 0 ||
            value > 255
        ) {
            throw new Error(
                `Invalid IPv4 address: ${ip}`
            );
        }

        return value;
    });

    return (
        (
            octets[0] * 2 ** 24 +
            octets[1] * 2 ** 16 +
            octets[2] * 2 ** 8 +
            octets[3]
        ) >>> 0
    );
}

/* ---------------------------------------------------------
   RATE LIMITING
--------------------------------------------------------- */

function isRateLimited(ip: string): boolean {
    const now = Date.now();

    let entry = ipAccess.get(ip);

    if (!entry) {
        entry = {
            timestamps: [],
            lastSeen: now
        };

        ipAccess.set(ip, entry);
    }

    entry.lastSeen = now;

    const cutoff =
        now - CONFIG.rateLimit.windowMs;

    entry.timestamps =
        entry.timestamps.filter(
            timestamp => timestamp > cutoff
        );

    if (
        entry.timestamps.length >=
        CONFIG.rateLimit.maxRequests
    ) {
        return true;
    }

    entry.timestamps.push(now);

    return false;
}

/* ---------------------------------------------------------
   RATE LIMIT MEMORY CLEANUP
--------------------------------------------------------- */

function cleanupRateLimitCache(): void {
    const now = Date.now();

    const cutoff =
        now - CONFIG.rateLimit.windowMs;

    for (
        const [ip, entry]
        of ipAccess
    ) {
        entry.timestamps =
            entry.timestamps.filter(
                timestamp => timestamp > cutoff
            );

        if (
            entry.timestamps.length === 0 &&
            entry.lastSeen < cutoff
        ) {
            ipAccess.delete(ip);
        }
    }

    /*
     * Hard upper bound so a flood of unique IPs
     * cannot grow this Map forever.
     */
    if (
        ipAccess.size <=
        CONFIG.rateLimit.maxTrackedIPs
    ) {
        return;
    }

    const entries =
        Array.from(
            ipAccess.entries()
        ).sort(
            ([, a], [, b]) =>
                a.lastSeen - b.lastSeen
        );

    const removeCount =
        ipAccess.size -
        CONFIG.rateLimit.maxTrackedIPs;

    for (
        let i = 0;
        i < removeCount;
        i++
    ) {
        ipAccess.delete(
            entries[i][0]
        );
    }
}

/* ---------------------------------------------------------
   GEOIP LOOKUP
--------------------------------------------------------- */

function getCountryFromIP(
    ip: string
): string | null {
    if (
        CONFIG.geoIPRanges.length === 0
    ) {
        return null;
    }

    let ipNumber: number;

    try {
        ipNumber = ipToNumber(ip);
    } catch {
        return null;
    }

    let left = 0;
    let right =
        CONFIG.geoIPRanges.length - 1;

    while (left <= right) {
        const middle =
            (left + right) >> 1;

        const range =
            CONFIG.geoIPRanges[middle];

        if (ipNumber < range.start) {
            right = middle - 1;
            continue;
        }

        if (ipNumber > range.end) {
            left = middle + 1;
            continue;
        }

        return range.country;
    }

    return null;
}

/* ---------------------------------------------------------
   BLOCKING
--------------------------------------------------------- */

function isBlocked(
    ip: string
): boolean {
    if (isRateLimited(ip)) {
        return true;
    }

    if (
        CONFIG.abusiveIPs.has(ip)
    ) {
        return true;
    }

    const country =
        getCountryFromIP(ip);

    /*
     * Fail closed when GeoIP data is unavailable.
     *
     * If this is not what you want, change this
     * to `return false`.
     */
    if (!country) {
        return true;
    }

    return CONFIG.blockedCountries.has(
        country.toUpperCase()
    );
}

function handleAccess(
    ip: string
): boolean {
    return !isBlocked(ip);
}

/* ---------------------------------------------------------
   GEOIP LOADING
--------------------------------------------------------- */

function loadGeoIPRanges(
    ranges: RawGeoIPRange[]
): void {
    const parsed: GeoIPRange[] = [];

    for (const range of ranges) {
        try {
            const start =
                ipToNumber(range.start);

            const end =
                ipToNumber(range.end);

            if (end < start) {
                continue;
            }

            if (
                !range.country ||
                range.country.length !== 2
            ) {
                continue;
            }

            parsed.push({
                start,
                end,
                country:
                    range.country.toUpperCase()
            });
        } catch {
            // Ignore malformed ranges.
        }
    }

    parsed.sort(
        (a, b) => a.start - b.start
    );

    CONFIG.geoIPRanges = parsed;
}

/* ---------------------------------------------------------
   FETCH TEXT FEED
--------------------------------------------------------- */

async function fetchTextFeed(
    url: string
): Promise<string[]> {
    try {
        const response =
            await fetch(url, {
                cache: "no-store"
            });

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const text =
            await response.text();

        return text
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line =>
                line.length > 0 &&
                !line.startsWith("#") &&
                !line.startsWith(";")
            );
    } catch (error) {
        console.error(
            "[IPBlock] Failed to fetch feed:",
            url,
            error
        );

        return [];
    }
}

/* ---------------------------------------------------------
   LOAD ABUSE FEEDS
--------------------------------------------------------- */

async function loadAbusiveIPs(
    feeds: string[]
): Promise<void> {
    const results =
        await Promise.allSettled(
            feeds.map(fetchTextFeed)
        );

    const addresses =
        new Set<string>();

    for (const result of results) {
        if (
            result.status !== "fulfilled"
        ) {
            continue;
        }

        for (
            const address
            of result.value
        ) {
            /*
             * Only accept individual IPv4
             * addresses here.
             *
             * CIDR/range feeds need a separate
             * parser and shouldn't be silently
             * treated as individual addresses.
             */
            try {
                ipToNumber(address);
                addresses.add(address);
            } catch {
                continue;
            }
        }
    }

    CONFIG.abusiveIPs = addresses;

    console.log(
        `[IPBlock] Loaded ${addresses.size} abusive IPs.`
    );
}

/* ---------------------------------------------------------
   GEOIP FEED
--------------------------------------------------------- */

async function loadGeoIPFromPublicFeed(
    url: string
): Promise<void> {
    try {
        const response =
            await fetch(url, {
                cache: "no-store"
            });

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        if (!Array.isArray(data)) {
            throw new Error(
                "GeoIP feed is not an array"
            );
        }

        loadGeoIPRanges(
            data as RawGeoIPRange[]
        );

        console.log(
            `[IPBlock] Loaded ${CONFIG.geoIPRanges.length} GeoIP ranges.`
        );
    } catch (error) {
        console.error(
            "[IPBlock] Failed to load GeoIP feed:",
            error
        );

        /*
         * Important:
         * Don't destroy the existing working
         * database because a refresh failed.
         */
    }
}

/* ---------------------------------------------------------
   REFRESH
--------------------------------------------------------- */

let refreshRunning = false;

async function refreshFeeds(
    geoIPUrl: string,
    abuseFeeds: string[]
): Promise<void> {
    if (refreshRunning) {
        return;
    }

    refreshRunning = true;

    try {
        await Promise.all([
            loadGeoIPFromPublicFeed(
                geoIPUrl
            ),
            loadAbusiveIPs(
                abuseFeeds
            )
        ]);
    } finally {
        refreshRunning = false;
    }
}

/* ---------------------------------------------------------
   START REFRESH
--------------------------------------------------------- */

function scheduleFeedRefresh(
    geoIPUrl: string,
    abuseFeeds: string[],
    intervalMs: number
): ReturnType<typeof setInterval> {
    void refreshFeeds(
        geoIPUrl,
        abuseFeeds
    );

    return setInterval(() => {
        void refreshFeeds(
            geoIPUrl,
            abuseFeeds
        );
    }, intervalMs);
}

/* ---------------------------------------------------------
   CLEANUP TIMER
--------------------------------------------------------- */

setInterval(
    cleanupRateLimitCache,
    CONFIG.rateLimit.windowMs
);

/* ---------------------------------------------------------
   PUBLIC FEEDS
--------------------------------------------------------- */

const GEOIP_PUBLIC_URL =
    "https://raw.githubusercontent.com/hotcakex/official-iana-ip-blocks/main/country-split/ip4.json";

const ABUSE_PUBLIC_FEEDS: string[] = [
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/ciarmy.ipset",
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/dshield.netset",
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/ipsum.list",
    "https://raw.githubusercontent.com/iamshab/Malicious-IPs-Feed/main/AFAT-Clean-IPs.txt",
    "https://www.spamhaus.org/drop/drop_v4.json"
];

/* ---------------------------------------------------------
   STARTUP
--------------------------------------------------------- */

scheduleFeedRefresh(
    GEOIP_PUBLIC_URL,
    ABUSE_PUBLIC_FEEDS,
    10 * 60 * 1000
);
