import type { Scene } from "./scenes";

export interface Analysis {
  scene: Scene; confidence: number; luma: number; clipHigh: number; shadow: number; contrast: number;
  motion: number; sharpness: number; backlit: boolean; lowLight: boolean; rbRatio: number; faces: number | null;
}

/** Lightweight on-device analysis of a 128x96 downscaled frame. Classification is heuristic:
 *  it can only detect scenes that leave a signal in pixel statistics (or faces, if the browser has FaceDetector).
 *  Food / street / architecture / pets need the user override or the optional cloud classifier. */
export class SceneAnalyzer {
  private c = document.createElement("canvas");
  private prev: Uint8ClampedArray | null = null;
  private fd: { detect(i: CanvasImageSource): Promise<unknown[]> } | null = null;
  constructor() {
    this.c.width = 128; this.c.height = 96;
    const FD = (window as any).FaceDetector;
    if (FD) { try { this.fd = new FD({ fastMode: true, maxDetectedFaces: 3 }); } catch { this.fd = null; } }
  }

  async analyze(v: HTMLVideoElement): Promise<Analysis | null> {
    if (!v.videoWidth || v.readyState < 2) return null;
    const W = 128, H = 96, n = W * H;
    const ctx = this.c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const Y = new Float32Array(n);
    let sum = 0, hi = 0, lo = 0, rT = 0, bT = 0, rA = 0, bA = 0, cS = 0, cN = 0, eS = 0, eN = 0;
    for (let i = 0; i < n; i++) {
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
      const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      Y[i] = y; sum += y; if (y > 247) hi++; if (y < 20) lo++;
      rA += R; bA += B;
      const px = i % W, py = (i / W) | 0;
      if (py < H / 2) { rT += R; bT += B; }
      if (px > W / 4 && px < (3 * W) / 4 && py > H / 4 && py < (3 * H) / 4) { cS += y; cN++; } else { eS += y; eN++; }
    }
    const luma = sum / n;
    let vs = 0; for (let i = 0; i < n; i++) vs += (Y[i] - luma) ** 2;
    const contrast = Math.sqrt(vs / n);
    let lapAll = 0, lapC = 0, cC = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, l = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - W] - Y[i + W];
      lapAll += l * l;
      if (x > W / 4 && x < (3 * W) / 4 && y > H / 4 && y < (3 * H) / 4) { lapC += l * l; cC++; }
    }
    const total = (W - 2) * (H - 2);
    const sharpness = lapAll / total, sharpC = lapC / Math.max(cC, 1);
    const sharpE = (lapAll - lapC) / Math.max(total - cC, 1);
    let motion = 0;
    if (this.prev) { for (let i = 0; i < n; i++) motion += Math.abs(d[i * 4 + 1] - this.prev[i * 4 + 1]); motion /= n; }
    this.prev = new Uint8ClampedArray(d);
    const clipHigh = hi / n, shadow = lo / n, rbRatio = rA / Math.max(bA, 1), rbTop = rT / Math.max(bT, 1);
    const backlit = eS / eN - cS / cN > 45 && clipHigh > 0.06;
    const lowLight = luma < 60;
    let faces: number | null = null;
    if (this.fd) { try { faces = (await this.fd.detect(this.c)).length; } catch { faces = null; } }

    let scene: Scene = "general", confidence = 0.4;
    if (luma < 45) { scene = "night"; confidence = 0.75; }
    else if (backlit) { scene = "backlit"; confidence = 0.65; }
    else if (faces && faces > 0) { scene = "portrait"; confidence = 0.85; }
    else if (motion > 14) { scene = "moving"; confidence = 0.55; }
    else if (rbTop > 1.45 && luma < 170) { scene = "sunset"; confidence = 0.5; }
    else if (sharpC > 30 && sharpC / Math.max(sharpE, 0.01) > 4) { scene = "macro"; confidence = 0.45; }
    else if (bT > rT && luma > 110 && sharpness > 20) { scene = "landscape"; confidence = 0.45; }
    else if (luma < 110 && rbRatio > 1.15) { scene = "indoor"; confidence = 0.45; }
    return { scene, confidence, luma, clipHigh, shadow, contrast, motion, sharpness, backlit, lowLight, rbRatio, faces };
  }
}
