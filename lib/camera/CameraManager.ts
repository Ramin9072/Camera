export type Caps = Record<string, any>;
export type Status = "confirmed" | "unconfirmed" | "rejected";
export interface ApplyResult { status: Status; read?: unknown }
export interface StartOpts { deviceId?: string; facing?: "user" | "environment"; width?: number; height?: number }

/** Owns the MediaStream: capability detection, safe start/stop, verified setting changes and capture. */
export class CameraManager {
  private stream: MediaStream | null = null;
  private busy = false;
  track: MediaStreamTrack | null = null;
  onEnded: (() => void) | null = null;

  static supported() { return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia; }
  async devices() { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"); }

  async start(video: HTMLVideoElement, o: StartOpts = {}) {
    if (this.busy) return;
    this.busy = true;
    try {
      this.stop();
      const v: MediaTrackConstraints = { width: { ideal: o.width ?? 1920 }, height: { ideal: o.height ?? 1080 } };
      if (o.deviceId) v.deviceId = { exact: o.deviceId }; else v.facingMode = o.facing ?? "environment";
      this.stream = await navigator.mediaDevices.getUserMedia({ video: v, audio: false });
      this.track = this.stream.getVideoTracks()[0] ?? null;
      if (this.track) this.track.onended = () => this.onEnded?.();
      video.srcObject = this.stream;
      await video.play();
    } finally { this.busy = false; }
  }
  async restart(video: HTMLVideoElement, width: number, height: number) {
    await this.start(video, { deviceId: this.settings().deviceId as string | undefined, width, height });
  }
  stop() {
    this.stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    this.stream = null; this.track = null;
  }
  caps(): Caps { return (this.track && "getCapabilities" in this.track ? (this.track.getCapabilities() as Caps) : {}) ?? {}; }
  settings(): Caps { return (this.track?.getSettings() as Caps) ?? {}; }

  /** Applies each constraint on its own, then reads getSettings() back. Browsers silently ignore unsatisfiable
   *  `advanced` constraints, so only a matching read-back counts as "confirmed". */
  async apply(want: Record<string, unknown>): Promise<Record<string, ApplyResult>> {
    const out: Record<string, ApplyResult> = {};
    const t = this.track;
    if (!t) return out;
    for (const [k, v] of Object.entries(want)) {
      try { await t.applyConstraints({ advanced: [{ [k]: v } as MediaTrackConstraintSet] }); out[k] = { status: "unconfirmed" }; }
      catch { out[k] = { status: "rejected" }; }
    }
    await new Promise((r) => setTimeout(r, 300));
    const s = this.settings();
    for (const [k, v] of Object.entries(want)) {
      if (out[k].status === "rejected") continue;
      const got = s[k];
      out[k].read = got;
      if (got === undefined) continue; // cannot verify: stays "unconfirmed"
      const ok = typeof v === "number" && typeof got === "number" ? Math.abs(got - v) <= Math.max(Math.abs(v) * 0.05, 0.05) : got === v;
      out[k].status = ok ? "confirmed" : "rejected";
    }
    return out;
  }

  async capture(video: HTMLVideoElement) {
    const IC = (window as any).ImageCapture;
    if (IC && this.track) {
      try {
        const blob: Blob = await new IC(this.track).takePhoto();
        const bmp = await createImageBitmap(blob);
        return { blob, method: "ImageCapture.takePhoto", w: bmp.width, h: bmp.height };
      } catch { /* fall through to canvas */ }
    }
    const c = document.createElement("canvas");
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Encoding failed"))), "image/jpeg", 0.95));
    return { blob, method: "Canvas frame grab (preview-stream resolution, not full sensor)", w: c.width, h: c.height };
  }
}
