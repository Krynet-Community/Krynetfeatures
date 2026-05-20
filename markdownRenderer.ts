import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
import { getHighlighter } from "https://cdn.jsdelivr.net/npm/shiki@0.12.0/dist/index.js";

/* -------------------------
   TYPES
------------------------- */

type CacheMap = Map<string, string>;

type KrynetCaches = {
    mentions: CacheMap;
    roles: CacheMap;
    channels: CacheMap;
    emojis: CacheMap;
    general: CacheMap;
};

type Highlighter = Awaited<ReturnType<typeof getHighlighter>>;

/* -------------------------
   HELPERS
------------------------- */

const escapeHtml = (s: string): string =>
    s.replace(
        /[&<>"']/g,
        m =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[m]!)
    );

/* -------------------------
   CORE MODULE
------------------------- */

export const KrynetMarkdown = {
    highlighter: null as Highlighter | null,
    renderer: null as marked.Renderer | null,
    cssInjected: false,

    cacheTTL: 500,

    caches: {
        mentions: new Map<string, string>(),
        roles: new Map<string, string>(),
        channels: new Map<string, string>(),
        emojis: new Map<string, string>(),
        general: new Map<string, string>()
    } as KrynetCaches,

    /* -------------------------
       CSS
    ------------------------- */

    injectCSS(): void {
        if (this.cssInjected) return;

        const style = document.createElement("style");

        style.textContent = `
.kr-codeblock{background:#1e1e2f;padding:8px 12px;border-radius:6px;font-family:"Fira Code",monospace;font-size:14px;margin:6px 0;overflow-x:auto;}
.kr-inline{background:#2a2e3f;padding:2px 6px;border-radius:4px;font-family:"Fira Code",monospace;font-size:13px;}
.kr-spoiler{background:#222;color:transparent;border-radius:3px;padding:0 4px;cursor:pointer;}
.kr-spoiler:hover{color:#fff;}
.kr-mention{color:#5b9dff;background:rgba(88,101,242,.15);padding:1px 4px;border-radius:3px;}
.kr-channel{color:#8ab4ff;}
.kr-role{color:#f47fff;}
.kr-emoji{width:20px;height:20px;vertical-align:middle;}
.kr-markdown blockquote{border-left:3px solid #555;padding-left:8px;color:#ccc;}
.kr-markdown ul,.kr-markdown ol{padding-left:20px;}
.kr-markdown a{color:#4ea3ff;text-decoration:none;}
.kr-markdown a:hover{text-decoration:underline;}
.kr-markdown img{max-width:100%;border-radius:6px;}
.kr-multiline-quote{border-left:3px solid #555;margin:0;padding-left:8px;color:#ccc;white-space:pre-wrap;}
`;

        document.head.appendChild(style);
        this.cssInjected = true;
    },

    /* -------------------------
       INIT
    ------------------------- */

    async init(theme: string = "nord"): Promise<void> {
        this.injectCSS();

        if (!this.highlighter) {
            this.highlighter = await getHighlighter({ theme });
        }

        this.renderer = new marked.Renderer();

        this.renderer.code = (code: string, lang?: string) => {
            try {
                return this.highlighter!.codeToHtml(code, {
                    lang: lang || "text"
                });
            } catch {
                return `<pre class="kr-codeblock"><code>${escapeHtml(
                    code
                )}</code></pre>`;
            }
        };

        this.renderer.codespan = (code: string) =>
            `<code class="kr-inline">${escapeHtml(code)}</code>`;

        marked.setOptions({
            renderer: this.renderer,
            gfm: true,
            breaks: true
        });
    },

    /* -------------------------
       CACHE
    ------------------------- */

    ephemeralSet(cache: CacheMap, key: string, value: string): void {
        cache.set(key, value);

        setTimeout(() => cache.delete(key), this.cacheTTL);
    },

    /* -------------------------
       STREAM PARSER
    ------------------------- */

    async *streamParse(md: string): AsyncGenerator<string> {
        if (!this.renderer) await this.init();

        const lines = md.split(/\r?\n/);

        let inQuote = false;
        let quoteBuffer: string[] = [];

        for (let line of lines) {
            let chunk = "";

            /* multi-line quote start */
            if (line.startsWith(">>>")) {
                inQuote = true;
                quoteBuffer.push(line.slice(3).trim());
                continue;
            }

            if (inQuote) {
                if (line.trim() === "") {
                    chunk = `<blockquote class="kr-multiline-quote">${quoteBuffer
                        .map(escapeHtml)
                        .join("<br>")}</blockquote>`;

                    quoteBuffer = [];
                    inQuote = false;

                    yield chunk;
                    continue;
                }

                quoteBuffer.push(line);
                continue;
            }

            chunk = line;

            /* -------------------------
               INLINE TRANSFORMS
            ------------------------- */

            chunk = chunk
                .replace(
                    /\|\|(.+?)\|\|/g,
                    `<span class="kr-spoiler">$1</span>`
                )

                .replace(/<@!?(\d+)>/g, (_, id: string) => {
                    if (!this.caches.mentions.has(id)) {
                        this.ephemeralSet(
                            this.caches.mentions,
                            id,
                            `<span class="kr-mention" data-user="${id}">@user</span>`
                        );
                    }
                    return this.caches.mentions.get(id)!;
                })

                .replace(/<#(\d+)>/g, (_, id: string) => {
                    if (!this.caches.channels.has(id)) {
                        this.ephemeralSet(
                            this.caches.channels,
                            id,
                            `<span class="kr-channel" data-channel="${id}">#channel</span>`
                        );
                    }
                    return this.caches.channels.get(id)!;
                })

                .replace(/<@&(\d+)>/g, (_, id: string) => {
                    if (!this.caches.roles.has(id)) {
                        this.ephemeralSet(
                            this.caches.roles,
                            id,
                            `<span class="kr-role" data-role="${id}">@role</span>`
                        );
                    }
                    return this.caches.roles.get(id)!;
                })

                .replace(
                    /<a?:([a-zA-Z0-9_]+):(\d+)>/g,
                    (_, name: string, id: string) => {
                        if (!this.caches.emojis.has(id)) {
                            this.ephemeralSet(
                                this.caches.emojis,
                                id,
                                `<img class="kr-emoji" src="https://cdn.discordapp.com/emojis/${id}.webp" alt=":${name}:">`
                            );
                        }
                        return this.caches.emojis.get(id)!;
                    }
                )

                .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_, ts: string) => {
                    const d = new Date(Number(ts) * 1000);
                    return `<time datetime="${d.toISOString()}">${d.toLocaleString()}</time>`;
                });

            yield chunk;
        }

        /* flush remaining quote buffer */
        if (quoteBuffer.length) {
            yield `<blockquote class="kr-multiline-quote">${quoteBuffer
                .map(escapeHtml)
                .join("<br>")}</blockquote>`;
        }
    },

    /* -------------------------
       RENDER FINAL HTML
    ------------------------- */

    async render(md: string): Promise<string> {
        let html = "";

        for await (const chunk of this.streamParse(md)) {
            html += chunk + "\n";
        }

        return marked.parse(html) as string;
    }
};
