///////////////////////////////
// Types
///////////////////////////////

type KrynetMessage =
    | { t: "k"; k: number[] }
    | { t: "v"; n: number[]; d: number[]; ts: number; ft: string }
    | { t: "cam"; state: boolean };

interface KrynetConn {
    send(msg: KrynetMessage): void;
    onMessage(cb: (msg: KrynetMessage) => void): void;
    transport: "webtransport" | "websocket";
}

interface Sodium {
    ready: Promise<void>;

    crypto_kx_keypair(): {
        publicKey: Uint8Array;
        privateKey: Uint8Array;
    };

    crypto_kx_client_session_keys(
        publicKey: Uint8Array,
        privateKey: Uint8Array,
        serverPublicKey: Uint8Array
    ): {
        sharedRx: Uint8Array;
        sharedTx: Uint8Array;
    };

    crypto_generichash(
        length: number,
        input: Uint8Array
    ): Uint8Array;

    randombytes_buf(length: number): Uint8Array;

    crypto_aead_chacha20poly1305_ietf_NPUBBYTES: number;

    crypto_aead_chacha20poly1305_ietf_encrypt(
        message: Uint8Array,
        additionalData: Uint8Array | null,
        secretNonce: Uint8Array | null,
        nonce: Uint8Array,
        key: Uint8Array
    ): Uint8Array;
}

declare global {
    interface Window {
        sodium?: Sodium;
        toggleCamera?: () => void;
    }
}

declare const KrynetAPI: {
    connect(): Promise<KrynetConn>;
};

///////////////////////////////
// Constants
///////////////////////////////

const SODIUM_URL =
    "https://cdn.jsdelivr.net/npm/libsodium-wrappers/dist/libsodium-wrappers.min.js";

const CODEC = "vp8";

const MIN_BITRATE = 100_000;
const MAX_BITRATE = 800_000;
const DEFAULT_BITRATE = 300_000;

const FPS = 24;
const FRAME_INTERVAL = 1000 / FPS;

///////////////////////////////
// Load libsodium
///////////////////////////////

async function loadSodium(): Promise<Sodium> {
    if (window.sodium) {
        await window.sodium.ready;
        return window.sodium;
    }

    const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SODIUM_URL}"]`
    );

    if (existing) {
        await new Promise<void>((resolve, reject) => {
            if (window.sodium) {
                resolve();
                return;
            }

            existing.addEventListener("load", () => resolve(), {
                once: true
            });

            existing.addEventListener("error", () => {
                reject(new Error("libsodium load failed"));
            }, {
                once: true
            });
        });

        if (!window.sodium) {
            throw new Error("libsodium did not initialize");
        }

        await window.sodium.ready;
        return window.sodium;
    }

    const script = document.createElement("script");

    script.src = SODIUM_URL;
    script.async = true;

    await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () =>
            reject(new Error("libsodium load failed"));

        document.head.appendChild(script);
    });

    if (!window.sodium) {
        throw new Error("libsodium did not initialize");
    }

    await window.sodium.ready;

    return window.sodium;
}

///////////////////////////////
// Key exchange
///////////////////////////////

async function establishSharedKey(
    sodium: Sodium,
    conn: KrynetConn
): Promise<Uint8Array> {
    const keyPair = sodium.crypto_kx_keypair();

    let resolveKey!: (key: Uint8Array) => void;
    let rejectKey!: (error: Error) => void;

    const keyPromise = new Promise<Uint8Array>((resolve, reject) => {
        resolveKey = resolve;
        rejectKey = reject;
    });

    conn.onMessage((msg) => {
        if (msg.t !== "k") return;

        try {
            const peerPublicKey = new Uint8Array(msg.k);

            if (peerPublicKey.length !== keyPair.publicKey.length) {
                throw new Error("Invalid peer public key");
            }

            /*
             * This is a symmetric shared-secret derivation.
             *
             * The transport must define which side is "client" and which
             * side is "server". This function assumes this browser is the
             * client and the peer is the server.
             */
            const keys = sodium.crypto_kx_client_session_keys(
                keyPair.publicKey,
                keyPair.privateKey,
                peerPublicKey
            );

            /*
             * Derive one encryption key from the transmit key.
             * Keep the final key at a fixed 32-byte length.
             */
            const sharedKey = sodium.crypto_generichash(
                32,
                keys.sharedTx
            );

            resolveKey(sharedKey);
        } catch (error) {
            rejectKey(
                error instanceof Error
                    ? error
                    : new Error("Key exchange failed")
            );
        }
    });

    conn.send({
        t: "k",
        k: Array.from(keyPair.publicKey)
    });

    return keyPromise;
}

///////////////////////////////
// Camera
///////////////////////////////

async function startCamera(): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
        video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: FPS, max: FPS }
        },
        audio: false
    });
}

///////////////////////////////
// Encoder
///////////////////////////////

