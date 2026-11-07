// Multi-frame plate consensus for gate OCR.
// Aggregates several VLM readings of the same vehicle into one decision.

export function normalizePlateValue(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

// Indonesian plate shape: 1-2 letters, 1-4 digits, optional 0-3 letters
const ID_PLATE_RE = /^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$/;

export function isValidIdPlate(plate) {
  return ID_PLATE_RE.test(normalizePlateValue(plate));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Majority vote per character position, used when no full string gets a majority
function mergeByPosition(plates) {
  const lengths = new Map();
  for (const p of plates) lengths.set(p.length, (lengths.get(p.length) || 0) + 1);
  const targetLength = [...lengths.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const aligned = plates.filter((p) => p.length === targetLength);

  let out = '';
  for (let i = 0; i < targetLength; i += 1) {
    const votes = new Map();
    for (const p of aligned) votes.set(p[i], (votes.get(p[i]) || 0) + 1);
    const [char] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    out += char;
  }
  return out;
}

/**
 * @param {Array<{plate: string|null, confidence?: number, error?: string}>} frames
 * @returns {{
 *   plate: string|null,
 *   confidence: number,
 *   accepted: boolean,
 *   votes: number,
 *   total: number,
 *   candidates: Array<{plate: string, votes: number, confidence: number}>,
 *   reason: string,
 * }}
 */
export function consensusPlate(frames) {
  const total = frames.length;
  const usable = frames.filter((f) => f && f.plate);

  if (!usable.length) {
    return {
      plate: null,
      confidence: 0,
      accepted: false,
      votes: 0,
      total,
      candidates: [],
      reason: 'Tidak ada frame yang terbaca',
    };
  }

  const groups = new Map();
  for (const frame of usable) {
    const plate = normalizePlateValue(frame.plate);
    if (!plate) continue;
    const entry = groups.get(plate) || { plate, votes: 0, confidences: [] };
    entry.votes += 1;
    entry.confidences.push(typeof frame.confidence === 'number' ? frame.confidence : 0.5);
    groups.set(plate, entry);
  }

  const candidates = [...groups.values()]
    .map((g) => ({ plate: g.plate, votes: g.votes, confidence: mean(g.confidences) }))
    .sort((a, b) => b.votes - a.votes || b.confidence - a.confidence);

  const winner = candidates[0];
  const agreement = winner.votes / total;
  const confidence = Math.round(Math.min(0.99, 0.65 * agreement + 0.35 * winner.confidence) * 100) / 100;

  // Auto-accept rules: clear majority, or a single strong reading
  const hasMajority = winner.votes >= 2 && agreement >= 0.5;
  const strongSingle = total === 1 && winner.confidence >= 0.85;
  const accepted = (hasMajority || strongSingle) && isValidIdPlate(winner.plate);

  let plate = winner.plate;
  let reason = accepted ? 'Konsensus tercapai' : 'Konsensus lemah';

  // No clear winner: try character-level merge to recover a readable plate
  if (!accepted && groups.size > 1) {
    const merged = mergeByPosition(usable.map((f) => normalizePlateValue(f.plate)));
    if (merged && isValidIdPlate(merged)) {
      plate = merged;
      reason = 'Hasil gabungan karakter antar-frame (perlu verifikasi)';
    }
  }

  if (!isValidIdPlate(winner.plate) && plate === winner.plate) {
    reason = 'Format plat tidak dikenali';
  }

  return {
    plate,
    confidence,
    accepted,
    votes: winner.votes,
    total,
    candidates: candidates.slice(0, 4),
    reason,
  };
}
