type MonitorScreenshareOptions = {
    captureAudio?: boolean;
    videoQuality?: number;
    useSpatialAudio?: boolean;
};

type TransportWriter =
    | {
          write: (data: ArrayBuffer) => Promise<void> | void;
          close?: () => void;
      };

type StopHandle = {
    stream: MediaStream;
    transport: WebTransport | WebSocket | null;
    stop: () => void;
};

export async function startMonitorAdaptiveScreenshare(
    wsUrl: string,
    wtUrl: string,
    options: MonitorScreenshareOptions = {}
): Promise<StopHandle | void> {
    const {
        captureAudio = true,
        videoQuality = 0.9,
        useSpatialAudio = false
    } = options;

    let stream: MediaStream | null = null;
    let videoTrack: MediaStreamTrack | null = null;
    let video: HTMLVideoElement | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;

    let writer: TransportWriter | null = null;
    let transport: WebTransport | WebSocket | null = null;

    let audioProcessor: ScriptProcessorNode | null = null;

    let width = 0;
    let height = 0;
    let maxFPS = 60;
    let minFPS = 5;
    let fps = 60;

    try {
        ///////////////////////////////
        // 1. Detect resolution + FPS
        ///////////////////////////////

        width = window.screen.width;
        height = window.screen.height;

        const sampleFrames = 60;
        const frameTimes: number[] = [];
        let lastTime = performance.now();

        await new Promise<void>((resolve) => {
            let count = 0;

            function measure(): void {
                const now = performance.now();
                frameTimes.push(now - lastTime);
                lastTime = now;

                count++;
                if (count < sampleFrames) {
                    requestAnimationFrame(measure);
                } else {
                    resolve();
                }
            }

            requestAnimationFrame(measure);
        });

        const avgFrame =
            frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

        maxFPS = Math.max(1, Math.round(1000 / avgFrame));
        fps = maxFPS;

        ///////////////////////////////
        // 2. Screen capture
        ///////////////////////////////

        stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: captureAudio
        });

        videoTrack = stream.getVideoTracks()[0] ?? null;

        ///////////////////////////////
        // 3. Video element
        ///////////////////////////////

        video = document.createElement("video");
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;

        await video.play();

        ///////////////////////////////
        // 4. Canvas
        ///////////////////////////////

        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        ctx = canvas.getContext("2d");

        if (!ctx) throw new Error("2D canvas not available");

        ///////////////////////////////
        // 5. Transport layer
        ///////////////////////////////

        if ("WebTransport" in window) {
            const wt = new WebTransport(wtUrl);
            transport = wt;

            await wt.ready;

            const stream = wt.datagrams.writable.getWriter();

            writer = {
                write: (data: ArrayBuffer) => stream.write(data),
                close: () => stream.close()
            };
        } else {
            const ws = new WebSocket(wsUrl);
            transport = ws;

            writer = {
                write: (data: ArrayBuffer) => ws.send(data)
            };
        }

        ///////////////////////////////
        // 6. WebGPU check (optional)
        ///////////////////////////////

        if (!navigator.gpu) {
            throw new Error("WebGPU not supported");
        }

        await navigator.gpu.requestAdapter();
        await navigator.gpu.requestDevice();

        const gpuCanvas = canvas.getContext("webgpu");

        if (gpuCanvas) {
            gpuCanvas.configure({
                device: (await navigator.gpu.requestDevice()),
                format: navigator.gpu.getPreferredCanvasFormat(),
                alphaMode: "premultiplied"
            });
        }

        ///////////////////////////////
        // 7. Frame loop
        ///////////////////////////////

        let lastSend = performance.now();

        const sendFrame = async (): Promise<void> => {
            if (!writer || !video || !ctx) return;

            const wsOpen =
                transport instanceof WebSocket
                    ? transport.readyState === WebSocket.OPEN
                    : true;

            if (!wsOpen) return;

            const now = performance.now();
            const delta = now - lastSend;

            if (delta > (1000 / fps) * 1.5) {
                fps = Math.max(minFPS, Math.floor(fps * 0.85));
            }

            ctx.drawImage(video, 0, 0, width, height);

            const blob = await canvas!.convertToBlob({
                type: "image/webp",
                quality: videoQuality
            });

            const buffer = await blob.arrayBuffer();

            await writer.write(buffer);

            lastSend = performance.now();

            setTimeout(sendFrame, Math.max(1000 / fps, 1000 / minFPS));
        };

        sendFrame();

        ///////////////////////////////
        // 8. Audio
        ///////////////////////////////

        if (captureAudio && stream.getAudioTracks().length > 0) {
            const audioCtx = new AudioContext({ sampleRate: 48000 });

            const source =
                audioCtx.createMediaStreamSource(stream);

            if (useSpatialAudio) {
                const panner = audioCtx.createPanner();
                panner.panningModel = "HRTF";
                source.connect(panner).connect(audioCtx.destination);
            } else {
                source.connect(audioCtx.destination);
            }

            audioProcessor = audioCtx.createScriptProcessor(2048, 1, 1);

            source.connect(audioProcessor);
            audioProcessor.connect(audioCtx.destination);

            audioProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
                const input = e.inputBuffer.getChannelData(0);

                const buf = new Int16Array(input.length);

                for (let i = 0; i < input.length; i++) {
                    buf[i] = input[i] * 0x7fff;
                }

                writer?.write(buf.buffer).catch(() => {});
            };
        }

        ///////////////////////////////
        // 9. Stop cleanup
        ///////////////////////////////

        const stop = (): void => {
            try {
                writer?.close?.();
                transport instanceof WebSocket && transport.close();

                videoTrack?.stop();

                audioProcessor?.disconnect();

                if (video) video.srcObject = null;

                canvas = null;
                ctx = null;
                video = null;
                audioProcessor = null;
            } catch (err) {
                console.error("Cleanup error:", err);
            }

            console.log("Monitor-adaptive screenshare stopped");
        };

        videoTrack?.addEventListener("ended", stop);

        return {
            stream,
            transport,
            stop
        };
    } catch (err) {
        console.error("Monitor-adaptive screenshare failed:", err);

        videoTrack?.stop();

        canvas = null;
        ctx = null;
        video = null;
        audioProcessor = null;
    }
}
