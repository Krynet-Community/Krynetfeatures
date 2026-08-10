///////////////////////////////
// External WASM / global libs
///////////////////////////////

declare const OpusEncoderWASM: {
    create: (options: {
        sampleRate: number;
        channels: number;
        application: string;
        bitrate: number;
    }) => Promise<OpusEncoder>;
};

declare const OpusDecoderWASM: {
    create: (options: {
        sampleRate: number;
        channels: number;
    }) => Promise<OpusDecoder>;
};

declare const RNNoiseWASM: {
    create: () => Promise<RNNoise>;
};

///////////////////////////////
// External library shapes
///////////////////////////////

type OpusEncoder = {
    encode(
        pcm: Float32Array,
        bitrate: number
    ): Uint8Array;
};

type OpusDecoder = {
    decode(data: Uint8Array): Float32Array;
};

type RNNoise = {
    process(
        pcm: Float32Array
    ): Promise<Float32Array> | Float32Array;
};

///////////////////////////////
// Types
///////////////////////////////

export type DeviceType =
    | "airpods"
    | "samsungbuds"
    | "generic";

export type VoiceChatOptions = {
    frameSize?: number;
    bitrate?: number;
    sampleRate?: number;
    inactivityTimeout?: number;
    heartbeatInterval?: number;
    serverPublicKey?: string;
};

type Orientation = {
    yaw: number;
    pitch: number;
    roll: number;
};

type ListenerHardware = {
    channels: number;
    sampleRate: number;
};

type UploadController =
    ReadableStreamDefaultController<Uint8Array>;

///////////////////////////////
// Constants
///////////////////////////////

const DEFAULT_FRAME_SIZE = 960;
const DEFAULT_BITRATE = 128_000;
const DEFAULT_SAMPLE_RATE = 48_000;

const DEFAULT_INACTIVITY_TIMEOUT = 90_000;
const DEFAULT_HEARTBEAT_INTERVAL = 30_000;

const AES_IV_SIZE = 12;

///////////////////////////////
// Helpers
///////////////////////////////

function arrayBufferToBase64(
    buffer: ArrayBuffer
): string {
    const bytes = new Uint8Array(buffer);

    let output = "";

    for (const byte of bytes) {
        output += String.fromCharCode(byte);
    }

    return btoa(output);
}

function base64ToBytes(
    value: string
): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

///////////////////////////////
// Main class
///////////////////////////////

export class VoiceChatApex {
    serverUrl: string;
    sessionId: string;
    userId: string;

    frameSize: number;
    bitrate: number;
    sampleRate: number;

    inactivityTimeout: number;
    heartbeatInterval: number;

    audioContext: AudioContext;

    inputStream: MediaStream | null = null;
    inputNode: MediaStreamAudioSourceNode | null = null;
    processorNode: AudioWorkletNode | null = null;

    opusEncoder: OpusEncoder | null = null;
    opusDecoder: OpusDecoder | null = null;
    ai: RNNoise | null = null;

    sessionKey: CryptoKey | null = null;

    uploadStream: ReadableStream<Uint8Array> | null = null;
    uploadController: UploadController | null = null;

    reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    lastActive = Date.now();

    listenerHardware: ListenerHardware = {
        channels: 2,
        sampleRate: DEFAULT_SAMPLE_RATE
    };

    listenerOrientation: Orientation = {
        yaw: 0,
        pitch: 0,
        roll: 0
    };

    deviceType: DeviceType = "generic";

    private serverPublicKey: string | null = null;

    private inactivityTimer: number | null = null;
    private heartbeatTimer: number | null = null;
    private orientationHandler: ((event: DeviceOrientationEvent) => void) | null = null;

    private running = false;

