(() => {
    const RULES_URL =
        "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";

    type RuleSet = {
        name: string;
        urlPattern: RegExp;
        rules?: RegExp[];
        rawRules?: RegExp[];
        exceptions?: RegExp[];
    };

    type ClearURLsData = {
        providers: Record<
            string,
            {
                urlPattern: string;
                rules?: string[];
                rawRules?: string[];
                exceptions?: string[];
            }
        >;
    };

    let rules: RuleSet[] = [];

    /* -------------------------
       LOAD RULES
    ------------------------- */

    async function loadRules(): Promise<void> {
        try {
            const res = await fetch(RULES_URL);
            const data: ClearURLsData = await res.json();

            rules = Object.entries(data.providers).map(([name, p]) => ({
                name,
                urlPattern: new RegExp(p.urlPattern, "i"),
                rules: p.rules?.map((r) => new RegExp(r, "i")),
                rawRules: p.rawRules?.map((r) => new RegExp(r, "i")),
                exceptions: p.exceptions?.map((r) => new RegExp(r, "i"))
            }));

            console.log("[ClearURLs] Rules loaded:", rules.length);
        } catch (e) {
            console.error("[ClearURLs] Failed to load rules", e);
        }
    }

    /* -------------------------
       CLEAN URL
    ------------------------- */

    function cleanUrl(href: string): string {
        let url: URL;

        try {
            url = new URL(href);
        } catch {
            return href;
        }

        if (!url.searchParams || !url.searchParams.toString()) {
            return href;
        }

        for (const r of rules) {
            if (!r.urlPattern.test(url.href)) continue;

            if (r.exceptions?.some((ex) => ex.test(url.href))) continue;

            if (r.rules) {
                for (const [param] of Array.from(url.searchParams.entries())) {
                    if (r.rules.some((rx) => rx.test(param))) {
                        url.searchParams.delete(param);
                    }
                }
            }

            if (r.rawRules) {
                let s = url.href;
                for (const rx of r.rawRules) {
                    s = s.replace(rx, "");
                }

                try {
                    url = new URL(s);
                } catch {
                    // ignore invalid rebuild
                }
            }
        }

        return url.toString();
    }

    /* -------------------------
       URL MATCHING
    ------------------------- */

    const URL_RE =
        /(https?:\/\/[^\s<]+[^<.,:;"'>)\]\s])/g;

    function cleanText(text: string): string {
        return text.replace(URL_RE, cleanUrl);
    }

    /* -------------------------
       DOM HELPERS
    ------------------------- */

    type Editable =
        | HTMLTextAreaElement
        | (HTMLElement & { innerText: string });

    function isEditable(el: Element): el is HTMLTextAreaElement | HTMLElement {
        return (
            el instanceof HTMLTextAreaElement ||
            (el instanceof HTMLElement &&
                el.getAttribute("contenteditable") === "true")
        );
    }

    /* -------------------------
       HOOK SEND / PASTE
    ------------------------- */

    function hookSend(): void {
        document.addEventListener("submit", (e: SubmitEvent) => {
            const form = e.target as HTMLFormElement | null;
            if (!form) return;

            const target = form.querySelector<
                HTMLTextAreaElement | HTMLElement
            >("textarea, [contenteditable='true']");

            if (!target) return;

            if (target instanceof HTMLTextAreaElement) {
                target.value = cleanText(target.value);
            } else {
                target.innerText = cleanText(target.innerText);
            }
        });

        document.addEventListener("paste", (e: ClipboardEvent) => {
            const target = e.target as Element | null;
            if (!target || !isEditable(target)) return;

            setTimeout(() => {
                if (target instanceof HTMLTextAreaElement) {
                    target.value = cleanText(target.value);
                } else {
                    target.innerText = cleanText(target.innerText);
                }
            }, 0);
        });
    }

    /* -------------------------
       CLEAN RENDERED MESSAGES
    ------------------------- */

    type MessageEl = HTMLElement & {
        __clearurls?: boolean;
    };

    const URL_RE_GLOBAL = URL_RE;

    function cleanRendered(): void {
        document.querySelectorAll<HTMLElement>(".message").forEach((msg) => {
            const m = msg as MessageEl;

            if (m.__clearurls) return;

            m.innerHTML = m.innerHTML.replace(URL_RE_GLOBAL, cleanUrl);
            m.__clearurls = true;
        });
    }

    /* -------------------------
       INIT
    ------------------------- */

    async function init(): Promise<void> {
        await loadRules();

        hookSend();
        cleanRendered();

        if (typeof MutationObserver !== "undefined") {
            new MutationObserver(cleanRendered).observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    init();
})();
