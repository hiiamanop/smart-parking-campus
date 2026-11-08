import { useEffect, useRef, useState } from 'react';
import {
  askAssistant,
  askVoice,
  applyAssistantAction,
  describeAssistantAction,
  startVoiceSession,
  type AssistantAction,
  type VoiceSession,
} from '../../lib/api';

interface OperatorAssistantProps {
  onApplied: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  action?: AssistantAction | null;
  actionState?: 'pending' | 'applied' | 'dismissed';
  actionNote?: string;
}

const SUGGESTIONS = [
  'Ringkasan parkir hari ini',
  'Zona mana yang hampir penuh?',
  'Sesi yang belum bayar?',
];

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

function MessageBody({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((raw, i) => {
        const line = raw.trim();
        if (!line) return <div key={i} className="operator-line-gap" />;
        const bullet = line.match(/^[-*•]\s+(.*)$/);
        if (bullet) return <div key={i} className="operator-li">{renderInline(bullet[1])}</div>;
        const numbered = line.match(/^\d+[.)]\s+/);
        if (numbered) return <div key={i} className="operator-p operator-p-num">{renderInline(line)}</div>;
        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) return <div key={i} className="operator-h">{renderInline(heading[1])}</div>;
        return <div key={i} className="operator-p">{renderInline(line)}</div>;
      })}
    </>
  );
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

