///////////////////////////////
// External WASM / global libs
///////////////////////////////

declare const OpusEncoderWASM: {
    create: (opts: any) => Promise<any>;
};

declare const OpusDecoderWASM: {
    create: (opts: any) => Promise<any>;
};

declare const RNNoiseWASM: {
    create: () => Promise<any>;
};

///////////////////////////////
// Types
///////////////////////////////

type DeviceType = "airpods" | "samsungbuds" | "generic";

type VoiceChatOptions = {
    frameSize?: number;
    bitrate?: number;
    sampleRate?: number;
    inactivityTimeout?: number;
    heartbeatInterval?: number;
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

///////////////////////////////
// Main Class
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

    inputNode: MediaStreamAudioSourceNode | null = null;
    processorNode: AudioWorkletNode | null = null;

    opusEncoder: any = null;
    opusDecoder: any = null;
    ai: any = null;

    sessionKey: CryptoKey | null = null;

    writer: WritableStreamDefaultController<Uint8Array> | null = null;
    reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    lastActive: number = Date.now();

    listenerHardware: ListenerHardware = { channels: 2, sampleRate: 48000 };
    listenerOrientation: Orientation = { yaw: 0, pitch: 0, roll: 0 };

    deviceType: DeviceType = "generic";

    hrtfNodes: PannerNode[] = [];

    channels: number = 2;

    constructor(serverUrl: string, sessionId: string, userId: string, options: VoiceChatOptions = {}) {
        this.serverUrl = serverUrl;
        this.sessionId = sessionId;
        this.userId = userId;

        this.frameSize = options.frameSize ?? 1024;
        this.bitrate = options.bitrate ?? 512_000;
        this.sampleRate = options.sampleRate ?? 192000;
        this.inactivityTimeout = options.inactivityTimeout ?? 90_000;
        this.heartbeatInterval = options.heartbeatInterval ?? 30_000;

        this.audioContext = new AudioContext({
            sampleRate: this.sampleRate,
            latencyHint: "interactive"
        });
    }

    ///////////////////////////////
    // INIT
    ///////////////////////////////

    async init(): Promise<void> {
        await this.detectHardware();
        await this.initKeys();
        await this.loadWASM();
        await this.initMicrophone();
        await this.initHeadTracking();
        await this.startTLSStreaming();
        this.startInactivityChecker();
        this.startHeartbeat();
    }

    ///////////////////////////////
    // HARDWARE
    ///////////////////////////////

    async detectHardware(): Promise<void> {
        const testBuffer = this.audioContext.createBuffer(2, 1, this.audioContext.sampleRate);
        this.channels = testBuffer.numberOfChannels;

        this.listenerHardware = {
            channels: this.channels,
            sampleRate: this.audioContext.sampleRate
        };

        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutput = devices.find((d) => d.kind === "audiooutput");

        const label = audioOutput?.label?.toLowerCase() ?? "";

        if (label.includes("airpods")) this.deviceType = "airpods";
        else if (label.includes("samsung")) this.deviceType = "samsungbuds";
        else this.deviceType = "generic";
    }

    ///////////////////////////////
    // CRYPTO KEYS
    ///////////////////////////////

    async initKeys(): Promise<void> {
        const ecdhKey = await crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );

        this.sessionKey = await crypto.subtle.deriveKey(
            { name: "ECDH", public: (ecdhKey as any).publicKey },
            (ecdhKey as any).privateKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    ///////////////////////////////
    // WASM LOAD
    ///////////////////////////////

    async loadWASM(): Promise<void> {
        this.opusEncoder = await OpusEncoderWASM.create({
            sampleRate: this.audioContext.sampleRate,
            channels: this.channels,
            application: "audio",
            bitrate: this.bitrate
        });

        this.opusDecoder = await OpusDecoderWASM.create({
            sampleRate: this.audioContext.sampleRate,
            channels: this.channels
        });

        this.ai = await RNNoiseWASM.create();
    }

    ///////////////////////////////
    // MICROPHONE
    ///////////////////////////////

    async initMicrophone(): Promise<void> {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: this.channels,
                sampleRate: this.audioContext.sampleRate
            }
        });

        this.inputNode = this.audioContext.createMediaStreamSource(stream);

        const blob = new Blob([VoiceChatApex.voiceProcessorCode()], {
            type: "application/javascript"
        });

        const url = URL.createObjectURL(blob);

        await this.audioContext.audioWorklet.addModule(url);

        this.processorNode = new AudioWorkletNode(this.audioContext, "voice-processor", {
            processorOptions: {
                vc: this,
                channels: this.channels,
                frameSize: this.frameSize
            }
        });

        this.inputNode.connect(this.processorNode);
        this.processorNode.connect(this.audioContext.destination);

        this.processorNode.port.onmessage = (e: MessageEvent) => {
            if (e.data?.type === "frame") {
                this.lastActive = Date.now();
            }
        };
    }

    ///////////////////////////////
    // HEAD TRACKING
    ///////////////////////////////

    async initHeadTracking(): Promise<void> {
        window.addEventListener("deviceorientation", (e: DeviceOrientationEvent) => {
            this.listenerOrientation = {
                yaw: e.alpha ?? 0,
                pitch: e.beta ?? 0,
                roll: e.gamma ?? 0
            };
        });
    }

    ///////////////////////////////
    // STREAMING
    ///////////////////////////////

    async startTLSStreaming(): Promise<void> {
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                this.writer = controller;
            }
        });

        fetch(`${this.serverUrl}/audio`, {
            method: "POST",
            body: stream,
            keepalive: true
        }).catch(console.error);

        const res = await fetch(`${this.serverUrl}/audio/recv`, {
            method: "GET",
            keepalive: true
        });

        this.reader = res.body!.getReader();
        this.readIncomingAudio();
    }

    ///////////////////////////////
    // RECEIVE AUDIO
    ///////////////////////////////

    async readIncomingAudio(): Promise<void> {
        if (!this.reader) return;

        while (true) {
            const { done, value } = await this.reader.read();
            if (done || !value) break;

            const iv = value.slice(0, 12);
            const encrypted = value.slice(12);

            try {
                const decrypted = await crypto.subtle.decrypt(
                    { name: "AES-GCM", iv },
                    this.sessionKey!,
                    encrypted
                );

                let pcm = this.opusDecoder.decode(decrypted);
                pcm = await this.ai.process(pcm);

                const hwChannels = this.listenerHardware.channels;

                const buffer = this.audioContext.createBuffer(
                    hwChannels,
                    pcm.length / this.channels,
                    this.audioContext.sampleRate
                );

                this.hrtfNodes = [];

                for (let c = 0; c < hwChannels; c++) {
                    const panner = new PannerNode(this.audioContext, {
                        panningModel: "HRTF",
                        distanceModel: "inverse"
                    });

                    if (this.deviceType === "airpods") {
                        panner.coneInnerAngle = 360;
                    } else if (this.deviceType === "samsungbuds") {
                        panner.coneOuterAngle = 270;
                    }

                    const angle =
                        (c / hwChannels) * 2 * Math.PI -
                        (this.listenerOrientation.yaw * Math.PI) / 180;

                    panner.positionX.value = Math.sin(angle);
                    panner.positionZ.value = Math.cos(angle);

                    this.hrtfNodes.push(panner);

                    const source = this.audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.connect(panner).connect(this.audioContext.destination);
                    source.start();
                }
            } catch (err) {
                console.error("Apex spatial error:", err);
            }
        }
    }

    ///////////////////////////////
    // SEND FRAME
    ///////////////////////////////

    async sendFrame(framePCM: Float32Array): Promise<void> {
        const enhanced = await this.ai.process(framePCM);
        const encoded = this.opusEncoder.encode(enhanced, this.bitrate);

        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encrypted = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            this.sessionKey!,
            encoded
        );

        const payload = new Uint8Array(iv.byteLength + encrypted.byteLength);

        payload.set(iv, 0);
        payload.set(new Uint8Array(encrypted), iv.byteLength);

        this.writer?.enqueue(payload);
    }

    ///////////////////////////////
    // MAINTENANCE
    ///////////////////////////////

    startInactivityChecker(): void {
        setInterval(() => {
            if (Date.now() - this.lastActive > this.inactivityTimeout) {
                this.leaveCall();
            }
        }, 1000);
    }

    leaveCall(): void {
        this.processorNode?.disconnect();
        this.inputNode?.disconnect();
    }

    startHeartbeat(): void {
        setInterval(() => {
            fetch(`${this.serverUrl}/heartbeat`, {
                method: "POST",
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    userId: this.userId
                }),
                keepalive: true
            }).catch(() => {});
        }, this.heartbeatInterval);
    }

    ///////////////////////////////
    // WORKLET CODE
    ///////////////////////////////

    static voiceProcessorCode(): string {
        return `
        class VoiceProcessor extends AudioWorkletProcessor {
            constructor(options) {
                super();
                this.vc = options.processorOptions.vc;
                this.frameSize = options.processorOptions.frameSize;
                this.channels = options.processorOptions.channels;
                this.buffer = new Float32Array(this.frameSize * this.channels);
                this.offset = 0;
            }

            process(inputs) {
                const input = inputs[0][0];
                if (!input) return true;

                if (this.offset + input.length > this.buffer.length) {
                    this.vc.sendFrame(this.buffer);
                    this.offset = 0;
                }

                this.buffer.set(input, this.offset);
                this.offset += input.length;

                return true;
            }
        }

        registerProcessor("voice-processor", VoiceProcessor);
        `;
    }
}
