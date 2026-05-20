(() => {
    const BASE: string =
        "https://krynet-llc.github.io/KrySearch/UI/index.html";

    const DEFAULT_ENGINE: string = "default";

    const params: URLSearchParams = new URLSearchParams(
        window.location.search
    );

    const url: string | null = params.get("url");
    const q: string | null = params.get("q");
    const engine: string =
        params.get("engine") || DEFAULT_ENGINE;

    // Build redirect URL
    let redirectUrl: string | null = null;

    if (url) {
        redirectUrl = `${BASE}?url=${encodeURIComponent(
            url
        )}&engine=${encodeURIComponent(engine)}`;
    } else if (q) {
        const isUrl = /^https?:\/\//i.test(q);

        redirectUrl = isUrl
            ? `${BASE}?url=${encodeURIComponent(
                  q
              )}&engine=${encodeURIComponent(engine)}`
            : `${BASE}?q=${encodeURIComponent(
                  q
              )}&engine=${encodeURIComponent(engine)}`;
    }

    // Only redirect if needed
    if (
        redirectUrl &&
        window.location.href !== redirectUrl
    ) {
        window.location.replace(redirectUrl);
    }
})();
