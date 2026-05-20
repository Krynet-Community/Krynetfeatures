type KrynetNSFWSettings = {
    blurAmount: number;
    enabled: boolean;
};

type ChannelLike = {
    nsfw?: boolean;
};

class KrynetBlurNSFW {
    private settings: KrynetNSFWSettings = {
        blurAmount: 10,
        enabled: true
    };

    private static readonly CSS_VAR = "--kr-nsfw-blur";

    constructor(initialBlur = 10) {
        this.setBlur(initialBlur);
    }

    /**
     * Applies NSFW blur styling to a message element if channel is NSFW.
     */
    apply(messageEl: HTMLElement, channel?: ChannelLike): void {
        if (!messageEl) return;

        if (this.settings.enabled && channel?.nsfw) {
            messageEl.classList.add("kr-nsfw-blur");
        } else {
            messageEl.classList.remove("kr-nsfw-blur");
        }
    }

    /**
     * Updates blur strength globally via CSS variable.
     */
    setBlur(px: number): void {
        if (!Number.isFinite(px) || px < 0) {
            throw new Error("Blur amount must be a non-negative number.");
        }

        this.settings.blurAmount = px;
        document.documentElement.style.setProperty(
            KrynetBlurNSFW.CSS_VAR,
            `${px}px`
        );
    }

    /**
     * Enables or disables NSFW blur system.
     */
    toggle(enabled: boolean): void {
        this.settings.enabled = Boolean(enabled);
    }

    /**
     * Returns current internal settings (read-only copy).
     */
    getSettings(): Readonly<KrynetNSFWSettings> {
        return { ...this.settings };
    }
}

/* -------------------------
   GLOBAL SAFE EXPORT
------------------------- */

const instance = new KrynetBlurNSFW(10);

/**
 * Optional: attach to window for legacy usage
 */
declare global {
    interface Window {
        KrynetBlurNSFW?: KrynetBlurNSFW;
    }
}

window.KrynetBlurNSFW = instance;

/* -------------------------
   INITIAL CSS SETUP
------------------------- */

document.documentElement.style.setProperty(
    "--kr-nsfw-blur",
    "10px"
);

export default instance;