function createEncoder(
    sodium: Sodium,
    conn: KrynetConn,
    sharedKey: Uint8Array,
    width: number,
    height: number
): VideoEncoder {
    const encoder = new VideoEncoder({
        output(chunk: EncodedVideoChunk) {
            const data = new Uint8Array(chunk.byteLength);

            chunk.copyTo(data);

            const nonce = sodium.randombytes_buf(
                sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES
            );

            const encrypted =
                sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
                    data,
                    null,
                    null,
                    nonce,
                    sharedKey
                );

            conn.send({
                t: "v",
                n: Array.from(nonce),
                d: Array.from(encrypted),
                ts: chunk.timestamp ?? 0,
                ft: chunk.type
            });
        },

        error(error: DOMException) {
            console.error("[Krynet] VideoEncoder error:", error);
        }
    });

    encoder.configure({
        codec: CODEC,
        width,
        height,
        bitrate: DEFAULT_BITRATE,
        framerate: FPS
    });

    return encoder;
}

///////////////////////////////
// Webcam stream
///////////////////////////////

export async function startWebcamStream(): Promise<{
    stream: MediaStream;
    stop: () => Promise<void>;
}> {
    let stream: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;
    let processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
    let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
    let encoder: VideoEncoder | null = null;

    let stopped = false;
    let cameraOn = true;

    try {
        ///////////////////////////////
        // 1. Dependencies
        ///////////////////////////////

        const sodium = await loadSodium();
        const conn = await KrynetAPI.connect();

        ///////////////////////////////
        // 2. Camera
        ///////////////////////////////

        stream = await startCamera();
        track = stream.getVideoTracks()[0] ?? null;

        if (!track) {
            throw new Error("Camera did not provide a video track");
        }

        ///////////////////////////////
        // 3. Key exchange
        ///////////////////////////////

        const sharedKey = await establishSharedKey(
            sodium,
            conn
        );

        ///////////////////////////////
        // 4. Video encoder
        ///////////////////////////////

        const settings = track.getSettings();

        const width = settings.width ?? 1280;
        const height = settings.height ?? 720;

        if (!("VideoEncoder" in window)) {
            throw new Error(
                "WebCodecs VideoEncoder is not supported"
            );
        }

        encoder = createEncoder(
            sodium,
            conn,
            sharedKey,
            width,
            height
        );

        ///////////////////////////////
        // 5. Frame pipeline
        ///////////////////////////////

        processor = new MediaStreamTrackProcessor({
            track
        });

        reader = processor.readable.getReader();

        let lastFrameTime = 0;

        const loop = async (): Promise<void> => {
            while (!stopped) {
                const result = await reader!.read();

                if (result.done) break;

                const frame = result.value;

                try {
                    const now = performance.now();

                    if (
                        now - lastFrameTime >= FRAME_INTERVAL &&
                        encoder!.state === "configured"
                    ) {
                        encoder!.encode(frame, {
                            keyFrame:
                                lastFrameTime === 0
                        });

                        lastFrameTime = now;
                    }
                } finally {
                    frame.close();
                }
            }
        };

        void loop().catch((error) => {
            if (!stopped) {
                console.error(
                    "[Krynet] Webcam frame loop failed:",
                    error
                );
            }
        });

        ///////////////////////////////
        // 6. Camera toggle
        ///////////////////////////////

        const toggleCamera = (): void => {
            if (!track || stopped) return;

            cameraOn = !cameraOn;
            track.enabled = cameraOn;

            conn.send({
                t: "cam",
                state: cameraOn
            });
        };

        window.toggleCamera = toggleCamera;

        ///////////////////////////////
        // 7. Camera ended handler
        ///////////////////////////////

        track.addEventListener(
            "ended",
            () => {
                void stop();
            },
            { once: true }
        );

        ///////////////////////////////
        // 8. Cleanup
        ///////////////////////////////

        async function stop(): Promise<void> {
            if (stopped) return;

            stopped = true;

            window.toggleCamera = undefined;

            try {
                await reader?.cancel();
            } catch {
                // Reader may already be closed.
            }

            reader = null;

            track?.stop();

            stream?.getTracks().forEach((mediaTrack) => {
                mediaTrack.stop();
            });

            if (encoder) {
                try {
                    await encoder.flush();
                } catch {
                    // Ignore frames already lost during shutdown.
                }

                encoder.close();
                encoder = null;
            }

            processor = null;
            track = null;
            stream = null;

            console.log("[Krynet] Webcam stream stopped");
        }

        return {
            stream,
            stop
        };
    } catch (error) {
        stopped = true;

        try {
            await reader?.cancel();
        } catch {
            // Ignore cleanup errors.
        }

        reader = null;

        track?.stop();

        stream?.getTracks().forEach((mediaTrack) => {
            mediaTrack.stop();
        });

        encoder?.close();

        window.toggleCamera = undefined;

        console.error(
            "[Krynet] Webcam stream failed:",
            error
        );

        throw error;
    }
}