    constructor(
        serverUrl: string,
        sessionId: string,
        userId: string,
        options: VoiceChatOptions = {}
    ) {
        this.serverUrl = serverUrl.replace(/\/+$/, "");
        this.sessionId = sessionId;
        this.userId = userId;

        this.frameSize =
            options.frameSize ??
            DEFAULT_FRAME_SIZE;

        this.bitrate =
            options.bitrate ??
            DEFAULT_BITRATE;

        this.sampleRate =
            options.sampleRate ??
            DEFAULT_SAMPLE_RATE;

        this.inactivityTimeout =
            options.inactivityTimeout ??
            DEFAULT_INACTIVITY_TIMEOUT;

        this.heartbeatInterval =
            options.heartbeatInterval ??
            DEFAULT_HEARTBEAT_INTERVAL;

        this.serverPublicKey =
            options.serverPublicKey ??
            null;

        this.audioContext =
            new AudioContext({
                sampleRate: this.sampleRate,
                latencyHint: "interactive"
            });
    }

    ///////////////////////////////
    // INIT
    ///////////////////////////////

    async init(): Promise<void> {
        if (this.running) return;

        try {
            await this.audioContext.resume();

            await this.detectHardware();
            await this.initKeys();
            await this.loadWASM();
            await this.initMicrophone();
            await this.initHeadTracking();
            await this.startTLSStreaming();

            this.startInactivityChecker();
            this.startHeartbeat();

            this.running = true;
        } catch (error) {
            await this.stop();

            throw error;
        }
    }

    ///////////////////////////////
    // HARDWARE
    ///////////////////////////////

    async detectHardware(): Promise<void> {
        this.listenerHardware = {
            channels: 2,
            sampleRate: this.audioContext.sampleRate
        };

        if (!navigator.mediaDevices) {
            return;
        }

        const devices =
            await navigator.mediaDevices
                .enumerateDevices();

        const output =
            devices.find(
                device =>
                    device.kind ===
                    "audiooutput"
            );

        const label =
            output?.label
                .toLowerCase() ?? "";

        if (label.includes("airpods")) {
            this.deviceType = "airpods";
            return;
        }

        if (label.includes("samsung")) {
            this.deviceType =
                "samsungbuds";

            return;
        }

        this.deviceType = "generic";
    }

    ///////////////////////////////
    // CRYPTO
    ///////////////////////////////

