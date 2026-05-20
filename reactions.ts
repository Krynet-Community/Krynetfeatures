export type ReactionOptions = Record<string, unknown>;

type CategoryMap = Record<string, string[]>;

type ReactionMap = Map<string, number>;

export class Reactions {
    container: HTMLElement;
    options: ReactionOptions;

    reactionsMap: ReactionMap = new Map();
    emojis: string[] = [];
    categories: CategoryMap = {};

    lazySize = 50;

    currentCategory: string[] = [];
    currentIndex = 0;

    reactionsDiv!: HTMLDivElement;
    pickerButton!: HTMLButtonElement;
    pickerDiv!: HTMLDivElement;
    searchInput!: HTMLInputElement;
    tabsDiv!: HTMLDivElement;
    gridDiv!: HTMLDivElement;

    constructor(container: HTMLElement, options: ReactionOptions = {}) {
        this.container = container;
        this.options = options;

        this.init();
    }

    /* -------------------------
       INIT
    ------------------------- */

    async init(): Promise<void> {
        try {
            const res = await fetch(
                "https://unpkg.com/emoji.json@13.1.0/emoji.json"
            );

            if (!res.ok) {
                throw new Error("Failed to fetch emojis");
            }

            const all: { emoji: string }[] = await res.json();

            this.emojis = all.map(e => e.emoji);

            const sliceSize = 60;

            const catNames = [
                "Smileys",
                "Animals",
                "Food",
                "Activities",
                "Travel",
                "Objects",
                "Symbols",
                "Flags"
            ];

            catNames.forEach((name, i) => {
                this.categories[name] = this.emojis.slice(
                    i * sliceSize,
                    (i + 1) * sliceSize
                );
            });

            this.renderUI();
        } catch (err) {
            console.error("Reactions init error:", err);
        }
    }

    /* -------------------------
       UI RENDER
    ------------------------- */

    renderUI(): void {
        this.reactionsDiv = document.createElement("div");

        this.reactionsDiv.className = "reactions";

        Object.assign(this.reactionsDiv.style, {
            display: "flex",
            gap: "6px",
            padding: "6px 10px",
            background: "#202225",
            borderRadius: "20px",
            marginTop: "6px"
        } as CSSStyleDeclaration);

        // default emojis
        this.emojis.slice(0, 6).forEach(e => this.addReactionButton(e));

        /* picker button */
        this.pickerButton = document.createElement("button");
        this.pickerButton.textContent = "😊";

        Object.assign(this.pickerButton.style, {
            marginLeft: "8px",
            cursor: "pointer"
        } as CSSStyleDeclaration);

        this.pickerButton.addEventListener("click", () => this.togglePicker());

        this.reactionsDiv.appendChild(this.pickerButton);

        /* picker panel */
        this.pickerDiv = document.createElement("div");

        this.pickerDiv.style.display = "none";

        Object.assign(this.pickerDiv.style, {
            position: "absolute",
            flexDirection: "column",
            width: "320px",
            maxHeight: "400px",
            background: "#202225",
            borderRadius: "10px",
            padding: "5px",
            boxShadow: "0 2px 15px rgba(0,0,0,0.5)",
            zIndex: "1000",
            overflow: "hidden"
        } as CSSStyleDeclaration);

        /* search */
        this.searchInput = document.createElement("input");

        this.searchInput.type = "text";
        this.searchInput.placeholder = "Search emojis...";

        Object.assign(this.searchInput.style, {
            width: "calc(100% - 10px)",
            marginBottom: "5px",
            padding: "4px 6px",
            borderRadius: "5px",
            border: "none"
        } as CSSStyleDeclaration);

        this.searchInput.addEventListener("input", () => this.filterEmojis());

        this.pickerDiv.appendChild(this.searchInput);

        /* tabs */
        this.tabsDiv = document.createElement("div");

        Object.assign(this.tabsDiv.style, {
            display: "flex",
            gap: "4px",
            marginBottom: "4px"
        } as CSSStyleDeclaration);

        Object.keys(this.categories).forEach(cat => {
            const tab = document.createElement("button");
            tab.textContent = cat;

            Object.assign(tab.style, {
                flex: "1",
                background: "#2f3136",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "4px"
            } as CSSStyleDeclaration);

            tab.addEventListener("click", () => this.loadCategory(cat));

            this.tabsDiv.appendChild(tab);
        });

        this.pickerDiv.appendChild(this.tabsDiv);

        /* grid */
        this.gridDiv = document.createElement("div");

        Object.assign(this.gridDiv.style, {
            display: "flex",
            flexWrap: "wrap",
            maxHeight: "320px",
            overflowY: "auto"
        } as CSSStyleDeclaration);

        this.pickerDiv.appendChild(this.gridDiv);

        document.body.appendChild(this.pickerDiv);
        this.container.appendChild(this.reactionsDiv);

        this.loadCategory(Object.keys(this.categories)[0]);
    }

