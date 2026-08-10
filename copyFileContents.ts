type CopyFileLike = {
    name: string;
    type?: string;
    size: number;
    content: string;
};

class KrynetCopyFile {
    static readonly MAX_COPY_SIZE = 500_000;

    private static readonly TEXT_EXTENSIONS =
        /\.(txt|md|markdown|json|js|jsx|ts|tsx|html|htm|css|scss|sass|less|xml|csv|log|yaml|yml|toml|ini|conf|sh|bash|py|java|c|cpp|h|hpp|rs|go|php|rb|swift|kt|sql)$/i;

    private static readonly TOAST_DURATION = 2000;

    private static toastElement: HTMLElement | null = null;
    private static toastTimer:
        ReturnType<typeof setTimeout> | null = null;
    private static fadeTimer:
        ReturnType<typeof setTimeout> | null = null;

    /* ---------------------------------------------------------
       FILE DETECTION
    --------------------------------------------------------- */

    /**
     * Returns true when the file appears to contain text.
     */
    static isTextFile(
        file: CopyFileLike
    ): boolean {
        const mimeType =
            file.type?.toLowerCase() ?? "";

        if (mimeType.startsWith("text/")) {
            return true;
        }

        // Common application/* types that are still text.
        const textMimeTypes = new Set([
            "application/json",
            "application/javascript",
            "application/typescript",
            "application/xml",
            "application/x-yaml",
            "application/yaml",
            "application/sql"
        ]);

        if (textMimeTypes.has(mimeType)) {
            return true;
        }

        return this.TEXT_EXTENSIONS.test(
            file.name
        );
    }

    /* ---------------------------------------------------------
       SIZE CHECK
    --------------------------------------------------------- */

    /**
     * Checks both declared file size and actual content size.
     */
    static canCopy(
        file: CopyFileLike
    ): boolean {
        if (
            file.size >
            this.MAX_COPY_SIZE
        ) {
            return false;
        }

        // UTF-8 byte length is more accurate than
        // JavaScript string.length for clipboard limits.
        try {
            const bytes =
                new TextEncoder().encode(
                    file.content
                ).byteLength;

            return (
                bytes <=
                this.MAX_COPY_SIZE
            );
        } catch {
            return (
                file.content.length <=
                this.MAX_COPY_SIZE
            );
        }
    }

    /* ---------------------------------------------------------
       BUTTON
    --------------------------------------------------------- */

    /**
     * Creates a copy button for a text file.
     */
    static createButton(
        file: CopyFileLike
    ): HTMLButtonElement | null {
        if (!this.isTextFile(file)) {
            return null;
        }

        const button =
            document.createElement("button");

        button.type = "button";
        button.className = "kr-copy-btn";

        let copied = false;
        let copyTimer:
            ReturnType<typeof setTimeout> | null =
                null;

        const update = (): void => {
            const disabled =
                !this.canCopy(file);

            button.disabled = disabled;

            if (copied) {
                button.textContent = "✔";
                button.title =
                    "Copied";
            } else if (disabled) {
                button.textContent = "🚫";
                button.title =
                    "File too large to copy";
            } else {
                button.textContent = "📋";
                button.title =
                    "Copy File Contents";
            }

            button.style.cursor =
                disabled
                    ? "not-allowed"
                    : "pointer";

            button.style.opacity =
                disabled
                    ? "0.5"
                    : "1";
        };

        const doCopy = async (): Promise<void> => {
            if (
                button.disabled ||
                !this.canCopy(file)
            ) {
                return;
            }

            try {
                await this.copyText(
                    file.content
                );

                copied = true;
                update();

                this.toast(
                    "Copied file contents!"
                );

                if (copyTimer !== null) {
                    clearTimeout(copyTimer);
                }

                copyTimer = setTimeout(() => {
                    copied = false;
                    copyTimer = null;
                    update();
                }, 2000);

            } catch (error) {
                console.warn(
                    "[KrynetCopyFile] Clipboard failed:",
                    error
                );

                this.toast(
                    "Failed to copy."
                );
            }
        };

        button.addEventListener(
            "click",
            () => {
                void doCopy();
            }
        );

        update();

        return button;
    }

    /* ---------------------------------------------------------
       CLIPBOARD
    --------------------------------------------------------- */

    /**
     * Copies text using the modern Clipboard API.
     *
     * Falls back to a temporary textarea when the
     * Clipboard API is unavailable or denied.
     */
    private static async copyText(
        text: string
    ): Promise<void> {
        if (
            navigator.clipboard?.writeText
        ) {
            try {
                await navigator.clipboard.writeText(
                    text
                );

                return;
            } catch {
                // Fall through to textarea fallback.
            }
        }

        await this.copyTextFallback(text);
    }

    /* ---------------------------------------------------------
       FALLBACK COPY
    --------------------------------------------------------- */

    private static copyTextFallback(
        text: string
    ): Promise<void> {
        return new Promise(
            (resolve, reject) => {
                const textarea =
                    document.createElement(
                        "textarea"
                    );

                textarea.value = text;

                Object.assign(
                    textarea.style,
                    {
                        position: "fixed",
                        left: "-9999px",
                        top: "0",
                        width: "1px",
                        height: "1px",
                        opacity: "0",
                        pointerEvents:
                            "none"
                    }
                );

                document.body.appendChild(
                    textarea
                );

                textarea.focus();
                textarea.select();

                let successful = false;

                try {
                    successful =
                        document.execCommand(
                            "copy"
                        );
                } catch {
                    successful = false;
                }

                textarea.remove();

                if (successful) {
                    resolve();
                } else {
                    reject(
                        new Error(
                            "Clipboard API unavailable"
                        )
                    );
                }
            }
        );
    }

    /* ---------------------------------------------------------
       TOAST
    --------------------------------------------------------- */

    static toast(
        message: string
    ): void {
        if (!document.body) {
            return;
        }

        if (this.toastTimer !== null) {
            clearTimeout(
                this.toastTimer
            );

            this.toastTimer = null;
        }

        if (this.fadeTimer !== null) {
            clearTimeout(
                this.fadeTimer
            );

            this.fadeTimer = null;
        }

        let toast =
            this.toastElement;

        if (!toast) {
            toast =
                document.createElement(
                    "div"
                );

            toast.className =
                "kr-toast";

            this.toastElement =
                toast;

            document.body.appendChild(
                toast
            );
        }

        toast.classList.remove(
            "fade"
        );

        toast.textContent =
            message;

        this.toastTimer =
            setTimeout(() => {
                toast?.classList.add(
                    "fade"
                );

                this.fadeTimer =
                    setTimeout(() => {
                        toast?.remove();

                        if (
                            this.toastElement ===
                            toast
                        ) {
                            this.toastElement =
                                null;
                        }

                        this.fadeTimer =
                            null;
                    }, 300);

                this.toastTimer =
                    null;
            }, this.TOAST_DURATION);
    }
}

/* -------------------------------------------------------------
   GLOBAL EXPORT
------------------------------------------------------------- */

declare global {
    interface Window {
        KrynetCopyFile?:
            typeof KrynetCopyFile;
    }
}

window.KrynetCopyFile =
    KrynetCopyFile;

export default KrynetCopyFile;
