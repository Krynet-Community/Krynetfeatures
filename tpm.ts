export type Auth0ClientLike = {
  getUser: () => Promise<{ sub?: string } | null>;
};

export type ZeroTrustPayload = {
  auth0Sub: string | null;
  challenge: string;
  signature: ArrayBuffer | null;
  timestamp: number;
  nonce: string;
};

export class KrynetZeroTrust {
  private auth0: Auth0ClientLike;

  constructor(auth0Client: Auth0ClientLike) {
    this.auth0 = auth0Client;
  }

  // ---------------------------
  // 1. Get server challenge
  // ---------------------------
  async fetchChallenge(): Promise<string> {
    const res = await fetch("/auth/challenge", {
      method: "POST",
      credentials: "include",
    });

    if (!res.ok) throw new Error("Failed to fetch challenge");
    const data = await res.json();

    return data.challenge;
  }

  // ---------------------------
  // 2. WebAuthn signature
  // ---------------------------
  async signChallenge(challenge: string): Promise<ArrayBuffer | null> {
    if (!window.PublicKeyCredential) return null;

    const challengeBuffer = new TextEncoder().encode(challenge);

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuffer,
        userVerification: "required",
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    return (assertion.response as AuthenticatorAssertionResponse).signature;
  }

  // ---------------------------
  // 3. Build zero-trust request proof
  // ---------------------------
  async createProof(): Promise<ZeroTrustPayload> {
    const challenge = await this.fetchChallenge();
    const signature = await this.signChallenge(challenge);
    const user = await this.auth0.getUser();

    return {
      auth0Sub: user?.sub ?? null,
      challenge,
      signature,
      timestamp: Date.now(),
      nonce: crypto.randomUUID(),
    };
  }

  // ---------------------------
  // 4. Secure API request wrapper
  // ---------------------------
  async secureFetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const proof = await this.createProof();

    const headers = new Headers(options.headers || {});
    headers.set("content-type", "application/json");
    headers.set("x-krynet-sub", proof.auth0Sub ?? "");
    headers.set("x-krynet-timestamp", String(proof.timestamp));
    headers.set("x-krynet-nonce", proof.nonce);
    headers.set(
      "x-krynet-signature",
      proof.signature ? btoa(String.fromCharCode(...new Uint8Array(proof.signature))) : ""
    );

    return fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
  }

  // ---------------------------
  // 5. Utility
  // ---------------------------
  static isSupported(): boolean {
    return typeof window !== "undefined" &&
      !!window.PublicKeyCredential;
  }
}
