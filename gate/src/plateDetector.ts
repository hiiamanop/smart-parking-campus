import * as ort from 'onnxruntime-web';

let session: ort.InferenceSession | null = null;
let loadingPromise: Promise<ort.InferenceSession | null> | null = null;

const MODEL_URL = '/models/plate_detector_yolo11n.onnx';
const INPUT_SIZE = 640;

export async function loadPlateDetector(): Promise<ort.InferenceSession | null> {
  if (session) return session;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      // Use CDN-hosted wasm so we don't have to ship wasm binaries ourselves.
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/';
      ort.env.wasm.numThreads = 1;
      const s = await ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      session = s;
      return s;
    } catch (err) {
      console.warn('Gagal memuat model deteksi plat:', err);
      loadingPromise = null;
      return null;
    }
  })();

  return loadingPromise;
}

export function isDetectorReady(): boolean {
  return !!session;
}

export function getDetectorSession(): ort.InferenceSession | null {
  return session;
}

export interface PlateBox {
  x: number; // top-left in original image coords
  y: number;
  w: number;
  h: number;
  conf: number;
}

// YOLOv11 single-class (license plate) detection.
// Input:  images [1,3,640,640] float32 (RGB, /255, letterboxed, pad 114)
// Output: output0 [1,5,8400]  (cx,cy,w,h,conf)
export async function detectPlate(
  sess: ort.InferenceSession,
  source: HTMLCanvasElement | HTMLVideoElement,
  confThreshold = 0.4
): Promise<PlateBox | null> {
  const imgW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const imgH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!imgW || !imgH) return null;

  const scale = Math.min(INPUT_SIZE / imgW, INPUT_SIZE / imgH);
  const newW = Math.round(imgW * scale);
  const newH = Math.round(imgH * scale);
  const padX = (INPUT_SIZE - newW) / 2;
  const padY = (INPUT_SIZE - newH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(source, 0, 0, imgW, imgH, padX, padY, newW, newH);

  const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const input = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
    input[i] = imgData[i * 4] / 255;
    input[INPUT_SIZE * INPUT_SIZE + i] = imgData[i * 4 + 1] / 255;
    input[2 * INPUT_SIZE * INPUT_SIZE + i] = imgData[i * 4 + 2] / 255;
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const feeds: Record<string, ort.Tensor> = { images: tensor };
  const results = await sess.run(feeds);
  const out = results.output0.data as Float32Array;
  const numAnchors = 8400;

  const candidates: PlateBox[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const cx = out[0 * numAnchors + i];
    const cy = out[1 * numAnchors + i];
    const w = out[2 * numAnchors + i];
    const h = out[3 * numAnchors + i];
    const conf = out[4 * numAnchors + i];
    if (conf < confThreshold) continue;
    // sanity: box size not absurd
    if (w <= 0 || h <= 0) continue;
    const x1 = (cx - w / 2 - padX) / scale;
    const y1 = (cy - h / 2 - padY) / scale;
    const bw = w / scale;
    const bh = h / scale;
    candidates.push({ x: x1, y: y1, w: bw, h: bh, conf });
  }

  if (candidates.length === 0) return null;

  // NMS (IoU 0.45)
  candidates.sort((a, b) => b.conf - a.conf);
  const kept: PlateBox[] = [];
  const iou = (a: PlateBox, b: PlateBox) => {
    const ax2 = a.x + a.w, ay2 = a.y + a.h;
    const bx2 = b.x + b.w, by2 = b.y + b.h;
    const ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
    const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
    const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
    const inter = iw * ih;
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  };
  for (const c of candidates) {
    if (kept.every((k) => iou(c, k) < 0.45)) kept.push(c);
    if (kept.length >= 5) break;
  }

  // Return the highest-confidence box (already sorted)
  return kept[0] || null;
}

// Crop the detected plate region (with padding) and upscale for VLM OCR.
export function cropPlate(
  source: HTMLCanvasElement | HTMLVideoElement,
  box: PlateBox,
  padding = 0.18
): string {
  const imgW = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const imgH = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  const padX = box.w * padding;
  const padY = box.h * padding;
  const x = Math.max(0, Math.round(box.x - padX));
  const y = Math.max(0, Math.round(box.y - padY));
  const w = Math.min(imgW - x, Math.round(box.w + 2 * padX));
  const h = Math.min(imgH - y, Math.round(box.h + 2 * padY));
  if (w <= 0 || h <= 0) return '';

  const outH = Math.max(160, Math.round(h * 2.5));
  const outW = Math.round(w * (outH / h));
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(source, x, y, w, h, 0, 0, outW, outH);
  return canvas.toDataURL('image/jpeg', 0.92);
}
