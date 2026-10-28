"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CameraManager, type ApplyResult } from "@/lib/camera/CameraManager";
import { SceneAnalyzer, type Analysis } from "@/lib/ai/SceneAnalyzer";
import { recommend, type Caps, type Priority } from "@/lib/ai/CameraRecommendationEngine";
import { SCENES, type Scene } from "@/lib/ai/scenes";
import ProSettingsPanel from "./ProSettingsPanel";
import { detect, sceneFromDets, type Det } from "@/lib/ai/ObjectDetector";

const errText = (e: unknown) => {
  const n = (e as { name?: string })?.name;
  return n === "NotAllowedError" ? "Camera permission was denied. Allow it in the browser's site settings and try again."
    : n === "NotFoundError" ? "No camera was found on this device."
    : n === "NotReadableError" ? "The camera is in use by another app."
    : `Camera error: ${(e as Error)?.message ?? "unknown"}`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function CameraApp() {
  const vref = useRef<HTMLVideoElement>(null);
  const mgr = useRef(new CameraManager());
  const an = useRef<SceneAnalyzer | null>(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState("");
  const [devs, setDevs] = useState<MediaDeviceInfo[]>([]);
  const [caps, setCaps] = useState<Caps>({});
  const [cur, setCur] = useState<Caps>({});
  const [a, setA] = useState<Analysis | null>(null);
  const [override, setOverride] = useState<Scene | "auto">("auto");
  const [prio, setPrio] = useState<Priority>("balanced");
  const [results, setResults] = useState<Record<string, ApplyResult>>({});
  const [busy, setBusy] = useState(false);
  const [pro, setPro] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [shot, setShot] = useState<{ url: string; method: string; w: number; h: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [dets, setDets] = useState<Det[]>([]);
  const [soft, setSoft] = useState(1);
  const [aiState, setAiState] = useState("");

  const analyzer = () => (an.current ??= new SceneAnalyzer());
  const refresh = () => { setCaps(mgr.current.caps()); setCur(mgr.current.settings()); };
  const scene: Scene = override !== "auto" ? override : sceneFromDets(dets) ?? a?.scene ?? "general";
  const plan = useMemo(() => (a ? recommend(a, scene, caps, cur, prio) : null), [a, scene, caps, cur, prio]);

  const go = useCallback(async (o: Parameters<CameraManager["start"]>[1] = {}) => {
    setErr("");
    try {
      if (!CameraManager.supported()) throw new Error("This browser has no camera API (HTTPS is required).");
      mgr.current.onEnded = () => { setOn(false); setErr("The camera was disconnected."); };
      await mgr.current.start(vref.current!, o);
      setDevs(await mgr.current.devices()); refresh(); setOn(true); setResults({});
    } catch (e) { setOn(false); setErr(errText(e)); }
  }, []);

  useEffect(() => {
    if (!on) return;
    let live = true, running = false;
    const id = setInterval(async () => {
      if (running || document.hidden || !vref.current) return;
      running = true;
      try { const r = await analyzer().analyze(vref.current); if (live && r) { setA(r); setCur(mgr.current.settings()); } } finally { running = false; }
    }, 800);
    const vis = () => { if (document.hidden) { mgr.current.stop(); setOn(false); setMsg("Camera released while the page was in the background."); } };
    document.addEventListener("visibilitychange", vis);
    return () => { live = false; clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, [on]);
  useEffect(() => {
    if (!on) return;
    let live = true, run = false;
    setAiState("Loading object-recognition model (first time only)…");
    const id = setInterval(async () => {
      const v = vref.current;
      if (run || document.hidden || !v || !v.videoWidth) return;
      run = true;
      try { const d = await detect(v); if (live) { setDets(d); setAiState(""); } }
      catch { if (live) setAiState("Object recognition unavailable (model download failed); using basic detection only."); }
      finally { run = false; }
    }, 1500);
    return () => { live = false; clearInterval(id); };
  }, [on]);
  useEffect(() => { const m = mgr.current; return () => m.stop(); }, []);

  const optimize = async () => {
    if (!on || !vref.current || busy) return;
    setBusy(true); setMsg("");
    try {
      const fresh = await analyzer().analyze(vref.current);
      if (!fresh) { setMsg("Preview is not ready yet."); return; }
      const m = mgr.current, sc = override !== "auto" ? override : sceneFromDets(dets) ?? fresh.scene;
      const p = recommend(fresh, sc, m.caps(), m.settings(), prio);
      const want: Record<string, unknown> = {};
      p.recs.forEach((r) => { if (r.auto) want[r.key] = r.value; });
      const res = await m.apply(want);
      setResults(res); refresh();
      const hw = Object.entries(res).some(([k, r]) => ["exposureCompensation", "exposureTime", "iso"].includes(k) && r.status === "confirmed");
      let extra = "";
      if (hw) setSoft(1);
      else if (fresh.luma < 85 || fresh.luma > 170) {
        const f = Math.min(2, Math.max(0.6, 115 / Math.max(fresh.luma, 1)));
        setSoft(Number(f.toFixed(2)));
        extra = ` This camera cannot change exposure in hardware, so software brightness x${f.toFixed(2)} was applied (preview and saved photo only, not the sensor).`;
      }
      const ok = Object.values(res).filter((r) => r.status === "confirmed").length, total = Object.keys(res).length;
      setMsg((total === 0 ? "This camera exposes no hardware setting to change." : `${ok}/${total} hardware changes confirmed by read-back.`) + extra);
      await sleep(600);
      const again = await analyzer().analyze(vref.current); if (again) setA(again);
    } finally { setBusy(false); }
  };

  const setManual = async (key: string, v: number | string | boolean, modeKey?: string) => {
    const want: Record<string, unknown> = {};
    if (modeKey && hasManual(modeKey)) want[modeKey] = "manual";
    want[key] = v;
    const res = await mgr.current.apply(want); setResults((r) => ({ ...r, ...res })); setCur(mgr.current.settings());
  };
  const hasManual = (k: string) => Array.isArray(caps[k]) && caps[k].includes("manual");

  const capture = async () => {
    if (!vref.current || !on) return;
    try { const s = await mgr.current.capture(vref.current, soft); setShot({ url: URL.createObjectURL(s.blob), method: s.method, w: s.w, h: s.h }); }
    catch (e) { setMsg(`Capture failed: ${(e as Error).message}`); }
  };
  const retake = () => { if (shot) URL.revokeObjectURL(shot.url); setShot(null); };
  const flip = () => {
    const i = devs.findIndex((d) => d.deviceId === cur.deviceId);
    if (devs.length > 1) go({ deviceId: devs[(i + 1) % devs.length].deviceId });
    else go({ facing: cur.facingMode === "user" ? "environment" : "user" });
  };
  const askCloud = async () => {
    const v = vref.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = 320; c.height = Math.round((320 * v.videoHeight) / v.videoWidth);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    try {
      const r = await fetch("/api/ai/analyze", { method: "POST", body: JSON.stringify({ image: c.toDataURL("image/jpeg", 0.7) }) });
      const j = (await r.json()) as { scene?: Scene | null; error?: string };
      if (j.scene && SCENES.includes(j.scene)) { setOverride(j.scene); setMsg(`Cloud classifier suggests: ${j.scene}`); } else setMsg(j.error ?? "No scene returned.");
    } catch { setMsg("Cloud request failed."); }
  };

  const light = !a ? "…" : a.lowLight ? "Low light" : a.luma > 190 ? "Very bright" : a.luma > 120 ? "Bright" : "Moderate";
  return (
    <main className="fixed inset-0 bg-black text-white">
      <video ref={vref} playsInline muted className="h-full w-full object-cover" style={{ filter: soft !== 1 ? `brightness(${soft})` : undefined }} />
      {!on && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center">
          <h1 className="text-2xl font-semibold">AI Pro Camera</h1>
          <p className="max-w-sm text-sm text-white/70">Analysis runs on your device. The camera is only opened after you tap below, and frames are never uploaded unless you opt in to cloud classification.</p>
          {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
          {msg && <p className="text-sm text-white/60">{msg}</p>}
          <button className="rounded-full bg-white px-6 py-3 font-medium text-black" onClick={() => go()}>Enable camera</button>
        </div>
      )}
      {on && (
        <>
          <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 bg-gradient-to-b from-black/70 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs">
            <span className="rounded-full bg-white/20 px-3 py-1 capitalize">{scene}{override !== "auto" ? " · manual" : sceneFromDets(dets) ? " · recognised objects" : a ? ` · ${Math.round(a.confidence * 100)}%` : ""}</span>
            <span className="rounded-full bg-white/20 px-3 py-1">{light}</span>
            <span className="rounded-full bg-white/20 px-3 py-1">{cur.width}×{cur.height}</span>
            {dets.length > 0 && <span className="rounded-full bg-emerald-600/70 px-3 py-1">Detected: {[...new Set(dets.map((d) => d.cls))].join(", ")}</span>}
            {override !== "auto" && override !== "portrait" && sceneFromDets(dets) === "portrait" && <button className="rounded-full bg-sky-500 px-3 py-1" onClick={() => setOverride("portrait")}>Person detected: use Portrait</button>}
          </div>
          {aiState && <p className="absolute inset-x-0 top-24 mx-auto w-fit max-w-[90%] rounded bg-black/70 px-3 py-1 text-xs">{aiState}</p>}
          {msg && <p role="status" className="absolute inset-x-0 top-14 mx-auto w-fit max-w-[90%] rounded bg-black/70 px-3 py-1 text-xs">{msg}</p>}
          <div className="absolute inset-x-0 bottom-28 space-y-2 px-4 text-xs">
            <label className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1">Light (software)
              <input type="range" aria-label="Software brightness" className="flex-1" min={0.5} max={2} step={0.05} value={soft} onChange={(e) => setSoft(Number(e.target.value))} />x{soft.toFixed(2)}</label>
            <div className="flex gap-2 overflow-x-auto">
              {devs.map((d, i) => <button key={d.deviceId} onClick={() => go({ deviceId: d.deviceId })} className={`max-w-[10rem] shrink-0 truncate rounded-full px-3 py-1 ${d.deviceId === cur.deviceId ? "bg-white text-black" : "bg-white/20"}`}>{d.label || `Camera ${i + 1}`}</button>)}
              {devs.length < 2 && <span className="rounded-full bg-black/50 px-3 py-1 text-white/70">Only one camera/lens is exposed by this browser and device.</span>}
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-around bg-gradient-to-t from-black/80 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button className="rounded-full bg-white/15 px-4 py-3 text-sm" onClick={() => setPro(true)}>Pro</button>
            <button aria-label="Capture photo" className="h-16 w-16 rounded-full border-4 border-white bg-white/90" onClick={capture} />
            <button className="rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold disabled:opacity-50" disabled={busy} onClick={optimize}>{busy ? "Working…" : "Auto Optimize"}</button>
            <button aria-label="Switch camera" className="rounded-full bg-white/15 px-4 py-3 text-sm" onClick={flip}>Flip</button>
          </div>
        </>
      )}
      {pro && on && (
        <div className="absolute inset-x-0 bottom-0 max-h-[80%] overflow-y-auto rounded-t-2xl bg-neutral-900/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Pro controls</h2><button onClick={() => setPro(false)} aria-label="Close">✕</button></div>
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
            <label>Scene
              <select className="mt-1 w-full rounded bg-white/10 p-1" value={override} onChange={(e) => setOverride(e.target.value as Scene | "auto")}>
                <option value="auto" className="text-black">Auto-detect</option>
                {SCENES.map((s) => <option key={s} value={s} className="text-black">{s}</option>)}
              </select></label>
            <label>Priority
              <select className="mt-1 w-full rounded bg-white/10 p-1" value={prio} onChange={(e) => setPrio(e.target.value as Priority)}>
                <option className="text-black" value="balanced">Balanced</option><option className="text-black" value="sharpness">Sharpness</option><option className="text-black" value="low-noise">Low noise</option>
              </select></label>
          </div>
          <div className="mb-3 rounded bg-white/5 p-2 text-xs">
            <p className="font-medium capitalize">Why: {scene} {a && `(luma ${Math.round(a.luma)}, contrast ${Math.round(a.contrast)}, motion ${a.motion.toFixed(1)}, highlights clipped ${(a.clipHigh * 100).toFixed(0)}%)`}</p>
            {plan?.recs.map((r) => <p key={r.key} className="mt-1 text-white/70">• {r.label}: {r.reason} ({Math.round(r.confidence * 100)}% confidence, {r.auto ? "can apply" : "advice only"})</p>)}
            {plan?.recs.length === 0 && <p className="mt-1 text-white/70">No setting change is warranted or possible for this scene on this camera.</p>}
            {plan?.warnings.map((w) => <p key={w} className="mt-1 text-amber-300">⚠ {w}</p>)}
            {plan?.alternatives.map((w) => <p key={w} className="mt-1 text-white/60">Alternative: {w}</p>)}
            <p className="mt-1 text-white/40">Scene detection is heuristic (brightness, motion, colour, sharpness{a?.faces != null ? ", face detection" : ""}); use the override for food, pets, street or architecture.</p>
          </div>
          <label className="mb-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={cloud} onChange={(e) => setCloud(e.target.checked)} />
            <span>I consent to sending one small frame to the cloud scene classifier when I tap the button below.</span></label>
          {cloud && <button className="mb-3 w-full rounded bg-white/10 p-2 text-xs" onClick={askCloud}>Classify scene with cloud AI (optional)</button>}
          <ProSettingsPanel caps={caps} cur={cur} plan={plan} results={results} onSet={setManual}
            onMaxRes={() => caps.width?.max && mgr.current.restart(vref.current!, caps.width.max, caps.height?.max ?? caps.width.max).then(refresh).catch((e) => setMsg(errText(e)))} />
        </div>
      )}
      {shot && (
        <div className="absolute inset-0 flex flex-col bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shot.url} alt="Captured photo" className="min-h-0 flex-1 object-contain" />
          <p className="px-4 pt-2 text-center text-xs text-white/60">{shot.w}×{shot.h} via {shot.method}. No post-processing applied.</p>
          <div className="flex gap-3 p-4">
            <button className="flex-1 rounded bg-white/15 p-3" onClick={retake}>Retake</button>
            <a className="flex-1 rounded bg-white p-3 text-center text-black" href={shot.url} download={`photo-${Date.now()}.jpg`}>Download</a>
          </div>
        </div>
      )}
    </main>
  );
}