    async initKeys(): Promise<void> {
        if (!this.serverPublicKey) {
            throw new Error(
                "Missing server ECDH public key"
            );
        }

        const serverKeyBytes =
            base64ToBytes(
                this.serverPublicKey
            );

        const serverPublicKey =
            await crypto.subtle.importKey(
                "raw",
                serverKeyBytes,
                {
                    name: "ECDH",
                    namedCurve: "P-256"
                },
                false,
                []
            );

        const keyPair =
            await crypto.subtle.generateKey(
                {
                    name: "ECDH",
                    namedCurve: "P-256"
                },
                false,
                ["deriveKey"]
            );

        this.sessionKey =
            await crypto.subtle.deriveKey(
                {
                    name: "ECDH",
                    public: serverPublicKey
                },
                keyPair.privateKey,
                {
                    name: "AES-GCM",
                    length: 256
                },
                false,
                [
                    "encrypt",
                    "decrypt"
                ]
            );

        /*
         * The server needs the client's public key
         * to derive the same ECDH secret.
         *
         * This endpoint is intentionally explicit
         * rather than pretending a locally-generated
         * ECDH key is shared with the server.
         */
        const clientPublicKey =
            await crypto.subtle.exportKey(
                "raw",
                keyPair.publicKey
            );

        await fetch(
            `${this.serverUrl}/audio/key`,
            {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    sessionId:
                        this.sessionId,

                    userId:
                        this.userId,

                    publicKey:
                        arrayBufferToBase64(
                            clientPublicKey
                        )
                })
            }
        ).then(response => {
            if (!response.ok) {
                throw new Error(
                    "Failed to register client ECDH key"
                );
            }
        });
    }

    ///////////////////////////////
    // WASM
    ///////////////////////////////

    async loadWASM(): Promise<void> {
        this.opusEncoder =
            await OpusEncoderWASM.create({
                sampleRate:
                    this.audioContext
                        .sampleRate,

                channels:
                    this.listenerHardware
                        .channels,

                application:
                    "audio",

                bitrate:
                    this.bitrate
            });

        this.opusDecoder =
            await OpusDecoderWASM.create({
                sampleRate:
                    this.audioContext
                        .sampleRate,

                channels:
                    this.listenerHardware
                        .channels
            });

        this.ai =
            await RNNoiseWASM.create();
    }

    ///////////////////////////////
    // MICROPHONE
    ///////////////////////////////

    async initMicrophone(): Promise<void> {
        this.inputStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: {
                        channelCount:
                            this.listenerHardware
                                .channels,

                        sampleRate:
                            this.audioContext
                                .sampleRate,

                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });

        this.inputNode =
            this.audioContext
                .createMediaStreamSource(
                    this.inputStream
                );

        const workletUrl =
            URL.createObjectURL(
                new Blob(
                    [
                        VoiceChatApex
                            .voiceProcessorCode()
                    ],
                    {
                        type:
                            "application/javascript"
                    }
                )
            );

        try {
            await this.audioContext
                .audioWorklet
                .addModule(workletUrl);
        } finally {
            URL.revokeObjectURL(
                workletUrl
            );
        }

        this.processorNode =
            new AudioWorkletNode(
                this.audioContext,
                "voice-processor",
                {
                    processorOptions: {
                        frameSize:
                            this.frameSize,

                        channels:
                            this.listenerHardware
                                .channels
                    }
                }
            );

        this.inputNode.connect(
            this.processorNode
        );

        /*
         * Don't route microphone audio
         * back into the speakers.
         */
        this.processorNode.port.onmessage =
            async (event: MessageEvent) => {
                if (
                    event.data?.type !==
                    "frame"
                ) {
                    return;
                }

                const frame =
                    event.data
                        .frame as Float32Array;

                this.lastActive =
                    Date.now();

                try {
                    await this.sendFrame(
                        frame
                    );
                } catch (error) {
                    console.error(
                        "Voice frame failed:",
                        error
                    );
                }
            };
    }

    ///////////////////////////////
    // HEAD TRACKING
    ///////////////////////////////

    async initHeadTracking(): Promise<void> {
        this.orientationHandler =
            (event) => {
                this.listenerOrientation = {
                    yaw:
                        event.alpha ?? 0,

                    pitch:
                        event.beta ?? 0,

                    roll:
                        event.gamma ?? 0
                };
            };

        window.addEventListener(
            "deviceorientation",
            this.orientationHandler
        );
    }

    ///////////////////////////////
    // STREAMING
    ///////////////////////////////

    async startTLSStreaming(): Promise<void> {
        if (!this.sessionKey) {
            throw new Error(
                "Session encryption key is not initialized"
            );
        }

        let resolveUpload:
            (() => void) | null = null;

        const uploadReady =
            new Promise<void>(
                resolve => {
                    resolveUpload =
                        resolve;
                }
            );

        this.uploadStream =
            new ReadableStream<Uint8Array>({
                start: controller => {
                    this.uploadController =
                        controller;

                    resolveUpload?.();
                },

                cancel: () => {
                    this.uploadController =
                        null;
                }
            });

        const upload =
            fetch(
                `${this.serverUrl}/audio`,
                {
                    method: "POST",
                    body:
                        this.uploadStream,

                    credentials:
                        "include",

                    keepalive: true,

                    headers: {
                        "Content-Type":
                            "application/octet-stream",

                        "X-Krynet-Session":
                            this.sessionId,

                        "X-Krynet-User":
                            this.userId
                    }
                }
            );

        await uploadReady;

        upload.catch(error => {
            if (this.running) {
                console.error(
                    "Audio upload failed:",
                    error
                );
            }
        });

        const response =
            await fetch(
                `${this.serverUrl}/audio/recv`,
                {
                    method: "GET",
                    credentials: "include",
                    keepalive: true,

                    headers: {
                        "X-Krynet-Session":
                            this.sessionId,

                        "X-Krynet-User":
                            this.userId
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                "Failed to open audio receive stream"
            );
        }

        if (!response.body) {
            throw new Error(
                "Audio receive stream has no body"
            );
        }

        this.reader =
            response.body.getReader();

        void this.readIncomingAudio();
    }

    ///////////////////////////////
    // RECEIVE AUDIO
    ///////////////////////////////

    async readIncomingAudio(): Promise<void> {
        if (!this.reader) return;

        try {
            while (this.running) {
                const {
                    done,
                    value
                } = await this.reader.read();

                if (
                    done ||
                    !value
                ) {
                    break;
                }

                if (
                    value.byteLength <=
                    AES_IV_SIZE
                ) {
                    continue;
                }

                const iv =
                    value.slice(
                        0,
                        AES_IV_SIZE
                    );

                const encrypted =
                    value.slice(
                        AES_IV_SIZE
                    );

                try {
                    const decrypted =
                        await crypto.subtle.decrypt(
                            {
                                name:
                                    "AES-GCM",
                                iv
                            },
                            this.sessionKey!,
                            encrypted
                        );

                    let pcm =
                        this.opusDecoder!
                            .decode(
                                new Uint8Array(
                                    decrypted
                                )
                            );

                    pcm =
                        await this.ai!
                            .process(pcm);

                    this.playAudio(pcm);
                } catch (error) {
                    console.error(
                        "Audio decode failed:",
                        error
                    );
                }
            }
        } catch (error) {
            if (this.running) {
                console.error(
                    "Audio receive failed:",
                    error
                );
            }
        }
    }

    ///////////////////////////////
    // PLAY AUDIO
    ///////////////////////////////

    playAudio(
        pcm: Float32Array
    ): void {
        const channels =
            this.listenerHardware
                .channels;

        const samplesPerChannel =
            Math.floor(
                pcm.length /
                this.listenerHardware.channels
            );

        if (
            samplesPerChannel <= 0
        ) {
            return;
        }

        const buffer =
            this.audioContext
                .createBuffer(
                    channels,
                    samplesPerChannel,
                    this.audioContext
                        .sampleRate
                );

        /*
         * Decode output is expected to be
         * interleaved:
         *
         * L R L R L R...
         */
        for (
            let channel = 0;
            channel < channels;
            channel++
        ) {
            const output =
                buffer.getChannelData(
                    channel
                );

            for (
                let i = 0;
                i < samplesPerChannel;
                i++
            ) {
                const index =
                    i * channels +
                    channel;

                output[i] =
                    pcm[index] ?? 0;
            }
        }

        const source =
            this.audioContext
                .createBufferSource();

        source.buffer = buffer;

        const panner =
            new PannerNode(
                this.audioContext,
                {
                    panningModel:
                        "HRTF",

                    distanceModel:
                        "inverse",

                    positionX: 0,
                    positionY: 0,
                    positionZ: -1
                }
            );

        this.configurePanner(
            panner
        );

        source
            .connect(panner)
            .connect(
                this.audioContext.destination
            );

        source.start();
    }

    configurePanner(
        panner: PannerNode
    ): void {
        const angle =
            -this.listenerOrientation
                .yaw *
            Math.PI /
            180;

        panner.positionX.value =
            Math.sin(angle);

        panner.positionZ.value =
            Math.cos(angle);

        if (
            this.deviceType ===
            "airpods"
        ) {
            panner.coneInnerAngle =
                360;
        }

        if (
            this.deviceType ===
            "samsungbuds"
        ) {
            panner.coneOuterAngle =
                270;
        }
    }

    ///////////////////////////////
    // SEND FRAME
    ///////////////////////////////

    async sendFrame(
        framePCM: Float32Array
    ): Promise<void> {
        if (
            !this.ai ||
            !this.opusEncoder ||
            !this.sessionKey ||
            !this.uploadController
        ) {
            return;
        }

        const enhanced =
            await this.ai.process(
                framePCM
            );

        const encoded =
            this.opusEncoder.encode(
                enhanced,
                this.bitrate
            );

        const iv =
            crypto.getRandomValues(
                new Uint8Array(
                    AES_IV_SIZE
                )
            );

        const encrypted =
            await crypto.subtle.encrypt(
                {
                    name:
                        "AES-GCM",
                    iv
                },
                this.sessionKey,
                encoded
            );

        const payload =
            new Uint8Array(
                iv.byteLength +
                encrypted.byteLength
            );

        payload.set(iv, 0);

        payload.set(
            new Uint8Array(
                encrypted
            ),
            iv.byteLength
        );

        this.uploadController.enqueue(
            payload
        );
    }

    ///////////////////////////////
    // INACTIVITY
    ///////////////////////////////

    startInactivityChecker(): void {
        this.clearInactivityTimer();

        this.inactivityTimer =
            window.setInterval(() => {
                if (
                    Date.now() -
                    this.lastActive >
                    this.inactivityTimeout
                ) {
                    void this.stop();
                }
            }, 1_000);
    }

    ///////////////////////////////
    // HEARTBEAT
    ///////////////////////////////

    startHeartbeat(): void {
        this.clearHeartbeatTimer();

        const sendHeartbeat =
            (): void => {
                fetch(
                    `${this.serverUrl}/heartbeat`,
                    {
                        method: "POST",
                        credentials:
                            "include",

                        keepalive:
                            true,

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                sessionId:
                                    this.sessionId,

                                userId:
                                    this.userId
                            })
                    }
                ).catch(() => {});
            };

        sendHeartbeat();

        this.heartbeatTimer =
            window.setInterval(
                sendHeartbeat,
                this.heartbeatInterval
            );
    }

    ///////////////////////////////
    // CLEANUP
    ///////////////////////////////

    async stop(): Promise<void> {
        if (!this.running) {
            this.cleanup();
            return;
        }

        this.running = false;

        this.clearInactivityTimer();
        this.clearHeartbeatTimer();

        try {
            await this.reader?.cancel();
        } catch {
            // Stream may already be closed.
        }

        this.reader = null;

        try {
            this.uploadController?.close();
        } catch {
            // Stream may already be closed.
        }

        this.uploadController = null;
        this.uploadStream = null;

        this.cleanup();
    }

    private cleanup(): void {
        this.processorNode?.port.close();
        this.processorNode?.disconnect();
        this.processorNode = null;

        this.inputNode?.disconnect();
        this.inputNode = null;

        if (this.inputStream) {
            for (
                const track of
                this.inputStream.getTracks()
            ) {
                track.stop();
            }

            this.inputStream = null;
        }

        if (
            this.orientationHandler
        ) {
            window.removeEventListener(
                "deviceorientation",
                this.orientationHandler
            );

            this.orientationHandler =
                null;
        }

        this.opusEncoder = null;
        this.opusDecoder = null;
        this.ai = null;
        this.sessionKey = null;

        this.audioContext
            .close()
            .catch(() => {});
    }

    private clearInactivityTimer(): void {
        if (
            this.inactivityTimer !== null
        ) {
            clearInterval(
                this.inactivityTimer
            );

            this.inactivityTimer = null;
        }
    }

    private clearHeartbeatTimer(): void {
        if (
            this.heartbeatTimer !== null
        ) {
            clearInterval(
                this.heartbeatTimer
            );

            this.heartbeatTimer = null;
        }
    }

    ///////////////////////////////
    // WORKLET
    ///////////////////////////////

    static voiceProcessorCode(): string {
        return `
class VoiceProcessor
    extends AudioWorkletProcessor {

    constructor(options) {
        super();

        this.frameSize =
            options.processorOptions.frameSize;

        this.channels =
            options.processorOptions.channels;

        this.buffer =
            new Float32Array(
                this.frameSize
            );

        this.offset = 0;
    }

    process(inputs) {
        const input =
            inputs[0]?.[0];

        if (!input) {
            return true;
        }

        let offset = 0;

        while (
            offset < input.length
        ) {
            const remaining =
                this.buffer.length -
                this.offset;

            const available =
                input.length -
                offset;

            const count =
                Math.min(
                    remaining,
                    available
                );

            this.buffer.set(
                input.subarray(
                    offset,
                    offset + count
                ),
                this.offset
            );

            this.offset += count;
            offset += count;

            if (
                this.offset >=
                this.buffer.length
            ) {
                const frame =
                    new Float32Array(
                        this.buffer
                    );

                this.port.postMessage(
                    {
                        type: "frame",
                        frame
                    },
                    [frame.buffer]
                );

                this.offset = 0;
            }
        }

        return true;
    }
}

registerProcessor(
    "voice-processor",
    VoiceProcessor
);
`;
    }
}
