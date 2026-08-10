type KrynetNSFWSettings = {
    blurAmount: number;
    enabled: boolean;
};

type ChannelLike = {
    nsfw?: boolean;
};

class KrynetBlurNSFW {
    private static readonly CSS_VAR =
        "--kr-nsfw-blur";

    private static readonly BLUR_CLASS =
        "kr-nsfw-blur";

    private settings: KrynetNSFWSettings;

    constructor(initialBlur = 10) {
        this.settings = {
            blurAmount: 10,
            enabled: true
        };

        this.setBlur(initialBlur);
    }

    /* ---------------------------------------------------------
       APPLY
    --------------------------------------------------------- */

    /**
     * Applies or removes NSFW blur from a message element.
     */
    apply(
        messageEl: HTMLElement | null,
        channel?: ChannelLike
    ): void {
        if (!messageEl) {
            return;
        }

        const shouldBlur =
            this.settings.enabled === true &&
            channel?.nsfw === true;

        messageEl.classList.toggle(
            KrynetBlurNSFW.BLUR_CLASS,
            shouldBlur
        );
    }

    /* ---------------------------------------------------------
       BLUR
    --------------------------------------------------------- */

    /**
     * Updates the global blur amount.
     */
    setBlur(px: number): void {
        if (
            !Number.isFinite(px) ||
            px < 0
        ) {
            throw new Error(
                "Blur amount must be a non-negative number."
            );
        }

        this.settings.blurAmount = px;

        document.documentElement.style.setProperty(
            KrynetBlurNSFW.CSS_VAR,
            `${px}px`
        );
    }

    /**
     * Returns the current blur amount.
     */
    getBlur(): number {
        return this.settings.blurAmount;
    }

    /* ---------------------------------------------------------
       ENABLE / DISABLE
    --------------------------------------------------------- */

    /**
     * Enables or disables NSFW blurring.
     */
    toggle(enabled: boolean): void {
        this.settings.enabled =
            Boolean(enabled);
    }

    /**
     * Enables NSFW blurring.
     */
    enable(): void {
        this.toggle(true);
    }

    /**
     * Disables NSFW blurring.
     */
    disable(): void {
        this.toggle(false);
    }

    /**
     * Returns whether blurring is enabled.
     */
    isEnabled(): boolean {
        return this.settings.enabled;
    }

    /* ---------------------------------------------------------
       SETTINGS
    --------------------------------------------------------- */

    /**
     * Returns a copy of the current settings.
     */
    getSettings(): Readonly<KrynetNSFWSettings> {
        return {
            ...this.settings
        };
    }
}

/* -------------------------------------------------------------
   GLOBAL INSTANCE
------------------------------------------------------------- */

const instance =
    new KrynetBlurNSFW(10);

/* -------------------------------------------------------------
   GLOBAL TYPE
------------------------------------------------------------- */

declare global {
    interface Window {
        KrynetNSFW?: KrynetBlurNSFW;
    }
}

/* -------------------------------------------------------------
   GLOBAL EXPORT
------------------------------------------------------------- */

window.KrynetNSFW = instance;

/* -------------------------------------------------------------
   EXPORT
------------------------------------------------------------- */

export default instance;
