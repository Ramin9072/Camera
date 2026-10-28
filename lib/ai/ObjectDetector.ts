import type { ObjectDetection } from "@tensorflow-models/coco-ssd";
import type { Scene } from "./scenes";

export interface Det { cls: string; score: number }
let model: Promise<ObjectDetection> | null = null;

/** On-device object recognition (COCO-SSD, 80 classes). The model weights are downloaded once; camera frames never leave the device. */
export async function detect(v: HTMLVideoElement): Promise<Det[]> {
  model ??= (async () => {
    await import("@tensorflow/tfjs");
    const m = await import("@tensorflow-models/coco-ssd");
    return m.load({ base: "lite_mobilenet_v2" });
  })();
  try { return (await (await model).detect(v)).filter((d) => d.score > 0.5).map((d) => ({ cls: d.class, score: d.score })); }
  catch (e) { model = null; throw e; }
}

const PET = new Set(["cat", "dog", "bird", "horse", "sheep", "cow", "bear", "zebra", "giraffe", "elephant"]);
const FOOD = new Set(["pizza", "cake", "sandwich", "donut", "hot dog", "banana", "apple", "orange", "broccoli", "carrot", "bowl", "cup", "wine glass"]);
const STREET = new Set(["car", "truck", "bus", "bicycle", "motorcycle", "traffic light", "bench", "stop sign", "train"]);

export function sceneFromDets(d: Det[]): Scene | null {
  const has = (f: (c: string) => boolean) => d.some((x) => f(x.cls));
  if (has((c) => c === "person")) return "portrait";
  if (has((c) => PET.has(c))) return "pet";
  if (has((c) => c === "potted plant")) return "plant";
  if (has((c) => FOOD.has(c))) return "food";
  if (has((c) => STREET.has(c))) return "street";
  return null;
}
