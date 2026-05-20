type CopyFileLike = {
    name: string;
    type?: string;
    size: number;
    content: string;
};

class KrynetCopyFile {
    static MAX_COPY_SIZE = 500_000; // 500KB

    /**
     * Checks if a file is a text-based file type.
     */
    static isTextFile(file: CopyFileLike): boolean {
        return (
            file.type?.startsWith("text/") ??
            /\.(txt|md|json|js|ts|html|css|log)$/i.test(file.name)
        );
    }

    /**
     * Creates a copy button for a file element.
     */
    static createButton(file: CopyFileLike): HTMLElement | null {
        if (!this.isTextFile(file)) return null;

        const btn = document.createElement("div");

        btn.className = "kr-copy-btn";
        btn.setAttribute("role", "button");
        btn.tabIndex = 0;

        let copied = false;

        const update = () => {
            const disabled = file.size > this.MAX_COPY_SIZE;

            btn.textContent = copied ? "✔" : disabled ? "🚫" : "📋";
            btn.title = disabled
                ? "File too large to copy"
                : "Copy File Contents";

            btn.style.cursor = disabled ? "not-allowed" : "pointer";
            btn.style.opacity = disabled ? "0.5" : "1";
        };

        const doCopy = async () => {
            if (copied || file.size > this.MAX_COPY_SIZE) return;

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(file.content);
                } else {
                    // legacy fallback
                    const anyWindow = window as any;
                    if (anyWindow.clipboardData?.setData) {
                        anyWindow.clipboardData.setData("Text", file.content);
                    } else {
                        throw new Error("Clipboard API not available");
                    }
                }

                copied = true;
                update();

                this.toast("Copied file contents!");

                setTimeout(() => {
                    copied = false;
                    update();
                }, 2000);
            } catch {
                this.toast("Failed to copy.");
            }
        };

        btn.onclick = doCopy;

        // accessibility (keyboard support)
        btn.onkeydown = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                doCopy();
            }
        };

        update();
        return btn;
    }

    /**
     * Small toast notification system.
     */
    static toast(msg: string): void {
        const t = document.createElement("div");

        t.className = "kr-toast";
        t.textContent = msg;

        document.body.appendChild(t);

        setTimeout(() => {
            t.classList.add("fade");

            setTimeout(() => t.remove(), 300);
        }, 2000);
    }
}

/* -------------------------
   GLOBAL EXPORT (optional)
------------------------- */

declare global {
    interface Window {
        KrynetCopyFile?: typeof KrynetCopyFile;
    }
}

window.KrynetCopyFile = KrynetCopyFile;
