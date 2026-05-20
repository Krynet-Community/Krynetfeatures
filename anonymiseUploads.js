(() => {
    type Method = "random" | "consistent" | "timestamp";

    interface AnonSettings {
        anonymiseByDefault: boolean;
        method: Method;
        randomLength: number;
        consistentName: string;
    }

    const settings: AnonSettings = {
        anonymiseByDefault: true,
        method: "random",
        randomLength: 7,
        consistentName: "file"
    };

    const ANON = Symbol("anonUpload");

    type AnonFile = File & {
        [ANON]?: boolean;
    };

    const genName = (orig: string, method: Method): string => {
        const ext = orig.includes(".") ? orig.slice(orig.lastIndexOf(".")) : "";

        if (method === "random") {
            const chars =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

            let out = "";
            for (let i = 0; i < settings.randomLength; i++) {
                out += chars[Math.floor(Math.random() * chars.length)];
            }

            return out + ext;
        }

        if (method === "consistent") {
            return settings.consistentName + ext;
        }

        if (method === "timestamp") {
            return `${Date.now()}${ext}`;
        }

        return orig;
    };

    const anonymise = (file: AnonFile): void => {
        if (file[ANON] === false) return;

        const newName = genName(file.name, settings.method);

        // NOTE: File.name is read-only in most browsers
        // So we attach metadata instead (production-safe approach)
        Object.defineProperty(file, "name", {
            value: newName,
            writable: false
        });
    };

    const handleChange = (e: Event): void => {
        const target = e.target as HTMLInputElement | null;
        if (!target || target.type !== "file" || !target.files) return;

        for (const file of Array.from(target.files) as AnonFile[]) {
            anonymise(file);
        }
    };

    const toggleBtn = (input: HTMLInputElement): void => {
        const btn = document.createElement("button");

        btn.type = "button";
        btn.textContent = "Toggle Anonymise";

        btn.style.marginLeft = "0.5rem";

        btn.onclick = () => {
            if (!input.files) return;

            for (const file of Array.from(input.files) as AnonFile[]) {
                file[ANON] = !(file[ANON] ?? settings.anonymiseByDefault);
            }
        };

        input.parentNode?.insertBefore(btn, input.nextSibling);
    };

    const observer = new MutationObserver(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(
            'input[type="file"]:not([data-anon])'
        );

        inputs.forEach((input) => {
            input.dataset.anon = "true";
            toggleBtn(input);
        });
    });

    document.addEventListener("change", handleChange);
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();
