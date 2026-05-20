type RateLimitConfig = {
    maxRequests: number;
    windowMs: number;
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

type Config = {
    blockedCountries: Set<string>;
    geoIPRanges: GeoIPRange[];
    abusiveIPs: Set<string>;
    rateLimit: RateLimitConfig;
};

const CONFIG: Config = {
    blockedCountries: new Set([
        "CN", "RU", "IR", "KP", "BY", "SY", "CU", "VE",
        "TM", "EG", "SA", "AE", "TR", "PK"
    ]),
    geoIPRanges: [],
    abusiveIPs: new Set(),
    rateLimit: { maxRequests: 5, windowMs: 10_000 }
};

const ipAccess = new Map<string, number[]>();

/* -------------------------
   RATE LIMITING
------------------------- */

function isRateLimited(ip: string): boolean {
    const now = Date.now();

    let times = ipAccess.get(ip) ?? [];

    times = times.filter(t => now - t < CONFIG.rateLimit.windowMs);

    if (times.length >= CONFIG.rateLimit.maxRequests) {
        ipAccess.set(ip, times);
        return true;
    }

    times.push(now);
    ipAccess.set(ip, times);

    return false;
}

/* -------------------------
   IP CONVERSION (IPv4 only)
------------------------- */

function ipToNumber(ip: string): number {
    const parts = ip.split(".");

    if (parts.length !== 4) {
        throw new Error(`Invalid IPv4 address: ${ip}`);
    }

    return (
        (parseInt(parts[0], 10) << 24) |
        (parseInt(parts[1], 10) << 16) |
        (parseInt(parts[2], 10) << 8) |
        parseInt(parts[3], 10)
    ) >>> 0;
}

/* -------------------------
   GEOIP LOOKUP (binary search)
------------------------- */

function getCountryFromIP(ip: string): string | null {
    if (!CONFIG.geoIPRanges.length) return null;

    let ipNum: number;

    try {
        ipNum = ipToNumber(ip);
    } catch {
        return null;
    }

    let left = 0;
    let right = CONFIG.geoIPRanges.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const r = CONFIG.geoIPRanges[mid];

        if (ipNum < r.start) {
            right = mid - 1;
        } else if (ipNum > r.end) {
            left = mid + 1;
        } else {
            return r.country;
        }
    }

    return null;
}

/* -------------------------
   BLOCKING LOGIC
------------------------- */

function isBlocked(ip: string): boolean {
    if (isRateLimited(ip)) return true;
    if (CONFIG.abusiveIPs.has(ip)) return true;

    const country = getCountryFromIP(ip);
    if (!country) return true;

    return CONFIG.blockedCountries.has(country);
}

function handleAccess(ip: string): boolean {
    return !isBlocked(ip);
}

/* -------------------------
   GEOIP LOADING
------------------------- */

function loadGeoIPRanges(json: RawGeoIPRange[]): void {
    CONFIG.geoIPRanges = json
        .map(r => ({
            start: ipToNumber(r.start),
            end: ipToNumber(r.end),
            country: r.country
        }))
        .sort((a, b) => a.start - b.start);
}

/* -------------------------
   ABUSE FEED LOADING
------------------------- */

async function fetchAbuseFeed(url: string): Promise<string[]> {
    try {
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`Failed to fetch abuse feed: ${url}`);
        }

        const text = await res.text();

        return text
            .split("\n")
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("#"));
    } catch (e) {
        console.error("Failed to fetch abuse feed:", url, e);
        return [];
    }
}

async function loadAbusiveIPs(feeds: string[]): Promise<void> {
    const results = await Promise.all(feeds.map(fetchAbuseFeed));

    CONFIG.abusiveIPs = new Set(results.flat());
}

/* -------------------------
   GEOIP FEED LOADER
------------------------- */

async function loadGeoIPFromPublicFeed(url: string): Promise<void> {
    try {
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error("Failed to fetch GeoIP feed");
        }

        const json: RawGeoIPRange[] = await res.json();

        loadGeoIPRanges(json);
    } catch (e) {
        console.error("Failed to load GeoIP feed:", e);
    }
}

/* -------------------------
   REFRESH SCHEDULER
------------------------- */

function scheduleFeedRefresh(
    geoIPUrl: string,
    abuseFeeds: string[],
    intervalMs: number
): void {
    loadGeoIPFromPublicFeed(geoIPUrl);
    loadAbusiveIPs(abuseFeeds);

    setInterval(() => {
        loadGeoIPFromPublicFeed(geoIPUrl);
        loadAbusiveIPs(abuseFeeds);
    }, intervalMs);
}

/* -------------------------
   PUBLIC FEEDS
------------------------- */

const GEOIP_PUBLIC_URL =
    "https://raw.githubusercontent.com/hotcakex/official-iana-ip-blocks/main/country-split/ip4.json";

const ABUSE_PUBLIC_FEEDS: string[] = [
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/ciarmy.ipset",
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/dshield.netset",
    "https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/ipsum.list",
    "https://raw.githubusercontent.com/iamshab/Malicious-IPs-Feed/main/AFAT-Clean-IPs.txt",
    "https://www.spamhaus.org/drop/drop_v4.json"
];

/* -------------------------
   STARTUP
------------------------- */

scheduleFeedRefresh(
    GEOIP_PUBLIC_URL,
    ABUSE_PUBLIC_FEEDS,
    10 * 60 * 1000
);
