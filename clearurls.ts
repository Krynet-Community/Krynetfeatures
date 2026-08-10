(() => {
    "use strict";

    /* ---------------------------------------------------------
       CONFIG
    --------------------------------------------------------- */

    const RULES_URL =
        "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";

    const MESSAGE_SELECTOR =
        ".message";

    const EDITABLE_SELECTOR =
        "textarea, [contenteditable='true']";

    const URL_RE =
        /https?:\/\/[^\s<]+[^<.,:;"'>)\]\s]/gi;

    /* ---------------------------------------------------------
       TYPES
    --------------------------------------------------------- */

    type ProviderData = {
        urlPattern: string;
        rules?: string[];
        rawRules?: string[];
        exceptions?: string[];
    };

    type ClearURLsData = {
        providers: Record<
            string,
            ProviderData
        >;
    };

    type RuleSet = {
        name: string;
        urlPattern: RegExp;
        rules: RegExp[];
        rawRules: RegExp[];
        exceptions: RegExp[];
    };

    type MessageElement = HTMLElement & {
        __clearURLsProcessed?: boolean;
    };

    type EditableElement =
        | HTMLTextAreaElement
        | HTMLElement;

    /* ---------------------------------------------------------
       STATE
    --------------------------------------------------------- */

    let rules: RuleSet[] = [];

    let rulesLoaded = false;

    let rulesLoading: Promise<void> | null = null;

    let scanTimer:
        ReturnType<typeof setTimeout> | null = null;

    /* ---------------------------------------------------------
       REGEX HELPERS
    --------------------------------------------------------- */

    function createRegex(
        pattern: string
    ): RegExp | null {
        try {
            return new RegExp(
                pattern,
                "i"
            );
        } catch (error) {
            console.warn(
                "[ClearURLs] Invalid rule:",
                pattern,
                error
            );

            return null;
        }
    }

    function createRegexList(
        patterns?: string[]
    ): RegExp[] {
        if (!patterns) {
            return [];
        }

        const result: RegExp[] = [];

        for (const pattern of patterns) {
            const regex =
                createRegex(pattern);

            if (regex) {
                result.push(regex);
            }
        }

        return result;
    }

    /* ---------------------------------------------------------
       LOAD RULES
    --------------------------------------------------------- */

    async function loadRules(): Promise<void> {
        if (rulesLoaded) {
            return;
        }

        if (rulesLoading) {
            return rulesLoading;
        }

        rulesLoading = (async () => {
            try {
                const response =
                    await fetch(RULES_URL, {
                        cache: "no-cache"
                    });

                if (!response.ok) {
                    throw new Error(
                        `HTTP ${response.status}`
                    );
                }

                const data =
                    await response.json() as ClearURLsData;

                if (
                    !data?.providers ||
                    typeof data.providers !== "object"
                ) {
                    throw new Error(
                        "Invalid ClearURLs rules format"
                    );
                }

                const loadedRules: RuleSet[] = [];

                for (
                    const [name, provider]
                    of Object.entries(data.providers)
                ) {
                    const urlPattern =
                        createRegex(
                            provider.urlPattern
                        );

                    if (!urlPattern) {
                        continue;
                    }

                    loadedRules.push({
                        name,
                        urlPattern,
                        rules: createRegexList(
                            provider.rules
                        ),
                        rawRules: createRegexList(
                            provider.rawRules
                        ),
                        exceptions:
                            createRegexList(
                                provider.exceptions
                            )
                    });
                }

                rules = loadedRules;
                rulesLoaded = true;

                console.log(
                    `[ClearURLs] Loaded ${rules.length} providers.`
                );
            } catch (error) {
                console.error(
                    "[ClearURLs] Failed to load rules:",
                    error
                );
            } finally {
                rulesLoading = null;
            }
        })();

        return rulesLoading;
    }

    /* ---------------------------------------------------------
       RESET REGEX
    --------------------------------------------------------- */

    function resetRegex(
        regex: RegExp
    ): void {
        regex.lastIndex = 0;
    }

    function regexTest(
        regex: RegExp,
        value: string
    ): boolean {
        resetRegex(regex);
        return regex.test(value);
    }

    /* ---------------------------------------------------------
       CLEAN URL
    --------------------------------------------------------- */

    function cleanUrl(
        href: string
    ): string {
        let url: URL;

        try {
            url = new URL(href);
        } catch {
            return href;
        }

        if (!url.search) {
            return href;
        }

        let changed = false;

        for (const rule of rules) {
            if (
                !regexTest(
                    rule.urlPattern,
                    url.href
                )
            ) {
                continue;
            }

            const hasException =
                rule.exceptions.some(
                    exception =>
                        regexTest(
                            exception,
                            url.href
                        )
                );

            if (hasException) {
                continue;
            }

            /* -------------------------------------------------
               Parameter rules
            ------------------------------------------------- */

            if (rule.rules.length) {
                for (
                    const key
                    of Array.from(
                        url.searchParams.keys()
                    )
                ) {
                    const shouldRemove =
                        rule.rules.some(
                            regex =>
                                regexTest(
                                    regex,
                                    key
                                )
                        );

                    if (!shouldRemove) {
                        continue;
                    }

                    url.searchParams.delete(key);
                    changed = true;
                }
            }

            /* -------------------------------------------------
               Raw URL rules
            ------------------------------------------------- */

            if (rule.rawRules.length) {
                let value =
                    url.toString();

                for (
                    const regex
                    of rule.rawRules
                ) {
                    const next =
                        value.replace(
                            regex,
                            ""
                        );

                    if (next !== value) {
                        changed = true;
                        value = next;
                    }
                }

                try {
                    url = new URL(value);
                } catch {
                    // Keep the last valid URL.
                }
            }
        }

        return changed
            ? url.toString()
            : href;
    }

    /* ---------------------------------------------------------
       CLEAN TEXT
    --------------------------------------------------------- */

    function cleanText(
        text: string
    ): string {
        if (
            !text ||
            !rules.length
        ) {
            return text;
        }

        return text.replace(
            URL_RE,
            match => cleanUrl(match)
        );
    }

    /* ---------------------------------------------------------
       EDITABLE ELEMENTS
    --------------------------------------------------------- */

    function isEditable(
        element: Element | null
    ): element is EditableElement {
        if (!element) {
            return false;
        }

        if (
            element instanceof
            HTMLTextAreaElement
        ) {
            return true;
        }

        return (
            element instanceof HTMLElement &&
            element.isContentEditable
        );
    }

    function cleanEditable(
        element: EditableElement
    ): void {
        if (
            element instanceof
            HTMLTextAreaElement
        ) {
            const cleaned =
                cleanText(element.value);

            if (cleaned !== element.value) {
                element.value = cleaned;
            }

            return;
        }

        cleanContentEditable(element);
    }

    /* ---------------------------------------------------------
       CONTENTEDITABLE
    --------------------------------------------------------- */

    function cleanContentEditable(
        element: HTMLElement
    ): void {
        const walker =
            document.createTreeWalker(
                element,
                NodeFilter.SHOW_TEXT
            );

        const nodes: Text[] = [];

        let node:
            | Node
            | null;

        while (
            (node = walker.nextNode())
        ) {
            if (
                node instanceof Text &&
                node.nodeValue
            ) {
                nodes.push(node);
            }
        }

        for (const textNode of nodes) {
            const original =
                textNode.nodeValue ?? "";

            const cleaned =
                cleanText(original);

            if (cleaned !== original) {
                textNode.nodeValue =
                    cleaned;
            }
        }
    }

    /* ---------------------------------------------------------
       SUBMIT
    --------------------------------------------------------- */

    function hookSubmit(): void {
        document.addEventListener(
            "submit",
            event => {
                const form =
                    event.target;

                if (
                    !(form instanceof
                    HTMLFormElement)
                ) {
                    return;
                }

                const editable =
                    form.querySelector<EditableElement>(
                        EDITABLE_SELECTOR
                    );

                if (!editable) {
                    return;
                }

                cleanEditable(editable);
            },
            true
        );
    }

    /* ---------------------------------------------------------
       PASTE
    --------------------------------------------------------- */

    function hookPaste(): void {
        document.addEventListener(
            "paste",
            event => {
                const target =
                    event.target;

                if (
                    !(target instanceof
                    Element)
                ) {
                    return;
                }

                if (!isEditable(target)) {
                    return;
                }

                // Let the browser insert the paste first.
                queueMicrotask(() => {
                    cleanEditable(target);
                });
            }
        );
    }

    /* ---------------------------------------------------------
       RENDERED MESSAGES
    --------------------------------------------------------- */

    function cleanMessage(
        message: MessageElement
    ): void {
        if (
            message.__clearURLsProcessed
        ) {
            return;
        }

        cleanContentEditable(message);

        message.__clearURLsProcessed =
            true;
    }

    function cleanRendered(
        root: ParentNode = document
    ): void {
        if (
            root instanceof HTMLElement &&
            root.matches(MESSAGE_SELECTOR)
        ) {
            cleanMessage(
                root as MessageElement
            );
        }

        root
            .querySelectorAll<HTMLElement>(
                MESSAGE_SELECTOR
            )
            .forEach(message => {
                cleanMessage(
                    message as MessageElement
                );
            });
    }

    /* ---------------------------------------------------------
       DYNAMIC MESSAGE HANDLING
    --------------------------------------------------------- */

    function scheduleScan(): void {
        if (scanTimer !== null) {
            return;
        }

        scanTimer = setTimeout(() => {
            scanTimer = null;
            cleanRendered();
        }, 50);
    }

    const observer =
        new MutationObserver(
            mutations => {
                for (const mutation of mutations) {
                    if (
                        mutation.addedNodes.length
                    ) {
                        scheduleScan();
                        return;
                    }
                }
            }
        );

    /* ---------------------------------------------------------
       INITIALIZE
    --------------------------------------------------------- */

    async function init(): Promise<void> {
        await loadRules();

        if (!rulesLoaded) {
            console.warn(
                "[ClearURLs] Running without rules."
            );
        }

        hookSubmit();
        hookPaste();

        cleanRendered();

        if (!document.body) {
            return;
        }

        observer.observe(
            document.body,
            {
                childList: true,
                subtree: true
            }
        );

        console.log(
            "[ClearURLs] URL cleaning active."
        );
    }

    /* ---------------------------------------------------------
       START
    --------------------------------------------------------- */

    if (
        document.readyState ===
        "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            () => {
                void init();
            },
            { once: true }
        );
    } else {
        void init();
    }
})();
