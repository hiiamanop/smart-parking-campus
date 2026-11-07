export type PlateResult = {
  plate: string | null;
  confidence?: number;
  vehicle_type?: 'car' | 'motorcycle' | 'unknown' | string;
  raw_text?: string;
  notes?: string;
};

export type VlmPlateResponse = {
  ok: boolean;
  model?: string;
  result?: PlateResult;
  usage?: unknown;
  error?: string;
  detail?: unknown;
};

export async function readPlateFromDataUrl(imageBase64DataUrl: string, context: 'entry' | 'exit' = 'entry'): Promise<VlmPlateResponse> {
  const m = imageBase64DataUrl.match(/^data:(.*?);base64,(.*)$/);
  const mimeType = m?.[1] || 'image/jpeg';
  const imageBase64 = m?.[2] || imageBase64DataUrl;
  const res = await fetch('/api/vlm/plate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, context }),
  });
  return res.json();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}
