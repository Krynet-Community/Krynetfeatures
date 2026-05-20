type KrynetMessage =
  | { t: "k"; k: number[] }
  | { t: "v"; n: number[]; d: number[]; ts: number; ft: string }
  | { t: "cam"; state: boolean };

interface KrynetConn {
  send(msg: KrynetMessage): void;
  onMessage(cb: (msg: KrynetMessage) => void): void;
  transport: "webtransport" | "websocket";
}

declare const KrynetAPI: {
  connect(): Promise<KrynetConn>;
};

export async function startWebcamStream(): Promise<void> {
  // -------------------------
  // LOAD LIBSODIUM
  // -------------------------
  const script = document.createElement("script");
  script.src =
    "https://cdn.jsdelivr.net/npm/libsodium-wrappers/dist/libsodium-wrappers.min.js";
  document.head.appendChild(script);

  await new Promise<void>((res, rej) => {
    script.onload = () => res();
    script.onerror = () => rej(new Error("libsodium load failed"));
  });

  const sodium: any = (window as any).sodium;
  await sodium.ready;

  // -------------------------
  // CONNECT TRANSPORT
  // -------------------------
  const conn = await KrynetAPI.connect();

  // -------------------------
  // KEY EXCHANGE (X25519)
  // -------------------------
  const kp = sodium.crypto_kx_keypair();
  let sharedKey: Uint8Array | null = null;

  conn.send({ t: "k", k: Array.from(kp.publicKey) });

  conn.onMessage((msg) => {
    if (msg.t === "k") {
      const peer = new Uint8Array(msg.k);

      const shared = sodium.crypto_scalarmult(kp.privateKey, peer);

      sharedKey = sodium.crypto_generichash(32, shared);
    }
  });

  // -------------------------
  // CAMERA
  // -------------------------
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });

  const track = stream.getVideoTracks()[0];

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  document.body.appendChild(video);

  // -------------------------
  // CANVAS + DECODER
  // -------------------------
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  document.body.appendChild(canvas);

  const decoder = new VideoDecoder({
    output(frame: VideoFrame) {
      if (
        canvas.width !== frame.codedWidth ||
        canvas.height !== frame.codedHeight
      ) {
        canvas.width = frame.codedWidth;
        canvas.height = frame.codedHeight;
      }

      ctx.drawImage(frame, 0, 0);
      frame.close();
    },
    error: console.error,
  });

  decoder.configure({ codec: "vp8" });

  // -------------------------
  // ENCODER
  // -------------------------
  let targetBitrate = 300_000;

  const encoder = new VideoEncoder({
    output(chunk: EncodedVideoChunk) {
      if (!sharedKey) return;

      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);

      const nonce = sodium.randombytes_buf(
        sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES
      );

      const encrypted = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
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
        ts: chunk.timestamp,
        ft: chunk.type,
      });
    },
    error: console.error,
  });

  function configureEncoder(w: number, h: number, bitrate: number) {
    encoder.configure({
      codec: "vp8",
      width: w,
      height: h,
      bitrate,
      framerate: 24,
    });
  }

  const settings = track.getSettings();
  configureEncoder(settings.width ?? 640, settings.height ?? 480, targetBitrate);

  // -------------------------
  // FRAME PIPELINE
  // -------------------------
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  let lastFrame = performance.now();
  const FRAME_INTERVAL = 40;

  async function loop(): Promise<void> {
    while (true) {
      const { value: frame } = await reader.read();
      if (!frame) continue;

      const now = performance.now();

      if (now - lastFrame >= FRAME_INTERVAL) {
        encoder.encode(frame);
        lastFrame = now;
      }

      const load = navigator.hardwareConcurrency
        ? 1 / navigator.hardwareConcurrency
        : 0.5;

      if (load > 0.75) targetBitrate = Math.max(100_000, targetBitrate * 0.8);
      else targetBitrate = Math.min(800_000, targetBitrate * 1.05);

      configureEncoder(
        frame.codedWidth,
        frame.codedHeight,
        targetBitrate
      );

      frame.close();
    }
  }

  loop();

  // -------------------------
  // CAMERA TOGGLE
  // -------------------------
  let cameraOn = true;

  (window as any).toggleCamera = () => {
    cameraOn = !cameraOn;
    track.enabled = cameraOn;

    conn.send({ t: "cam", state: cameraOn });
  };
}