    /* -------------------------
       CATEGORY LOADING
    ------------------------- */

    loadCategory(category: string): void {
        this.currentCategory = this.categories[category] || [];
        this.currentIndex = 0;

        this.gridDiv.innerHTML = "";

        this.lazyLoadEmojis();
    }

    /* -------------------------
       LAZY LOADING
    ------------------------- */

    lazyLoadEmojis(): void {
        if (!this.currentCategory.length) return;

        const batch = this.currentCategory.slice(
            this.currentIndex,
            this.currentIndex + this.lazySize
        );

        batch.forEach(e => this.createEmojiButton(e));

        this.currentIndex += this.lazySize;

        if (this.currentIndex < this.currentCategory.length) {
            const sentinel = document.createElement("div");
            sentinel.style.height = "1px";

            this.gridDiv.appendChild(sentinel);

            const observer = new IntersectionObserver(entries => {
                if (entries[0].isIntersecting) {
                    observer.disconnect();
                    this.lazyLoadEmojis();
                }
            });

            observer.observe(sentinel);
        }
    }

    /* -------------------------
       EMOJI BUTTON
    ------------------------- */

    createEmojiButton(emoji: string): void {
        const btn = document.createElement("button");

        btn.textContent = emoji;

        Object.assign(btn.style, {
            fontSize: "22px",
            margin: "2px",
            padding: "2px 4px",
            border: "none",
            background: "none",
            cursor: "pointer",
            transition: "transform 0.1s"
        } as CSSStyleDeclaration);

        btn.addEventListener("mouseenter", () => {
            btn.style.transform = "scale(1.3)";
        });

        btn.addEventListener("mouseleave", () => {
            btn.style.transform = "scale(1)";
        });

        btn.addEventListener("click", () => {
            this.addReactionButton(emoji);
            this.hidePicker();
        });

        this.gridDiv.appendChild(btn);
    }

    /* -------------------------
       FILTER
    ------------------------- */

    filterEmojis(): void {
        const q = this.searchInput.value.trim();

        const filtered = q
            ? this.emojis.filter(e => e.includes(q))
            : this.currentCategory.slice(0, this.lazySize);

        this.gridDiv.innerHTML = "";

        filtered.forEach(e => this.createEmojiButton(e));
    }

    /* -------------------------
       REACTION BUTTONS
    ------------------------- */

    addReactionButton(emoji: string): void {
        if (this.reactionsMap.has(emoji)) return;

        const reaction = document.createElement("div");

        reaction.className = "reaction";
        reaction.innerHTML = `${emoji} <span>0</span>`;
        reaction.dataset.count = "0";

        Object.assign(reaction.style, {
            display: "flex",
            alignItems: "center",
            gap: "4px",
            padding: "2px 6px",
            background: "#2f3136",
            borderRadius: "16px",
            cursor: "pointer",
            transition: "transform 0.1s"
        } as CSSStyleDeclaration);

        reaction.addEventListener("mouseenter", () => {
            reaction.style.transform = "scale(1.2)";
        });

        reaction.addEventListener("mouseleave", () => {
            reaction.style.transform = "scale(1)";
        });

        reaction.addEventListener("click", () => {
            let c = parseInt(reaction.dataset.count || "0", 10);
            c++;

            reaction.dataset.count = String(c);

            const span = reaction.querySelector("span");
            if (span) span.textContent = String(c);

            this.reactionsMap.set(emoji, c);
        });

        this.reactionsDiv.insertBefore(reaction, this.pickerButton);
    }

    /* -------------------------
       PICKER
    ------------------------- */

    togglePicker(): void {
        this.pickerDiv.style.display === "flex"
            ? this.hidePicker()
            : this.showPicker();
    }

    showPicker(): void {
        const rect = this.pickerButton.getBoundingClientRect();

        Object.assign(this.pickerDiv.style, {
            left: `${rect.left}px`,
            top: `${rect.bottom}px`,
            display: "flex"
        } as CSSStyleDeclaration);
    }

    hidePicker(): void {
        this.pickerDiv.style.display = "none";
    }

    /* -------------------------
       DATA
    ------------------------- */

    getCounts(): Record<string, number> {
        return Object.fromEntries(this.reactionsMap);
    }
}
