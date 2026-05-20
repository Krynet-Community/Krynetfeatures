(async () => {
    /* -------------------------
       DYNAMIC IMPORTS
    ------------------------- */

    const [FingerprintJS, platform] = await Promise.all([
        import(
            "https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@4.4.1/dist/fp.min.js"
        ),
        import("https://cdn.jsdelivr.net/npm/platform@1.3.6/platform.js")
    ]);

    const fpInstance = await FingerprintJS.load();
    let fingerprint: string = (await fpInstance.get()).visitorId;

    /* -------------------------
       TYPES
    ------------------------- */

    type Env = {
        os: string;
        browser: string;
        engine: string;
        device: string;

        privacySignals: {
            doNotTrack: boolean;
            globalPrivacyControl: boolean;
            cookies: boolean;
            hardwareConcurrency: number;
            colorDepth: number;
            screenSize: { width: number; height: number };
            plugins: number;
        };

        adblock: boolean;
        webRTCLeak: boolean;
        proxyHint: boolean;

        torLikely: boolean;
        fingerprint: string;
        canvasEntropy: number | null;
        webglFingerprint: { vendor: string; renderer: string } | null;

        privacyScore: number;
        securityScore: number;
    };

    /* -------------------------
       ENV DETECTION
    ------------------------- */

    function getEnv(): Env {
        const os = platform.os?.family || "Unknown";
        const browser = platform.name || "Unknown";
        const engine = platform.layout || "Unknown";
        const device = /Mobile|Tablet/i.test(platform.product)
            ? "Mobile"
            : "Desktop";

        const privacySignals = {
            doNotTrack: navigator.doNotTrack === "1",
            globalPrivacyControl:
                (navigator as any).globalPrivacyControl === true,
            cookies: navigator.cookieEnabled,
            hardwareConcurrency: navigator.hardwareConcurrency || 0,
            colorDepth: screen.colorDepth || 0,
            screenSize: { width: screen.width, height: screen.height },
            plugins: navigator.plugins?.length || 0
        };

        const adblock = (() => {
            const bait = document.createElement("div");
            bait.className =
                "ads ad adsbox doubleclick ad-placement";
            bait.style.height = "1px";

            document.body.appendChild(bait);

            const result = bait.offsetHeight === 0;

            bait.remove();

            return result;
        })();

        const webRTCLeak = !!(
            (window as any).RTCPeerConnection ||
            (window as any).webkitRTCPeerConnection
        );

        const canvasEntropy = (() => {
            try {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");

                if (!ctx) return null;

                ctx.textBaseline = "top";
                ctx.font = "16px Arial";
                ctx.fillStyle = "#f60";
                ctx.fillRect(125, 1, 62, 20);
                ctx.fillStyle = "#069";
                ctx.fillText("KrynetFP", 2, 15);

                return canvas.toDataURL().length;
            } catch {
                return null;
            }
        })();

        const webglFingerprint = (() => {
            try {
                const canvas = document.createElement("canvas");

                const gl =
                    canvas.getContext("webgl") ||
                    canvas.getContext("experimental-webgl");

                if (!gl) return null;

                const debug = gl.getExtension(
                    "WEBGL_debug_renderer_info"
                );

                if (!debug) return null;

                return {
                    vendor: gl.getParameter(
                        debug.UNMASKED_VENDOR_WEBGL
                    ),
                    renderer: gl.getParameter(
                        debug.UNMASKED_RENDERER_WEBGL
                    )
                };
            } catch {
                return null;
            }
        })();

        const torLikely =
            screen.width === 1000 &&
            screen.height === 1000 &&
            navigator.hardwareConcurrency <= 2;

        const proxyHint =
            (navigator as any).connection?.rtt > 400;

        /* -------------------------
           SCORING
        ------------------------- */

        let privacyScore = 50;
        let securityScore = 50;

        if (/Linux/i.test(os)) {
            privacyScore += 35;
            securityScore += 30;
        }

        if (/macOS/i.test(os)) {
            privacyScore += 15;
            securityScore += 20;
        }

        if (/Windows/i.test(os)) {
            privacyScore -= 10;
            securityScore += 10;
        }

        if (/Android|iOS/i.test(os)) {
            privacyScore += 10;
            securityScore += 15;
        }

        if (engine === "Gecko") {
            privacyScore += 30;
            securityScore += 20;
        }

        if (engine === "WebKit") {
            privacyScore += 20;
            securityScore += 20;
        }

        if (engine === "Blink") {
            privacyScore -= 40;
            securityScore += 20;
        }

        switch (browser) {
            case "Tor Browser":
                privacyScore += 70;
                securityScore += 40;
                break;
            case "LibreWolf":
            case "Mull":
                privacyScore += 55;
                securityScore += 30;
                break;
            case "Firefox":
                privacyScore += 35;
                securityScore += 25;
                break;
            case "Brave":
                privacyScore += 25;
                securityScore += 25;
                break;
            case "Safari":
                privacyScore += 20;
                securityScore += 30;
                break;
            default:
                privacyScore -= 50;
                securityScore += 10;
        }

        if (privacySignals.doNotTrack) privacyScore += 5;
        if (privacySignals.globalPrivacyControl) privacyScore += 5;
        if (adblock) privacyScore += 10;
        if (torLikely) privacyScore += 30;

        if (fingerprint) privacyScore -= 5;
        if (canvasEntropy) privacyScore -= 5;
        if (webglFingerprint) privacyScore -= 5;

        return {
            os,
            browser,
            engine,
            device,
            privacySignals,
            adblock,
            webRTCLeak,
            proxyHint,
            torLikely,
            fingerprint,
            canvasEntropy,
            webglFingerprint,
            privacyScore,
            securityScore
        };
    }

    /* -------------------------
       OVERLAY
    ------------------------- */

    let advisoryOverlay: HTMLDivElement | null = null;

    function showOverlay(env: Env): void {
        if (!advisoryOverlay) {
            advisoryOverlay = document.createElement("div");

            Object.assign(advisoryOverlay.style, {
                position: "fixed",
                top: "0",
                left: "0",
                right: "0",
                bottom: "0",
                background: "#0a0a0a",
                color: "white",
                zIndex: 999999,
                padding: "40px",
                fontFamily: "system-ui",
                overflow: "auto"
            } as CSSStyleDeclaration);

            document.body.appendChild(advisoryOverlay);
        }

        const maxScore = 100;
        const privacyPercent = Math.min(env.privacyScore, maxScore);
        const securityPercent = Math.min(env.securityScore, maxScore);

        advisoryOverlay.innerHTML = `
            <h1>Krynet Browser Advisory</h1>

            <h2>Detected Environment</h2>
            <ul>
                <li>OS: ${env.os}</li>
                <li>Browser: ${env.browser}</li>
                <li>Engine: ${env.engine}</li>
                <li>Device: ${env.device}</li>
                <li>Adblock: ${env.adblock}</li>
                <li>WebRTC Leak Risk: ${env.webRTCLeak}</li>
                <li>Tor Likely: ${env.torLikely}</li>
            </ul>

            <h2>Privacy & Security Scores</h2>
            <div style="display:flex;gap:10px;">
                <div style="flex:1">
                    <div style="background:#333;height:20px;border-radius:10px">
                        <div style="background:#4CAF50;width:${privacyPercent}%;height:20px;border-radius:10px"></div>
                    </div>
                    <div style="text-align:center">
                        Privacy Score: ${env.privacyScore}
                    </div>
                </div>

                <div style="flex:1">
                    <div style="background:#333;height:20px;border-radius:10px">
                        <div style="background:#2196F3;width:${securityPercent}%;height:20px;border-radius:10px"></div>
                    </div>
                    <div style="text-align:center">
                        Security Score: ${env.securityScore}
                    </div>
                </div>
            </div>

            <p style="color:orange;margin-top:20px;">
                ${
                    env.engine === "Gecko"
                        ? "✅ Gecko engine detected. Full Krynet privacy enabled."
                        : "⚠️ Not using Gecko-based browser."
                }
            </p>
        `;
    }

    /* -------------------------
       MONITOR LOOP
    ------------------------- */

    let lastEnv = getEnv();

    showOverlay(lastEnv);

    setInterval(async () => {
        const newFP = await fpInstance.get();
        fingerprint = newFP.visitorId;

        const env = getEnv();

        const changed =
            env.privacyScore !== lastEnv.privacyScore ||
            env.securityScore !== lastEnv.securityScore ||
            env.fingerprint !== lastEnv.fingerprint;

        if (changed) {
            showOverlay(env);
            lastEnv = env;
        }
    }, 5000);
})();
