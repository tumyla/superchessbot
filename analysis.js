// analysis.js — move classification, accuracy and opening detection.

import { OPENINGS } from './openings.js';

export const MATE_CP = 100000;

// classification metadata (Turkish labels + own glyphs/colors)
export const CLASS = {
  brilliant:  { tr: 'Muhteşem',  sym: '!!', color: 'var(--c-brilliant)' },
  great:      { tr: 'Harika',    sym: '!',  color: 'var(--c-great)' },
  best:       { tr: 'En İyi',    sym: '★',  color: 'var(--c-best)' },
  excellent:  { tr: 'Mükemmel',  sym: '✓',  color: 'var(--c-excellent)' },
  good:       { tr: 'İyi',       sym: '✓',  color: 'var(--c-good)' },
  book:       { tr: 'Kitap',     sym: '◆',  color: 'var(--c-book)' },
  forced:     { tr: 'Zorunlu',   sym: '⊡',  color: 'var(--c-forced)' },
  inaccuracy: { tr: 'Yanlışlık', sym: '?!', color: 'var(--c-inaccuracy)' },
  mistake:    { tr: 'Hata',      sym: '?',  color: 'var(--c-mistake)' },
  miss:       { tr: 'Kaçırılan', sym: '✗',  color: 'var(--c-miss)' },
  blunder:    { tr: 'Gaf',       sym: '??', color: 'var(--c-blunder)' },
};

// Logistic: centipawns (one side's perspective) -> that side's win% (0..100)
export function cpToWin(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Per-move accuracy from a loss value (win% points). Lichess CAPS curve.
export function moveAccuracy(loss) {
  const a = 103.1668 * Math.exp(-0.04354 * Math.max(0, loss)) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// Clamp an evaluation (centipawns) to a practical range so mate scores
// (±MATE_CP) don't blow up centipawn-loss math.
function clampCp(cp) { return Math.max(-1500, Math.min(1500, cp || 0)); }

// Blended loss (in win% points), from the MOVER's perspective.
// In contested positions it equals the pure win%-loss (so balanced games are
// unchanged). In clearly decided positions (win% near 0/100, where win%-loss
// saturates to ~0) it mixes in a scaled centipawn-loss so that missed wins and
// mistakes-while-losing still register — closer to chess.com's behaviour.
export function effectiveLoss(o) {
  const { winBefore, winAfter, bestCpMover, afterCpMover } = o;
  const winLoss = Math.max(0, winBefore - winAfter);
  const cpLoss = Math.max(0, clampCp(bestCpMover) - clampCp(afterCpMover));
  // saturation: 0 while win% is within [25,75], ramping to 1 by win% <=5 or >=95
  const sat = Math.max(0, Math.min(1, (Math.abs(winBefore - 50) - 25) / 20));
  const cpComponent = Math.min(cpLoss / 12, 50) * sat;
  return Math.max(winLoss, cpComponent);
}

// Aggregate per-move accuracies into a game accuracy. Mean of the arithmetic
// and harmonic means (Lichess-style): bad moves pull the score down harder than
// a plain average, matching chess.com more closely.
export function aggregateAccuracy(arr) {
  if (!arr || !arr.length) return 0;
  const ari = arr.reduce((s, a) => s + a, 0) / arr.length;
  const harm = arr.length / arr.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return (ari + harm) / 2;
}

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function materialWhiteMinusBlack(fen) {
  const board = fen.split(' ')[0];
  let s = 0;
  for (const ch of board) {
    if (ch >= 'A' && ch <= 'Z') { const v = VAL[ch.toLowerCase()]; if (v) s += v; }
    else if (ch >= 'a' && ch <= 'z') { const v = VAL[ch]; if (v) s -= v; }
  }
  return s;
}

// Core classifier. All win% values are from the MOVER's perspective.
// sacAmount = net material (pawns) the mover gives up after the opponent's best
// reply (0 if not a sacrifice). `loss` is the blended loss from effectiveLoss();
// if omitted it falls back to the pure win%-loss.
export function classifyMove(o) {
  const { isBest, sacAmount, winBefore, winAfter, pv2WinBefore, afterCpMover, bestCpMover, loss } = o;

  if (isBest) {
    // Brilliant: a genuine sacrifice that stays good for the mover.
    const okSac = winBefore < 88 ? (sacAmount >= 2.0 && winAfter >= 50) : (sacAmount >= 2.5 && winAfter >= 60);
    if (okSac) return 'brilliant';
    // Great: clearly the single strong move (big gap to the 2nd-best).
    if (pv2WinBefore != null && (winBefore - pv2WinBefore) >= 12 && winBefore >= 20 && winBefore <= 92) return 'great';
    return 'best';
  }

  const L = (loss != null) ? loss : Math.max(0, winBefore - winAfter);
  const bc = clampCp(bestCpMover), ac = clampCp(afterCpMover);

  // Miss: a clearly bigger win was available but the move kept you clearly
  // winning (e.g. a missed tactic/mate). Centipawn-based so it works even when
  // win% is already saturated.
  const missCp = bc >= 400 && ac >= 150 && (bc - ac) >= 350;
  // Fallback win%-based miss (was winning, didn't drop into a lost game).
  const missWin = winBefore >= 55 && afterCpMover > -120;

  if (L <= 3) return 'excellent';
  if (L <= 6) return 'good';
  if (L <= 12) return missCp ? 'miss' : 'inaccuracy';
  if (L <= 24) return (missCp || missWin) ? 'miss' : 'mistake';
  return (missCp || missWin) ? 'miss' : 'blunder';
}

// Opening detection over a list of SAN moves (chess.js canonical SAN).
export function analyzeOpenings(sanList) {
  if (!sanList.length) return null;
  const seqAt = [];
  let acc = '';
  for (let k = 0; k < sanList.length; k++) { acc = k === 0 ? sanList[0] : acc + ' ' + sanList[k]; seqAt[k] = acc; }
  const fullGame = seqAt[seqAt.length - 1];

  let deepest = -1;
  const maxCheck = Math.min(sanList.length, 20);
  for (let k = 0; k < maxCheck; k++) {
    const s = seqAt[k];
    let inBook = false;
    for (let j = 0; j < OPENINGS.length; j++) {
      const os = OPENINGS[j][0];
      if (os.length < s.length) continue;
      if (os === s || os.startsWith(s + ' ')) { inBook = true; break; }
    }
    if (inBook) deepest = k; else break;
  }

  let name = null, eco = null, bestLen = -1;
  for (let j = 0; j < OPENINGS.length; j++) {
    const os = OPENINGS[j][0];
    if (os.length > fullGame.length) continue;
    if (fullGame === os || fullGame.startsWith(os + ' ')) {
      if (os.length > bestLen) { bestLen = os.length; name = OPENINGS[j][1]; eco = OPENINGS[j][2]; }
    }
  }
  if (deepest < 0 && !name) return null;
  return { deepestBookPly: deepest, name, eco };
}
