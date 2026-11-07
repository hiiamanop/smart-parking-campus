import { useEffect, useRef, useState } from 'react';
import {
  askAssistant,
  applyAssistantAction,
  describeAssistantAction,
  type AssistantAction,
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

export function OperatorAssistant({ onApplied }: OperatorAssistantProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, open, busy]);

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
            <button type="button" className="operator-close" onClick={() => setOpen(false)} aria-label="Tutup">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

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
            {error && <div className="alert alert-err">{error}</div>}
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
