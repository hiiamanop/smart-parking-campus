import { useEffect, useRef, useState } from 'react';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type Props = {
  onResult: (value: string) => void;
  onClose: () => void;
};

export function QrScanner({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(true);
  const [ready, setReady] = useState(false);
  const resultRef = useRef(onResult);
  resultRef.current = onResult;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

    if (!Ctor) {
      setSupported(false);
      return;
    }

    const detector = new Ctor({ formats: ['qr_code'] });

    const stop = () => {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);

        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value) {
              stop();
              resultRef.current(value);
              return;
            }
          } catch {
            // frame belum siap; lanjut
          }
          if (!stopped) frame = requestAnimationFrame(() => { void tick(); });
        };
        void tick();
      } catch {
        setError('Tidak bisa mengakses kamera. Izinkan akses kamera atau masukkan kode manual.');
      }
    }

    void start();
    return stop;
  }, []);

  return (
    <div className="scanner">
      {supported ? (
        <>
          <video ref={videoRef} muted playsInline />
          {!ready && !error && <p><small>Menyiapkan kamera…</small></p>}
        </>
      ) : (
        <div className="callout err">
          <strong>Browser ini belum mendukung pemindai QR kamera.</strong>
          <small>Gunakan Chrome di Android atau masukkan kode QR secara manual.</small>
        </div>
      )}
      {error && <div className="callout err"><strong>{error}</strong></div>}
      <button type="button" className="secondary" onClick={onClose}>Tutup kamera</button>
    </div>
  );
}