// Encode an AudioBuffer to 16-bit mono PCM WAV (browser-recorded audio is
// usually webm/opus, while the STT model expects wav/mp3).
function encodeWav(audioBuffer: AudioBuffer): ArrayBuffer {
  const samples = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const wav = encodeWav(audioBuffer);
    const bytes = new Uint8Array(wav);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

export function OperatorAssistant({ onApplied }: OperatorAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // Voice conversation state (max 2 minutes per session by default).
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceSession, setVoiceSession] = useState<VoiceSession | null>(null);
  const [voiceRemaining, setVoiceRemaining] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const autoStopRef = useRef<number>(0);
  const recordTimerRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const voiceSessionRef = useRef<VoiceSession | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    voiceSessionRef.current = voiceSession;
  }, [voiceSession]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, busy, voiceMode]);

  useEffect(() => {
    if (!voiceSession) {
      setVoiceRemaining(0);
      return;
    }
    const tick = () =>
      setVoiceRemaining(Math.max(0, Math.ceil((voiceSession.expiresAt - Date.now()) / 1000)));
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [voiceSession]);

  const stopRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = 0;
    }
    if (autoStopRef.current) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = 0;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const endVoiceMode = () => {
    stopRecording();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setVoiceMode(false);
    setVoiceSession(null);
    setVoiceRemaining(0);
  };

  useEffect(() => {
    if (!voiceMode || !voiceSession) return;
    // Compare against the server-issued expiry, not the countdown state. On the
    // first render after starting, voiceRemaining is still 0 before the tick
    // runs, which would otherwise end the session immediately.
    if (Date.now() >= voiceSession.expiresAt) {
      endVoiceMode();
      setVoiceError('Sesi suara 2 menit berakhir. Mulai sesi baru untuk melanjutkan.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRemaining, voiceMode, voiceSession]);

  const playAudio = (base64: string, mimeType: string) => {
    try {
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(`data:${mimeType};base64,${base64}`);
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
    } catch {
      // autoplay can be rejected; the transcript is still visible
    }
  };

  const sendVoiceBlob = async (blob: Blob) => {
    const session = voiceSessionRef.current;
    if (!session) return;
    if (Date.now() >= session.expiresAt) {
      endVoiceMode();
      setVoiceError('Sesi suara 2 menit berakhir. Mulai sesi baru untuk melanjutkan.');
      return;
    }

    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const wavBase64 = await blobToWavBase64(blob);
      const history = messagesRef.current
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await askVoice({
        voiceSessionId: session.voiceSessionId,
        audioBase64: wavBase64,
        format: 'wav',
        messages: history,
      });

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: result.transcript },
        {
          role: 'assistant',
          content: result.reply,
          action: result.action,
          actionState: result.action ? 'pending' : undefined,
        },
      ]);

      if (result.audioBase64) {
        playAudio(result.audioBase64, result.audioMimeType || 'audio/wav');
      }
      if (result.audioError) {
        setVoiceError(`TTS gagal: ${result.audioError}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setVoiceError(message);
      if (message.toLowerCase().includes('berakhir') || message.includes('410')) {
        endVoiceMode();
      }
    } finally {
      setVoiceBusy(false);
    }
  };

  const startRecording = async () => {
    const session = voiceSessionRef.current;
    if (!session || voiceBusy) return;
    if (Date.now() >= session.expiresAt) {
      endVoiceMode();
      setVoiceError('Sesi suara 2 menit berakhir. Mulai sesi baru untuk melanjutkan.');
      return;
    }
    setVoiceError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      mediaStreamRef.current = stream;
      const preferred = 'audio/webm;codecs=opus';
      const recorder = MediaRecorder.isTypeSupported(preferred)
        ? new MediaRecorder(stream, { mimeType: preferred })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) void sendVoiceBlob(blob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = window.setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      // A single utterance is capped so a forgotten recording cannot run forever.
      autoStopRef.current = window.setTimeout(() => stopRecording(), 20000);
    } catch {
      setVoiceError('Tidak bisa mengakses mikrofon. Pastikan izin diberikan dan halaman diakses via HTTPS.');
    }
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else void startRecording();
  };

  const startVoiceMode = async () => {
    setVoiceError(null);
    setError(null);
    setBusy(true);
    try {
      const session = await startVoiceSession();
      setVoiceSession(session);
      setVoiceMode(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setError(null);
    try {
      const history = next
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));
      const reply = await askAssistant(history);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply.reply,
          action: reply.action,
          actionState: reply.action ? 'pending' : undefined,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const resolveAction = async (index: number, approve: boolean) => {
    const target = messages[index];
    if (!target?.action) return;
    if (!approve) {
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, actionState: 'dismissed' } : m))
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const note = await applyAssistantAction(target.action);
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, actionState: 'applied', actionNote: note } : m))
      );
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const voiceTimerText = `${Math.floor(voiceRemaining / 60)}:${String(voiceRemaining % 60).padStart(2, '0')}`;

  return (
    <>
      <button
        type="button"
        className={`operator-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Tutup asisten operator' : 'Buka asisten operator'}
        title="Asisten operator"
      >
        <img className="operator-fab-logo" src="/logo-ganesha-chatbot.png" alt="" />
      </button>

      {open && (
        <section className="operator-panel no-print" aria-label="Asisten operator">
          <header className="operator-head">
            <div>
              <strong>Asisten operator</strong>
              <span className="operator-sub">Baca data &amp; usulkan perubahan</span>
            </div>
            <div className="operator-head-actions">
              {!voiceMode ? (
                <button
                  type="button"
                  className="operator-mic-btn"
                  onClick={startVoiceMode}
                  disabled={busy}
                  title="Mode suara (maksimal 2 menit)"
                  aria-label="Mulai mode suara"
                >
                  🎙️
                </button>
              ) : (
                <button
                  type="button"
                  className="operator-mic-btn active"
                  onClick={endVoiceMode}
                  title="Akhiri mode suara"
                  aria-label="Akhiri mode suara"
                >
                  ⏹
                </button>
              )}
              <button type="button" className="operator-close" onClick={() => setOpen(false)} aria-label="Tutup">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </header>

          {voiceMode && (
            <div className="operator-voice-bar">
              <div className="operator-voice-status">
                <span className={`operator-voice-dot ${recording ? 'recording' : ''}`} />
                <span>
                  {recording
                    ? `Merekam ${recordSeconds}s`
                    : voiceBusy
                      ? 'Memproses suara…'
                      : 'Mode suara'}
                </span>
              </div>
              <span className={`operator-voice-timer ${voiceRemaining <= 15 ? 'low' : ''}`}>
                {voiceTimerText}
              </span>
              <button
                type="button"
                className={`operator-voice-record ${recording ? 'recording' : ''}`}
                onClick={toggleRecording}
                disabled={voiceBusy}
              >
                {recording ? 'Kirim' : 'Bicara'}
              </button>
            </div>
          )}

          <div className="operator-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="operator-empty">
                <p>Minta ringkasan data, cari sesi, atau minta perubahan zona/domain.</p>
                <p className="hint-text">
                  Perubahan data tidak langsung dijalankan — Anda menyetujuinya dulu.
                </p>
                <div className="operator-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="operator-chip" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`operator-msg ${m.role}`}>
                <div className="operator-bubble"><MessageBody text={m.content} /></div>
                {m.action && (
                  <div className={`operator-action ${m.actionState ?? 'pending'}`}>
                    <span className="operator-action-title">{describeAssistantAction(m.action)}</span>
                    {m.actionState === 'pending' && (
                      <div className="operator-action-row">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => resolveAction(i, true)}
                          disabled={busy}
                        >
                          Terapkan
                        </button>
                        <button
                          type="button"
                          className="secondary btn-sm"
                          onClick={() => resolveAction(i, false)}
                          disabled={busy}
                        >
                          Batal
                        </button>
                      </div>
                    )}
                    {m.actionState === 'applied' && (
                      <span className="operator-action-note ok">{m.actionNote}</span>
                    )}
                    {m.actionState === 'dismissed' && (
                      <span className="operator-action-note">Dibatalkan.</span>
                    )}
                  </div>
                )}
              </div>
            ))}

            {busy && <div className="operator-typing">Asisten sedang mengetik…</div>}
            {voiceBusy && <div className="operator-typing">Memproses suara…</div>}
            {error && <div className="alert alert-err">{error}</div>}
            {voiceError && <div className="alert alert-err">{voiceError}</div>}
          </div>

          <form
            className="operator-input"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Tanya data atau minta perubahan…"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !input.trim()}>
              Kirim
            </button>
          </form>
        </section>
      )}
    </>
  );
}
