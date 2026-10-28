import type { Analysis } from "./SceneAnalyzer";
import type { Scene } from "./scenes";

export type Caps = Record<string, any>;
export type Priority = "balanced" | "sharpness" | "low-noise";
export interface Rec { key: string; label: string; value: number | string; reason: string; confidence: number; auto: boolean; note?: string }
export interface Plan { recs: Rec[]; warnings: string[]; alternatives: string[] }
type R = { min: number; max: number; step?: number };

export const rng = (c: Caps, k: string): R | null => {
  const v = c[k];
  return v && typeof v === "object" && !Array.isArray(v) && typeof v.min === "number" && typeof v.max === "number" ? (v as R) : null;
};
export const hasMode = (c: Caps, k: string, m: string) => Array.isArray(c[k]) && c[k].includes(m);
const fit = (r: R, v: number) => {
  let x = Math.min(r.max, Math.max(r.min, v));
  if (r.step && r.step > 0) x = r.min + Math.round((x - r.min) / r.step) * r.step;
  return Math.min(r.max, x);
};

/** Deterministic rules. Every numeric value is clamped to the range the camera track actually reports;
 *  anything the camera does not expose is returned with auto=false (advice only). */
export function recommend(a: Analysis, scene: Scene, caps: Caps, cur: Caps, prio: Priority): Plan {
  const recs: Rec[] = [], warnings: string[] = [], alternatives: string[] = [];
  const mode = (key: string, label: string, m: string, reason: string) => {
    if (hasMode(caps, key, m)) recs.push({ key, label, value: m, reason, confidence: 0.9, auto: true });
  };
  mode("focusMode", "Focus mode", "continuous", "Continuous autofocus keeps the subject sharp as the scene changes.");
  mode("whiteBalanceMode", "White balance mode", "continuous", "Automatic white balance follows the light; override with colour temperature in Pro if exposed.");

  let ev = 0, why = "";
  if (scene === "backlit" || a.backlit) { ev = 1; why = "Subject is darker than the background. +EV lifts it but may clip the bright area."; }
  else if (scene === "sunset") { ev = -0.7; why = "Negative EV protects sky colour and highlights."; }
  else if (a.clipHigh > 0.1) { ev = -0.7; why = "Over 10% of pixels are clipped; negative EV recovers highlight detail."; }
  else if (a.luma < 80 && scene !== "night") { ev = 0.5; why = "Frame is dark for a non-night scene."; }
  else if (a.luma > 190) { ev = -0.5; why = "Frame is very bright."; }
  if (ev !== 0) {
    const r = rng(caps, "exposureCompensation");
    if (r) recs.push({ key: "exposureCompensation", label: "Exposure comp (EV)", value: fit(r, ev), reason: why, confidence: 0.6, auto: true });
    else recs.push({ key: "exposureCompensation", label: "Exposure comp (EV)", value: ev, reason: why, confidence: 0.6, auto: false, note: "Not exposed by this browser/camera." });
  }

  if (scene === "moving" || a.motion > 14) {
    const tgt = prio === "sharpness" ? 1 / 1000 : prio === "low-noise" ? 1 / 250 : 1 / 500;
    const et = rng(caps, "exposureTime"), isoR = rng(caps, "iso");
    const ct = Number(cur.exposureTime), ci = Number(cur.iso);
    if (et && isoR && hasMode(caps, "exposureMode", "manual") && ct > 0 && ci > 0) {
      const t = fit(et, tgt * 10000); // exposureTime is in units of 100 µs
      const need = (ci * ct) / t, limit = prio === "low-noise" ? Math.min(isoR.max, 800) : isoR.max;
      const iso = fit(isoR, Math.min(need, limit));
      recs.push({ key: "exposureMode", label: "Exposure mode", value: "manual", reason: "Needed to fix shutter speed.", confidence: 0.8, auto: true });
      recs.push({ key: "exposureTime", label: "Shutter", value: t, reason: `Fast shutter (~1/${Math.round(10000 / t)} s) to freeze motion.`, confidence: 0.6, auto: true });
      recs.push({ key: "iso", label: "ISO", value: iso, reason: "Scaled from the current exposure to keep brightness where possible.", confidence: 0.55, auto: true });
      const under = Math.log2(need / iso);
      if (under > 0.3) warnings.push(`Needs ISO ~${Math.round(need)} but the limit is ${Math.round(iso)}: expect about ${under.toFixed(1)} EV underexposure. Add light or accept some blur.`);
    } else {
      recs.push({ key: "exposureTime", label: "Shutter", value: `1/${Math.round(1 / tgt)} s`, reason: "Fast shutter freezes motion.", confidence: 0.6, auto: false, note: "Manual shutter/ISO or current exposure values are not readable here: advice only." });
    }
    warnings.push("Motion detected: slow shutter speeds will blur the subject.");
    alternatives.push("Take several shots in a row and keep the sharpest.");
  }
  if (scene === "night" || a.lowLight) {
    warnings.push("Low light: higher ISO adds noise, longer exposure adds blur. Brace the phone or use a support.");
    alternatives.push("Find a brighter spot or use the torch if available.");
  }
  if (scene === "portrait") warnings.push("Aperture is not controllable on the web, so background blur depends on the phone's own optics.");
  if (scene === "macro") { const f = rng(caps, "focusDistance"); if (f) warnings.push(`Closest focus distance reported: ${f.min} m.`); }
  if (a.clipHigh > 0.1) warnings.push("Highlight clipping: bright areas have lost detail.");
  if (a.shadow > 0.35) warnings.push("Deep shadows: detail there will be noisy or lost.");
  if (a.backlit) alternatives.push("Move so the light is beside or behind you, not behind the subject.");
  return { recs, warnings, alternatives };
}
