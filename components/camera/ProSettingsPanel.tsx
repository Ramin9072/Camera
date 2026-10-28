"use client";
import type { Caps, Plan } from "@/lib/ai/CameraRecommendationEngine";
import { rng } from "@/lib/ai/CameraRecommendationEngine";
import type { ApplyResult } from "@/lib/camera/CameraManager";

type Props = {
  caps: Caps; cur: Caps; plan: Plan | null; results: Record<string, ApplyResult>;
  onSet: (key: string, v: number | string | boolean, modeKey?: string) => void; onMaxRes: () => void;
};
const NUM: [string, string, string | undefined][] = [
  ["iso", "ISO", "exposureMode"], ["exposureTime", "Shutter", "exposureMode"], ["focusDistance", "Focus distance (m)", "focusMode"],
  ["colorTemperature", "Color temp (K)", "whiteBalanceMode"], ["exposureCompensation", "Exposure comp (EV)", undefined], ["zoom", "Zoom", undefined],
];
const MODES: [string, string][] = [["focusMode", "Focus mode"], ["exposureMode", "Exposure mode"], ["whiteBalanceMode", "White balance mode"]];
const fmt = (k: string, v: unknown) => (typeof v !== "number" ? "—" : k === "exposureTime" ? `1/${Math.round(10000 / v)} s` : String(Math.round(v * 100) / 100));
const badge = (r?: ApplyResult) =>
  !r ? null : <span className={`rounded px-1.5 text-[10px] ${r.status === "confirmed" ? "bg-emerald-600" : r.status === "rejected" ? "bg-red-700" : "bg-amber-600"}`}>
    {r.status === "confirmed" ? "applied ✓" : r.status === "rejected" ? "not applied" : "sent, unverified"}</span>;

export default function ProSettingsPanel({ caps, cur, plan, results, onSet, onMaxRes }: Props) {
  const rec = (k: string) => plan?.recs.find((r) => r.key === k);
  const missing: string[] = [];
  return (
    <div className="space-y-3 text-sm">
      {NUM.map(([k, label, mk]) => {
        const r = rng(caps, k);
        if (!r) { missing.push(label); return null; }
        const rc = rec(k), v = typeof cur[k] === "number" ? (cur[k] as number) : r.min;
        return (
          <div key={k}>
            <div className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <span className="text-white/60">now {fmt(k, cur[k])}{rc && rc.auto ? ` · AI ${fmt(k, rc.value)}` : ""} {badge(results[k])}</span>
            </div>
            <input type="range" aria-label={label} className="w-full" min={r.min} max={r.max} step={r.step || (r.max - r.min) / 100}
              defaultValue={v} onChange={(e) => onSet(k, Number(e.target.value), mk)} />
            <div className="flex justify-between text-[10px] text-white/40"><span>{fmt(k, r.min)}</span><span>{fmt(k, r.max)}</span></div>
          </div>
        );
      })}
      {MODES.map(([k, label]) => Array.isArray(caps[k]) ? (
        <label key={k} className="flex items-center justify-between gap-2">{label} {badge(results[k])}
          <select className="rounded bg-white/10 p-1" value={String(cur[k] ?? "")} onChange={(e) => onSet(k, e.target.value)}>
            {(caps[k] as string[]).map((m) => <option key={m} value={m} className="text-black">{m}</option>)}
          </select>
        </label>) : (missing.push(label), null))}
      {caps.torch ? (
        <label className="flex items-center justify-between">Torch
          <input type="checkbox" checked={!!cur.torch} onChange={(e) => onSet("torch", e.target.checked)} /></label>) : (missing.push("Torch"), null)}
      <div className="flex items-center justify-between">
        <span>Resolution</span>
        <span className="text-white/60">{cur.width}×{cur.height}{cur.frameRate ? ` @ ${Math.round(cur.frameRate)}fps` : ""}
          {caps.width?.max ? <> · max {caps.width.max}×{caps.height?.max}</> : null}</span>
      </div>
      {caps.width?.max && <button className="w-full rounded bg-white/10 p-2" onClick={onMaxRes}>Request maximum stream resolution</button>}
      <p className="text-xs text-white/50">Not exposed by this browser/camera: {[...missing, "Aperture (never controllable on the web)"].join(", ")}.</p>
      {plan?.recs.filter((r) => !r.auto).map((r) => (
        <p key={r.key} className="rounded bg-white/5 p-2 text-xs">Advice only — {r.label}: {fmt(r.key, r.value)}. {r.note}</p>))}
    </div>
  );
}
