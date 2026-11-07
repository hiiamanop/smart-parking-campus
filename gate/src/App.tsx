import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { loadPlateDetector, getDetectorSession, detectPlate, cropPlate, type PlateBox, loadPlateRecognizer, getRecognizerSession, recognizePlate } from './plateDetector';

type PipelineStep = '1_SCANNING_QR' | '2_READING_PLATE_VLM' | '3_SAVING_OPENING' | '4_GATE_OPENED';

const API_BASE = typeof window !== 'undefined' && window.location.port === '5175' ? 'http://127.0.0.1:8788' : '';

export function App() {
  const [gateMode, setGateMode] = useState<'entry' | 'exit'>('entry');
  const [currentStep, setCurrentStep] = useState<PipelineStep>('1_SCANNING_QR');

  // Camera & Stream refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraDiag, setCameraDiag] = useState<{ secure: boolean; mediaDevices: boolean; permission: string }>({ secure: true, mediaDevices: true, permission: 'unknown' });

  // SSE live state
  const [redisLive, setRedisLive] = useState(false);
  const [liveEvent, setLiveEvent] = useState<string>('Menunggu event...');

  // On-device plate detector (ONNX) state
  const [detectorReady, setDetectorReady] = useState(false);
  const [detectorLoading, setDetectorLoading] = useState(false);
  const [detectorError, setDetectorError] = useState<string | null>(null);
  const detectorSessionRef = useRef<any>(null);
  const consecutiveDetectRef = useRef(0);
  const resetPipelineRef = useRef<() => void>(() => {});

  // OCR lokal (recognizer) state
  const [recognizerReady, setRecognizerReady] = useState(false);
  const [recognizerLoading, setRecognizerLoading] = useState(false);
  const [recognizerError, setRecognizerError] = useState<string | null>(null);
  const recognizerSessionRef = useRef<any>(null);

  // Automated workflow state
  const [detectedQrCode, setDetectedQrCode] = useState<string | null>(null);
  const [vlmPlate, setVlmPlate] = useState<string | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [statusText, setStatusText] = useState('Arahkan QR Tiket ke Kamera Gate...');
  const [errorText, setErrorText] = useState<string | null>(null);

  // Snapshot image when plate is captured
  const [snapshotDataUrl, setSnapshotDataUrl] = useState<string | null>(null);

  // Ref to prevent multiple concurrent triggers
  const isProcessingRef = useRef(false);

  // Standby plate-reading loop state
  const [plateStandby, setPlateStandby] = useState(false);
  const [plateAttempt, setPlateAttempt] = useState(0);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const standbyRef = useRef<{ cancelled: boolean; timer: number }>({ cancelled: false, timer: 0 });

  const STANDBY_FRAME_MS = 900;   // jeda antar frame
  const FRAMES_PER_SEND = 3;      // kirim frame terbaik tiap ~3 frame
  const MAX_VLM_ATTEMPTS = 4;     // batas panggilan VLM per scan
  const MIN_SHARPNESS = 6;        // frame terlalu blur tidak dikirim

  // Ambil frame dari video + ukur ketajaman (Laplacian variance)
  const grabFrame = (): { dataUrl: string; sharpness: number } => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth || v.readyState < 2) return { dataUrl: '', sharpness: 0 };

    const w = Math.min(v.videoWidth, 960);
    const h = Math.round((v.videoHeight || 720) * (w / (v.videoWidth || w)));
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return { dataUrl: '', sharpness: 0 };
    ctx.drawImage(v, 0, 0, w, h);

    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.round(w / 240));
    const gw = Math.floor(w / step);
    const gh = Math.floor(h / step);
    if (gw < 3 || gh < 3) return { dataUrl: c.toDataURL('image/jpeg', 0.85), sharpness: 0 };

    const gray = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = (y * step * w + x * step) * 4;
        gray[y * gw + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const lap =
          4 * gray[y * gw + x] -
          gray[(y - 1) * gw + x] - gray[(y + 1) * gw + x] -
          gray[y * gw + x - 1] - gray[y * gw + x + 1];
        sum += lap;
        sumSq += lap * lap;
        n++;
      }
    }
    const mean = n ? sum / n : 0;
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), sharpness: n ? sumSq / n - mean * mean : 0 };
  };

  const stopPlateStandby = useCallback(() => {
    standbyRef.current.cancelled = true;
    if (standbyRef.current.timer) window.clearTimeout(standbyRef.current.timer);
    standbyRef.current.timer = 0;
    setPlateStandby(false);
  }, []);

  // Kirim satu frame ke VLM, kembalikan plat (atau null)
  const requestVlmPlate = async (dataUrl: string): Promise<{ plate: string | null; error?: string }> => {
    const m = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    const mimeType = m?.[1] || 'image/jpeg';
    const imageBase64 = m?.[2] || dataUrl;
    const res = await fetch(`${API_BASE}/api/vlm/plate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64, mimeType, context: gateMode }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return { plate: null, error: data?.error || 'VLM gagal membaca gambar' };
    return { plate: data.result?.plate || null };
  };

  // Standby: kamera tetap live, deteksi plat on-device (ONNX) lalu kirim crop ke VLM;
  // fallback ke pengiriman frame berkala jika model belum siap / tidak mendeteksi.
  const startPlateStandby = (code: string) => {
    stopPlateStandby();
    setPendingCode(code);
    setPlateStandby(true);
    setPlateAttempt(0);
    setVlmPlate(null);
    setSnapshotDataUrl(null);
    setGateOpen(false);
    setErrorText(null);
    setCurrentStep('2_READING_PLATE_VLM');
    setStatusText('QR terverifikasi. Arahkan plat nomor ke kamera — AI standby menunggu plat terbaca...');

    standbyRef.current = { cancelled: false, timer: 0 };
    consecutiveDetectRef.current = 0;
    let attempt = 0;
    let frames = 0;
    let best: { dataUrl: string; sharpness: number } = { dataUrl: '', sharpness: -1 };

    const schedule = (ms: number) => {
      standbyRef.current.timer = window.setTimeout(tick, ms);
    };

    const trySend = async (dataUrl: string): Promise<boolean> => {
      attempt++;
      setPlateAttempt(attempt);

      // 1) Coba OCR lokal dulu (tanpa VLM) bila model siap
      const recSess = recognizerSessionRef.current;
      if (recSess) {
        try {
          const rec = await recognizePlate(recSess, dataUrl, 0.35);
          if (standbyRef.current.cancelled) return true;
          if (rec && rec.text && rec.text.length >= 4 && rec.confidence >= 0.6) {
            stopPlateStandby();
            setSnapshotDataUrl(dataUrl);
            setVlmPlate(rec.text);
            await savePlateAndOpenGate(code, rec.text);
            setStatusText(`PLAT ${rec.text} TERBACA LOKAL (conf ${Math.round(rec.confidence*100)}%). PALANG TERBUKA.`);
            return true;
          }
          setStatusText(`OCR lokal: ${rec?.text || 'tidak ada'} (conf ${Math.round((rec?.confidence||0)*100)}%). Lanjut VLM...`);
        } catch (e) {
          // fall through to VLM
        }
      }

      setPlateAttempt(attempt);
      setStatusText(`AI membaca plat... percobaan ${attempt}/${MAX_VLM_ATTEMPTS}`);
      try {
        const { plate, error } = await requestVlmPlate(dataUrl);
        if (standbyRef.current.cancelled) return true;
        if (plate) {
          stopPlateStandby();
          setSnapshotDataUrl(dataUrl);
          setVlmPlate(plate);
          await savePlateAndOpenGate(code, plate);
          return true;
        }
        if (attempt >= MAX_VLM_ATTEMPTS) {
          setSnapshotDataUrl(dataUrl);
          stopPlateStandby();
          setStatusText('Standby plat dihentikan. Menunggu tindakan operator.');
          setErrorText(
            `Plat belum terbaca setelah ${attempt} percobaan (${error || 'plat tidak terdeteksi'}). ` +
            'Pastikan plat terlihat jelas dan tidak blur, lalu tekan "Baca Plat Lagi" atau gunakan Upload Foto.'
          );
          return true;
        }
        setStatusText(`Plat belum terbaca (percobaan ${attempt}/${MAX_VLM_ATTEMPTS}). Tetap standby...`);
        return false;
      } catch (err: any) {
        if (standbyRef.current.cancelled) return true;
        setStatusText(`Gagal menghubungi AI (${err?.message || 'error'}). Tetap standby...`);
        return false;
      }
    };

    const tick = async () => {
      if (standbyRef.current.cancelled) return;
      if (!videoRef.current || videoRef.current.readyState < 2) {
        setStatusText('Kamera belum siap — menunggu stream video...');
        schedule(STANDBY_FRAME_MS);
        return;
      }

      frames++;
      const frame = grabFrame();
      if (frame.dataUrl && frame.sharpness > best.sharpness) best = frame;

      // 1) On-device detector: bila plat terdeteksi stabil -> crop & kirim ke VLM
      if (detectorSessionRef.current && frames % 2 === 0) {
        try {
          const box = await detectPlate(detectorSessionRef.current, videoRef.current, 0.4);
          if (box) {
            consecutiveDetectRef.current += 1;
            setStatusText(`Plat terdeteksi (${Math.round(box.conf * 100)}%). Menstabilkan...`);
            if (consecutiveDetectRef.current >= 2) {
              const crop = cropPlate(videoRef.current, box);
              if (crop) {
                consecutiveDetectRef.current = 0;
                const done = await trySend(crop);
                if (done || standbyRef.current.cancelled) return;
              }
            }
          } else {
            consecutiveDetectRef.current = 0;
          }
        } catch (e) {
          consecutiveDetectRef.current = 0;
        }
      }

      // 2) Fallback: kirim frame terbaik berkala bila detector belum siap / tidak mendeteksi
      if (frames % FRAMES_PER_SEND === 0 && best.dataUrl && best.sharpness >= MIN_SHARPNESS) {
        const shot = best.dataUrl;
        best = { dataUrl: '', sharpness: -1 };
        consecutiveDetectRef.current = 0;
        const done = await trySend(shot);
        if (done || standbyRef.current.cancelled) return;
      }

      schedule(STANDBY_FRAME_MS);
    };

    schedule(300);
  };


  // Read current camera permission state (best-effort; some browsers don't support it)
  const readPermission = useCallback(async () => {
    try {
      const p = await (navigator.permissions as any)?.query?.({ name: 'camera' });
      return p?.state || 'unknown';
    } catch {
      return 'unknown';
    }
  }, []);

  // Initialize and start live camera on mount or mode change
  const startCamera = useCallback(async () => {
    const secure = window.isSecureContext;
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const permission = await readPermission();
    setCameraDiag({ secure, mediaDevices: hasMedia, permission });

    if (!secure || !hasMedia) {
      setCameraError(
        'Halaman ini tidak aman (HTTP). Browser hanya mengizinkan kamera di HTTPS atau localhost, ' +
        'jadi tombol izin kamera tidak akan muncul. Buka lewat https://gate-parkir.hiiamanop.my.id, ' +
        'atau pakai tombol "Unggah Foto" di bawah.'
      );
      setCameraActive(false);
      return;
    }

    try {
      setCameraError(null);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
      }
      setCameraDiag({ secure: true, mediaDevices: true, permission: 'granted' });
    } catch (err: any) {
      console.warn('Webcam stream error', err);
      const name = err?.name || '';
      const messages: Record<string, string> = {
        NotAllowedError:
          'Izin kamera ditolak. Klik ikon kamera/kunci di address bar -> Site settings -> Camera: Allow, ' +
          'lalu tekan "Restart Kamera".',
        PermissionDeniedError:
          'Izin kamera ditolak. Klik ikon kamera/kunci di address bar -> Site settings -> Camera: Allow, ' +
          'lalu tekan "Restart Kamera".',
        NotFoundError: 'Tidak ada kamera terdeteksi di perangkat ini.',
        DevicesNotFoundError: 'Tidak ada kamera terdeteksi di perangkat ini.',
        NotReadableError:
          'Kamera sedang dipakai aplikasi lain (Zoom/Meet/Teams). Tutup aplikasi tersebut lalu tekan "Restart Kamera".',
        TrackStartError:
          'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu tekan "Restart Kamera".',
        OverconstrainedError: 'Kamera tidak mendukung resolusi yang diminta. Coba tekan "Restart Kamera".',
        SecurityError: 'Akses kamera diblokir oleh kebijakan browser/perangkat.',
      };
      setCameraError(
        messages[name] ||
        `Kamera tidak dapat diakses (${name || 'unknown'}). Anda dapat menggunakan fitur upload foto atau mengizinkan akses kamera browser.`
      );
      setCameraDiag({ secure, mediaDevices: hasMedia, permission: await readPermission() });
      setCameraActive(false);
    }
  }, [readPermission]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startCamera]);

  // Live Redis Pub/Sub SSE (gate terminal)
  useEffect(() => {
    const sse = new EventSource(`${API_BASE}/api/events`);
    sse.onopen = () => setRedisLive(true);
    sse.onerror = () => setRedisLive(false);
    sse.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        setLiveEvent(`${ev.type}${ev.payload?.sessionCode ? ' · ' + ev.payload.sessionCode : ''}`);
        if (ev.type === 'GATE_EXIT_SUCCESS') {
          // Siapkan gate untuk kendaraan berikutnya setelah jeda singkat
          setTimeout(() => resetPipelineRef.current(), 4000);
        }
      } catch {}
    };
    return () => sse.close();
  }, []);

  // Muat model deteksi plat (ONNX) di background
  useEffect(() => {
    let cancelled = false;
    setDetectorLoading(true);
    setRecognizerLoading(true);
    Promise.all([loadPlateDetector(), loadPlateRecognizer()])
      .then(([detSess, recSess]) => {
        if (cancelled) return;
        if (detSess) { detectorSessionRef.current = detSess; setDetectorReady(true); setDetectorError(null); }
        else setDetectorError('Model deteksi plat gagal dimuat. Tetap pakai mode VLM langsung.');
        if (recSess) { recognizerSessionRef.current = recSess; setRecognizerReady(true); setRecognizerError(null); }
        else setRecognizerError('Model OCR plat gagal dimuat. VLM tetap dipakai sebagai fallback.');
      })
      .catch((e) => {
        if (cancelled) return;
        setDetectorError(`Model deteksi plat error: ${e?.message || e}`);
        setRecognizerError(`Model OCR plat error: ${e?.message || e}`);
      })
      .finally(() => {
        if (!cancelled) { setDetectorLoading(false); setRecognizerLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  // Clean code extraction helper (handles e.g. "SP-A1B2", "#SP-A1B2", "OUT-7C1D", JSON, URL)
  const extractCode = (raw: string): string => {
    if (!raw) return '';
    const clean = raw.trim().replace(/^#/, '');
    const m = clean.match(/(SP-[A-Z0-9]+|OUT-[A-Z0-9]+)/i);
    if (m) return m[1].toUpperCase();
    return clean.toUpperCase();
  };

  // Pipeline Step 3: Call Backend to Save Plate & Open Gate
  const savePlateAndOpenGate = async (code: string, plateText: string) => {
    setCurrentStep('3_SAVING_OPENING');
    setStatusText(`Menyimpan plat ${plateText} ke sesi...`);
    setErrorText(null);

    try {
      if (gateMode === 'entry') {
        const res = await fetch(`${API_BASE}/api/gates/entry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: code,
            manualPlateOverride: plateText,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Gagal menyimpan plat ke gate masuk');

        // Success: Plat is saved, Open gate!
        setGateOpen(true);
        setCurrentStep('4_GATE_OPENED');
        setStatusText(`PLAT ${data.session.plate} TERSIMPAN! PALANG GATE MASUK TERBUKA.`);
      } else {
        // Exit Gate
        const res = await fetch(`${API_BASE}/api/gates/exit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exitCode: code,
            manualPlateOverride: plateText,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Gate keluar ditolak');

        setGateOpen(true);
        setCurrentStep('4_GATE_OPENED');
        setStatusText(`VERIFIKASI PLAT COCOK (${plateText})! PALANG GATE KELUAR TERBUKA.`);
      }

      // Auto-reset after 7 seconds for next vehicle
      setTimeout(() => {
        resetPipeline();
      }, 7000);
    } catch (err: any) {
      setErrorText(err.message || String(err));
      // Return to scanning step after 3 seconds
      setTimeout(() => {
        isProcessingRef.current = false;
        setCurrentStep('1_SCANNING_QR');
        setStatusText('Arahkan QR Tiket ke Kamera Gate...');
      }, 3000);
    }
  };

  // Pipeline Step 2: Automatic Snapshot & AI VLM Plate Recognition (Sequential, 0 clicks)
  const processVlmPlateCapture = async (code: string, snapshotBase64: string) => {
    setCurrentStep('2_READING_PLATE_VLM');
    setStatusText('QR Terverifikasi! Kamera AI VLM sedang membaca plat nomor...');
    setErrorText(null);

    try {
      const m = snapshotBase64.match(/^data:(.*?);base64,(.*)$/);
      const mimeType = m?.[1] || 'image/jpeg';
      const imageBase64 = m?.[2] || snapshotBase64;

      const res = await fetch(`${API_BASE}/api/vlm/plate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType, context: gateMode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'AI VLM gagal membaca gambar');

      const plate = data.result?.plate;
      if (!plate) {
        throw new Error('Plat nomor tidak terbaca oleh AI VLM. Pastikan plat berada di depan kamera.');
      }

      setVlmPlate(plate);
      // Immediately proceed to save and open barrier!
      await savePlateAndOpenGate(code, plate);
    } catch (err: any) {
      setErrorText(err.message || String(err));
      // If VLM fails, reset after 3 seconds so driver can realign plate
      setTimeout(() => {
        isProcessingRef.current = false;
        setCurrentStep('1_SCANNING_QR');
        setStatusText('Arahkan QR Tiket ke Kamera Gate...');
      }, 3500);
    }
  };

  // Pipeline Step 1: Triggered automatically when jsQR finds a QR code
  const onQrCodeDetected = async (rawCode: string, providedImage?: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const clean = extractCode(rawCode);
    setDetectedQrCode(clean);

    if (providedImage) {
      // Dari upload foto: langsung kirim gambar itu ke VLM
      setSnapshotDataUrl(providedImage);
      setStatusText(`QR Terdeteksi: ${clean}. Mengirim foto ke AI VLM...`);
      await processVlmPlateCapture(clean, providedImage);
      return;
    }

    // Dari kamera live: standby sampai plat benar-benar terbaca
    startPlateStandby(clean);
  };

  // Continuous Camera Scanning Loop for QR code
  useEffect(() => {
    let animId: number;

    const scanFrame = () => {
      if (
        !isProcessingRef.current &&
        videoRef.current &&
        videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA &&
        canvasRef.current
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (qr && qr.data && qr.data.trim()) {
            onQrCodeDetected(qr.data);
          }
        }
      }

      animId = requestAnimationFrame(scanFrame);
    };

    animId = requestAnimationFrame(scanFrame);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Reset entire pipeline
  const resetPipeline = () => {
    stopPlateStandby();
    isProcessingRef.current = false;
    consecutiveDetectRef.current = 0;
    setVlmPlate(null);
    setSnapshotDataUrl(null);
    setGateOpen(false);
    setErrorText(null);
    setPlateAttempt(0);
    setPendingCode(null);
    setCurrentStep('1_SCANNING_QR');
    setStatusText('Arahkan QR Tiket ke Kamera Gate...');
  };

  useEffect(() => {
    resetPipelineRef.current = resetPipeline;
  }, [resetPipeline]);

  // Manual fallback snapshot file upload (if no webcam available)
  const handleManualUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = String(r.result || '');
      setSnapshotDataUrl(dataUrl);

      // Scan QR from image file
      const img = new Image();
      img.onload = () => {
        if (!canvasRef.current) return;
        const c = canvasRef.current;
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, c.width, c.height);
          const qr = jsQR(imgData.data, imgData.width, imgData.height);
          if (qr && qr.data) {
            onQrCodeDetected(qr.data, dataUrl);
          } else {
            setErrorText('QR Code tidak ditemukan di foto. Pastikan QR terlihat jelas.');
          }
        }
      };
      img.src = dataUrl;
    };
    r.readAsDataURL(file);
  };

  return (
    <div className="kiosk-app-frame">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Header */}
      <header className="kiosk-navbar">
        <div className="kiosk-headline">
          <img className="kiosk-logo" src="/logo-itb.png" alt="Logo ITB" />
          <span>Terminal Kiosk Gate &amp; AI Scanner</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className={`kiosk-pill-live ${cameraActive ? '' : 'offline'}`}>
            <span className={cameraActive ? 'pulse-circle-green' : 'pulse-circle-red'} />
            <span>{cameraActive ? 'Kamera & VLM Aktif' : 'Kamera Nonaktif — Pakai Upload Foto'}</span>
          </div>

          <div className={`kiosk-pill-live ${redisLive ? '' : 'offline'}`}>
            <span className={redisLive ? 'pulse-circle-green' : 'pulse-circle-red'} />
            <span>{redisLive ? 'Redis Live' : 'Redis Offline'}</span>
          </div>

          <div className="mode-toggle-group">
            <button
              type="button"
              className={`mode-toggle-btn ${gateMode === 'entry' ? 'active' : ''}`}
              onClick={() => {
                setGateMode('entry');
                resetPipeline();
              }}
            >
              Gate Masuk
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${gateMode === 'exit' ? 'active' : ''}`}
              onClick={() => {
                setGateMode('exit');
                resetPipeline();
              }}
            >
              Gate Keluar
            </button>
          </div>
        </div>
      </header>

      {/* Big Gate Barrier Banner */}
      <div className={`gate-barrier-banner ${gateOpen ? 'open' : 'closed'}`}>
        <div>
          <span>PALANG {gateMode === 'entry' ? 'MASUK' : 'KELUAR'}: </span>
          <span style={{ fontSize: '1.4rem' }}>{gateOpen ? '🟢 TERBUKA' : '🔴 TERTUTUP'}</span>
        </div>
        <div style={{ fontSize: 13, opacity: 0.9 }}>
          {gateOpen ? 'Kendaraan Silakan Lewat' : 'Menunggu Validasi Berurutan (QR → Plat AI)'}
        </div>
      </div>

      {/* Sequential Pipeline Stepper */}
      <div className="pipeline-stepper">
        <div className={`pipeline-step ${currentStep === '1_SCANNING_QR' ? 'active' : 'completed'}`}>
          <div className="pipeline-step-num">Tahap 1 (Otomatis)</div>
          <div className="pipeline-step-title">
            {detectedQrCode ? `✓ QR: ${detectedQrCode}` : '1. Pindai QR Tiket'}
          </div>
        </div>

        <div className={`pipeline-step ${currentStep === '2_READING_PLATE_VLM' ? 'active' : currentStep === '3_SAVING_OPENING' || currentStep === '4_GATE_OPENED' ? 'completed' : ''}`}>
          <div className="pipeline-step-num">Tahap 2 (Otomatis)</div>
          <div className="pipeline-step-title">
            {vlmPlate
              ? `✓ Plat: ${vlmPlate}`
              : plateStandby
              ? `2. Standby plat… (${plateAttempt}/${MAX_VLM_ATTEMPTS})`
              : '2. AI VLM Baca Plat'}
          </div>
        </div>

        <div className={`pipeline-step ${currentStep === '3_SAVING_OPENING' ? 'active' : currentStep === '4_GATE_OPENED' ? 'completed' : ''}`}>
          <div className="pipeline-step-num">Tahap 3 (Otomatis)</div>
          <div className="pipeline-step-title">
            {gateOpen ? '✓ Plat Tersimpan & Gate Buka' : '3. Kunci Plat & Buka'}
          </div>
        </div>
      </div>

      {errorText && (
        <div className="alert-terminal err">
          <strong>Perhatian: </strong>{errorText}
        </div>
      )}

      {cameraError && (
        <div className="alert-terminal warn">
          <strong>Kamera tidak aktif: </strong>{cameraError}
          <div className="camera-diag">
            <span className={cameraDiag.secure ? 'diag-ok' : 'diag-bad'}>
              HTTPS: {cameraDiag.secure ? 'ya' : 'TIDAK'}
            </span>
            <span className={cameraDiag.mediaDevices ? 'diag-ok' : 'diag-bad'}>
              API kamera: {cameraDiag.mediaDevices ? 'tersedia' : 'tidak tersedia'}
            </span>
            <span className={cameraDiag.permission === 'denied' ? 'diag-bad' : 'diag-neutral'}>
              Izin: {cameraDiag.permission}
            </span>
          </div>
        </div>
      )}

      {/* Main Live Camera Stream Frame */}
      <div className="camera-stream-wrapper">
        {/* Live video element */}
        <video
          ref={videoRef}
          className="camera-video-feed"
          autoPlay
          playsInline
          muted
          style={{ display: snapshotDataUrl && currentStep !== '1_SCANNING_QR' ? 'none' : 'block' }}
        />

        {/* Snapshot review if frozen for VLM */}
        {snapshotDataUrl && currentStep !== '1_SCANNING_QR' && (
          <img src={snapshotDataUrl} alt="Snapshot Kamera" className="camera-snapshot-img" />
        )}

        {/* Dynamic Scanning Reticle Overlay */}
        <div className={`scanning-reticle-box ${detectedQrCode ? 'qr-detected' : ''}`}>
          <div className="reticle-instruction-text">
            {currentStep === '1_SCANNING_QR'
              ? 'ARAHKAN QR TIKET KE SINI'
              : currentStep === '2_READING_PLATE_VLM'
              ? plateStandby
                ? '📸 ARAHKAN PLAT KE KAMERA — AI STANDBY'
                : '📸 AI VLM SEDANG MEMBACA PLAT...'
              : 'VERIFIKASI & MEMBUKA PALANG...'}
          </div>

          {currentStep === '1_SCANNING_QR' && <div className="laser-beam" />}

          <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 700 }}>
            {gateMode === 'entry' ? 'GATE MASUK KAMPUS' : 'GATE KELUAR KAMPUS'}
          </div>
        </div>

        {/* Floating Status Bar Overlay */}
        <div className="camera-floating-status">
          <div>
            <div className="status-lead-text">{statusText}</div>
            <div className="status-sub-text">
              Proses berjalan sekuensial otomatis tanpa klik
            </div>
          </div>

          {vlmPlate && (
            <div className="plate-detected-pill">
              {vlmPlate}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls / Fallback options */}
      <div className="bottom-controls-card">
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            className="btn-kiosk-action sec"
            onClick={resetPipeline}
          >
            🔄 Reset Scanner
          </button>

          <button
            type="button"
            className="btn-kiosk-action sec"
            onClick={startCamera}
          >
            📹 Restart Kamera
          </button>

          {pendingCode && !plateStandby && !gateOpen && (
            <button
              type="button"
              className="btn-kiosk-action primary"
              onClick={() => startPlateStandby(pendingCode)}
            >
              🎯 Baca Plat Lagi
            </button>
          )}
        </div>

        <div>
          <label>
            <span className="btn-kiosk-action sec" style={{ cursor: 'pointer' }}>
              📁 Unggah Foto (Jika Tanpa Webcam)
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleManualUpload}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        <div className="detector-status">
          Deteksi plat on-device: {detectorLoading ? 'memuat model...' : detectorReady ? 'siap (ONNX)' : detectorError || 'tidak aktif'} · OCR lokal: {recognizerLoading ? 'memuat...' : recognizerReady ? 'siap' : recognizerError || 'tidak aktif'}
        </div>
      </div>
    </div>
  );
}
