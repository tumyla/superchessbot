// app.js — orchestration + UI for ŞahAnaliz.

import { Chess } from './chess.js';
import { Engine } from './engine.js';
import { fetchChessComGame, loadPgnGame, fetchPlayerGames } from './chesscom.js';
import { CLASS, cpToWin, moveAccuracy, materialWhiteMinusBlack, classifyMove, analyzeOpenings, MATE_CP, effectiveLoss, aggregateAccuracy } from './analysis.js';
import { PIECES } from './pieces.js';
import { describeOpening } from './openings-info.js';
import { initLang, getLang, setLang, t, applyI18n, LANGS } from './i18n.js';
import { openShareCard } from './share.js';

/* ------------------------------- state -------------------------------- */
let game = null;            // { moves:[{san,uci}], fens:[...], meta }
let evals = [];             // per node: { cpWhite, mate, bestUci, pv2, terminal? }
let classifications = [];   // per move index
let accuracies = [];        // per move index
let curPly = 0;             // 0 = initial; shows fens[curPly]
let flipped = false;
let engine = null;
let analyzing = false;
let opening = null;
let depthLevel = 'balanced';
let runToken = 0;           // cancels a stale analysis loop
let criticalPlies = [];     // ply indices of biggest eval swings
let simpleMode = false;     // "only show my mistakes"
let simpleSide = 'all';     // 'all' | 'w' | 'b'
let userSide = null;        // 'w' | 'b' | null — which side is the user (from username flow)
let pendingUserName = null; // lowercased username from the last username search

const DEPTHS = { fast: 10, balanced: 12, deep: 15 };
const DEPTH_NOTE_KEY = { fast: 'noteFast', balanced: 'noteBalanced', deep: 'noteDeep' };

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PIECE = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clsLabel = (k) => t('cls' + cap(k));

/* --------------------------- sample (Opera Game) ---------------------- */
const SAMPLE_PGN = `[Event "Paris Opera"]
[Site "Paris"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke / Count"]
[Result "1-0"]
[WhiteElo "2500"]
[BlackElo "2200"]
[TimeControl "Klasik"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

/* ------------------------------ UI: panes ----------------------------- */
function setMode(mode) {
  document.querySelectorAll('#seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('pane-user').style.display = mode === 'user' ? '' : 'none';
  $('pane-link').style.display = mode === 'link' ? '' : 'none';
  $('pane-pgn').style.display = mode === 'pgn' ? '' : 'none';
}
function showError(msg) { $('errMsg').textContent = msg; $('err').classList.add('show'); }
function clearError() { $('err').classList.remove('show'); }

function showIntro() {
  $('boardPage').classList.remove('show');
  $('intro').style.display = '';
  $('newGameBtn').style.display = 'none';
}
function showBoardPage() {
  $('intro').style.display = 'none';
  $('boardPage').classList.add('show');
  $('newGameBtn').style.display = '';
}
function resetToIntro() { runToken++; analyzing = false; showIntro(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

/* ----------------------------- FEN helpers ---------------------------- */
function parseFEN(fen) {
  const rows = fen.split(' ')[0].split('/');
  const b = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { const n = +ch; for (let k = 0; k < n; k++) row.push(null); }
      else row.push(ch);
    }
    b.push(row);
  }
  return b;
}
function findKing(b, stm) {
  const target = stm === 'w' ? 'K' : 'k';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (b[r][f] === target) return FILES[f] + (8 - r);
  return null;
}

/* ------------------------------ rendering ----------------------------- */
function renderBoard() {
  const fen = game.fens[curPly];
  const b = parseFEN(fen);
  const board = $('board');
  board.innerHTML = '';

  let fromSq = null, toSq = null;
  if (curPly > 0) { const u = game.moves[curPly - 1].uci; fromSq = u.slice(0, 2); toSq = u.slice(2, 4); }

  let checkSq = null;
  try { const c = new Chess(fen); if (c.isCheck && c.isCheck()) checkSq = findKing(b, fen.split(' ')[1]); } catch (e) {}

  const rows = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const cols = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = rows[vr], f = cols[vc];
      const rankNum = 8 - r, fileChar = FILES[f], sq = fileChar + rankNum;
      const light = (f + rankNum) % 2 === 0;
      const div = document.createElement('div');
      div.className = 'sq ' + (light ? 'light' : 'dark');
      if (sq === fromSq || sq === toSq) div.classList.add('hl');
      if (sq === checkSq) div.classList.add('check');
      if (vr === 7) { const c = document.createElement('span'); c.className = 'co f'; c.textContent = fileChar; div.appendChild(c); }
      if (vc === 0) { const c = document.createElement('span'); c.className = 'co r'; c.textContent = rankNum; div.appendChild(c); }
      const cell = b[r][f];
      if (cell) {
        const white = cell === cell.toUpperCase();
        const p = document.createElement('span');
        p.className = 'pc ' + (white ? 'w' : 'b');
        p.innerHTML = PIECES[cell] || '';
        div.appendChild(p);
      }
      if (sq === toSq && curPly > 0) {
        const key = classifications[curPly - 1];
        if (key) { const meta = CLASS[key]; const badge = document.createElement('div'); badge.className = 'badge'; badge.style.background = meta.color; badge.textContent = meta.sym; div.appendChild(badge); }
      }
      board.appendChild(div);
    }
  }
}

function fmtEval(ev) {
  if (!ev) return '';
  if (ev.terminal === 'mate') return '#';
  if (ev.terminal === 'draw') return '½';
  if (ev.mate != null) { const w = ev.mate; return (w > 0 ? 'M' : '-M') + Math.abs(w); }
  const v = ev.cpWhite / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1);
}

function renderEvalBar() {
  const ev = evals[curPly];
  const white = $('evalWhite'), top = $('evalTop'), bot = $('evalBot');
  let pct = 50, txt = '', whiteLeads = true;
  if (ev) { pct = Math.max(2, Math.min(98, cpToWin(ev.cpWhite))); txt = fmtEval(ev); whiteLeads = ev.cpWhite >= 0; }

  if (flipped) { white.style.top = '0'; white.style.bottom = 'auto'; }
  else { white.style.bottom = '0'; white.style.top = 'auto'; }
  white.style.height = pct + '%';

  top.textContent = ''; bot.textContent = '';
  const onBottom = flipped ? !whiteLeads : whiteLeads;
  const el = onBottom ? bot : top;
  el.textContent = txt;
  el.style.color = whiteLeads ? '#2b2b29' : '#e6e6e2';
}

function renderGraph() {
  const holder = $('graphHolder');
  const N = game.fens.length;
  const W = 100, H = 40;
  const xs = (i) => (N <= 1 ? 0 : (i * W) / (N - 1));
  const ys = (win) => H - (win / 100) * H;

  let last = 50;
  const pts = [];
  for (let i = 0; i < N; i++) {
    let win = last;
    if (evals[i]) { win = cpToWin(evals[i].cpWhite); last = win; }
    pts.push([xs(i), ys(win)]);
  }
  let area = `M 0,${H} `;
  for (const p of pts) area += `L ${p[0].toFixed(2)},${p[1].toFixed(2)} `;
  area += `L ${W},${H} Z`;
  let edge = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)} ` + pts.slice(1).map((p) => `L ${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const cx = xs(curPly).toFixed(2);
  const marks = (criticalPlies || []).map((p) => {
    const mx = xs(p).toFixed(2);
    return `<line x1="${mx}" y1="0" x2="${mx}" y2="${H}" stroke="#e8923a" stroke-width="0.8" stroke-dasharray="1.5 1.5" vector-effect="non-scaling-stroke" opacity="0.85"/>`;
  }).join('');

  holder.innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" id="evalSvg">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#2b2b29"/>
      <path d="${area}" fill="#e9e9e3"/>
      <path d="${edge}" fill="none" stroke="#b9bdc2" stroke-width="0.5" vector-effect="non-scaling-stroke"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#6b6864" stroke-width="0.5" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
      ${marks}
      <line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#9bd45f" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
    </svg>`;

  const svg = $('evalSvg');
  svg.addEventListener('click', (e) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    let i = N <= 1 ? 0 : Math.round((x / W) * (N - 1));
    gotoPly(Math.max(0, Math.min(N - 1, i)));
  });
}

function moveCell(i) {
  const ply = i + 1;
  const d = document.createElement('div');
  d.className = 'mv';
  d.dataset.ply = ply;
  applyGlyph(d, classifications[i]);
  const s = document.createElement('span'); s.className = 'san'; s.textContent = game.moves[i].san; d.appendChild(s);
  d.addEventListener('click', () => gotoPly(ply));
  return d;
}
function applyGlyph(cell, key) {
  const old = cell.querySelector('.g'); if (old) old.remove();
  if (!key) return;
  const meta = CLASS[key];
  const g = document.createElement('span'); g.className = 'g'; g.style.background = meta.color; g.textContent = meta.sym;
  cell.insertBefore(g, cell.firstChild);
}
function renderMoves() {
  const ml = $('moveList'); ml.innerHTML = '';
  if (simpleMode) {
    const bad = ['inaccuracy', 'mistake', 'miss', 'blunder'];
    let any = false;
    for (let i = 0; i < game.moves.length; i++) {
      const k = classifications[i];
      if (!k || bad.indexOf(k) < 0) continue;
      const white = i % 2 === 0;
      if (simpleSide === 'w' && !white) continue;
      if (simpleSide === 'b' && white) continue;
      any = true;
      const row = document.createElement('div'); row.className = 'mrow simple';
      const no = document.createElement('div'); no.className = 'no'; no.textContent = (Math.floor(i / 2) + 1) + (white ? '.' : '…'); row.appendChild(no);
      const cell = moveCell(i); cell.classList.add('wide'); row.appendChild(cell);
      ml.appendChild(row);
    }
    if (!any) { const e = document.createElement('div'); e.className = 'empty-note'; e.textContent = t('simpleEmpty'); ml.appendChild(e); }
    highlightMove();
    return;
  }
  for (let i = 0; i < game.moves.length; i += 2) {
    const row = document.createElement('div'); row.className = 'mrow';
    const no = document.createElement('div'); no.className = 'no'; no.textContent = (i / 2 + 1) + '.'; row.appendChild(no);
    row.appendChild(moveCell(i));
    if (i + 1 < game.moves.length) row.appendChild(moveCell(i + 1));
    else { const e = document.createElement('div'); e.className = 'mv empty'; row.appendChild(e); }
    ml.appendChild(row);
  }
  highlightMove();
}
function updateGlyph(i) { const cell = document.querySelector(`.mv[data-ply="${i + 1}"]`); if (cell) applyGlyph(cell, classifications[i]); }
function highlightMove() {
  document.querySelectorAll('.mv.cur').forEach((e) => e.classList.remove('cur'));
  if (curPly > 0) {
    const cell = document.querySelector(`.mv[data-ply="${curPly}"]`);
    if (cell) {
      cell.classList.add('cur');
      // scroll ONLY the move-list box (not the whole page)
      const list = $('moveList');
      if (list) {
        const lr = list.getBoundingClientRect();
        const cr = cell.getBoundingClientRect();
        if (cr.top < lr.top) list.scrollTop -= (lr.top - cr.top) + 8;
        else if (cr.bottom > lr.bottom) list.scrollTop += (cr.bottom - lr.bottom) + 8;
      }
    }
  }
}

function renderHeader() {
  const m = game.meta, gh = $('gameHeader'); gh.innerHTML = '';
  const res = document.createElement('div'); res.className = 'res'; res.textContent = m.result || '*'; gh.appendChild(res);
  const names = document.createElement('div');
  names.innerHTML = `<div style="font-family:var(--font-display);font-weight:600;font-size:15px">${esc(m.white)} <span class="vs">${m.whiteElo ? '(' + esc(m.whiteElo) + ')' : ''}</span> &nbsp;—&nbsp; ${esc(m.black)} <span class="vs">${m.blackElo ? '(' + esc(m.blackElo) + ')' : ''}</span></div>`;
  gh.appendChild(names);
  const meta = document.createElement('div'); meta.className = 'meta';
  const bits = [];
  if (m.event) bits.push(m.event);
  if (m.date && !/\?\?/.test(m.date)) bits.push(m.date);
  if (m.timeClass) bits.push(m.timeClass);
  meta.innerHTML = bits.map((b) => `<span class="pill">${esc(String(b))}</span>`).join('');
  gh.appendChild(meta);
  const back = document.createElement('button'); back.className = 'ghost-btn back'; back.textContent = t('backNew'); back.onclick = resetToIntro; gh.appendChild(back);
}

function renderOpening() {
  if (opening && (opening.name || opening.eco)) {
    $('openingBox').style.display = '';
    $('openingEco').textContent = opening.eco || '';
    $('openingName').textContent = opening.name || t('openingTitle');
    const info = describeOpening(opening.name, opening.eco, game && game.moves[0] ? game.moves[0].san : '');
    const d = $('openingDesc');
    if (d) { d.textContent = info || t('openingUnknown'); d.style.display = ''; }
  } else $('openingBox').style.display = 'none';
}

function uciToSan(fen, uci) {
  if (!uci) return null;
  try {
    const c = new Chess(fen);
    const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    return m ? m.san : null;
  } catch (e) { return null; }
}

function classWhy(cls, loss) {
  if (!cls) return '';
  return t('why' + cap(cls), { loss });
}

function renderMoveInfo() {
  const box = $('moveInfo');
  if (!game || curPly <= 0) { box.style.display = 'none'; return; }
  const i = curPly - 1;
  const cls = classifications[i];
  const before = evals[i], after = evals[i + 1];
  box.style.display = '';
  const playedSan = game.moves[i].san;
  $('miMove').textContent = playedSan;

  const badge = $('miBadge'), label = $('miLabel'), why = $('miWhy'), best = $('miBest'), ev = $('miEval');
  if (cls) {
    const meta = CLASS[cls];
    badge.style.display = ''; badge.style.background = meta.color; badge.textContent = meta.sym;
    label.textContent = clsLabel(cls); label.style.color = meta.color; box.style.borderLeftColor = meta.color;
  } else {
    badge.style.display = 'none'; label.textContent = t('miAnalyzing'); label.style.color = 'var(--text-dim)'; box.style.borderLeftColor = 'var(--line)';
  }

  if (!cls || !before || !after) {
    why.textContent = t('progAnalyzingSub');
    best.style.display = 'none'; ev.textContent = '';
    return;
  }

  const moverWhite = i % 2 === 0;
  const bMover = moverWhite ? before.cpWhite : -before.cpWhite;
  const aMover = moverWhite ? after.cpWhite : -after.cpWhite;
  const loss = Math.max(0, Math.round(cpToWin(bMover) - cpToWin(aMover)));
  let whyText = classWhy(cls, loss);
  if (cls === 'inaccuracy' || cls === 'mistake' || cls === 'miss' || cls === 'blunder') {
    const reason = generateReason(i, moverWhite);
    if (reason) whyText += ' ' + reason;
  }
  why.textContent = whyText;

  const bestUci = before.bestUci;
  const bestSan = uciToSan(game.fens[i], bestUci);
  const isBest = !!(bestUci && game.moves[i].uci === bestUci);
  if (!isBest && bestSan && bestSan !== playedSan && cls !== 'book' && cls !== 'forced') {
    best.style.display = ''; best.innerHTML = esc(t('miBetter')) + ' <b>' + esc(bestSan) + '</b>';
  } else best.style.display = 'none';

  ev.innerHTML = esc(t('miEval')) + ' <b>' + esc(fmtEval(before)) + '</b> → <b>' + esc(fmtEval(after)) + '</b> <span style="opacity:.65">' + esc(t('miWhitePov')) + '</span>';
}

function pieceName(ch) {
  const m = { q: 'pieceQ', r: 'pieceR', b: 'pieceB', n: 'pieceN', p: 'pieceP' };
  return t(m[String(ch).toLowerCase()] || 'pieceMaterial');
}

// One short, position-aware reason for a weak move (material / king safety / initiative).
function generateReason(i, moverWhite) {
  // (1) does the opponent's best reply win material?
  const after = evals[i + 1];
  if (after && after.bestUci) {
    try {
      const c = new Chess(game.fens[i + 1]);
      const before = materialWhiteMinusBlack(game.fens[i + 1]);
      const mv = c.move({ from: after.bestUci.slice(0, 2), to: after.bestUci.slice(2, 4), promotion: after.bestUci.slice(4, 5) || undefined });
      if (mv && mv.captured) {
        const afterMat = materialWhiteMinusBlack(c.fen());
        const moverDelta = moverWhite ? (afterMat - before) : (before - afterMat);
        if (moverDelta <= -1) return t('reasonMaterial', { piece: pieceName(mv.captured) });
      }
    } catch (e) {}
  }
  // (2) king-safety: a pawn push in front of the mover's own castled king
  try {
    const san = game.moves[i].san;
    const isPawn = /^[a-h]/.test(san);
    if (isPawn) {
      const pawnFile = san[0];
      const b = parseFEN(game.fens[i + 1]);
      const kSq = findKing(b, moverWhite ? 'w' : 'b');
      if (kSq) {
        const kFile = kSq[0];
        const kingSide = (f) => f >= 'f';
        const queenSide = (f) => f <= 'c';
        if (kingSide(kFile) && kingSide(pawnFile)) return t('reasonKingside');
        if (queenSide(kFile) && queenSide(pawnFile)) return t('reasonQueenside');
      }
    }
  } catch (e) {}
  // (3) fallback
  return t('reasonInitiative');
}

function renderSummary() {
  const wA = [], bA = [];
  for (let i = 0; i < accuracies.length; i++) { if (accuracies[i] == null) continue; (i % 2 === 0 ? wA : bA).push(accuracies[i]); }
  $('accW').textContent = wA.length ? aggregateAccuracy(wA).toFixed(1) : '—';
  $('accB').textContent = bA.length ? aggregateAccuracy(bA).toFixed(1) : '—';
  $('accWhoW').textContent = game.meta.white;
  $('accWhoB').textContent = game.meta.black;

  const order = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  const cw = {}, cb = {}; order.forEach((k) => { cw[k] = 0; cb[k] = 0; });
  for (let i = 0; i < classifications.length; i++) { const k = classifications[i]; if (!k) continue; (i % 2 === 0 ? cw : cb)[k]++; }

  const C = $('counts'); C.innerHTML = '';
  const cell = (cls, txt) => { const d = document.createElement('div'); d.className = cls; d.textContent = txt; return d; };
  C.appendChild(cell('c-w hdr', truncate(game.meta.white, 9)));
  C.appendChild(cell('c-name hdr', ''));
  C.appendChild(cell('c-b hdr', truncate(game.meta.black, 9)));
  for (const k of order) {
    const meta = CLASS[k];
    C.appendChild(cell('c-w', cw[k]));
    const name = document.createElement('div'); name.className = 'c-name';
    const g = document.createElement('span'); g.className = 'g'; g.style.background = meta.color; g.textContent = meta.sym;
    const nm = document.createElement('span'); nm.textContent = clsLabel(k);
    name.appendChild(g); name.appendChild(nm); C.appendChild(name);
    C.appendChild(cell('c-b', cb[k]));
  }
}
function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/* ----------------------- critical moments (#2) ------------------------ */
function computeCritical() {
  criticalPlies = [];
  const N = game.fens.length;
  const win = new Array(N).fill(50);
  let last = 50;
  for (let i = 0; i < N; i++) { if (evals[i]) last = cpToWin(evals[i].cpWhite); win[i] = last; }
  const swings = [];
  for (let i = 0; i < game.moves.length; i++) {
    if (!evals[i] || !evals[i + 1]) continue;
    swings.push({ i, delta: Math.abs(win[i + 1] - win[i]) });
  }
  swings.sort((a, b) => b.delta - a.delta);
  const picked = [];
  for (const s of swings) { if (s.delta < 12 || picked.length >= 3) break; picked.push(s); }
  picked.sort((a, b) => a.i - b.i);
  criticalPlies = picked.map((s) => s.i + 1);
}

function renderCritical() {
  const card = $('criticalCard'); const list = $('criticalList');
  if (!card || !list) return;
  list.innerHTML = '';
  if (!criticalPlies || !criticalPlies.length) {
    const e = document.createElement('div'); e.className = 'empty-note'; e.textContent = t('criticalNone'); list.appendChild(e);
    return;
  }
  for (const p of criticalPlies) {
    const i = p - 1;
    const white = i % 2 === 0;
    const before = evals[i], after = evals[i + 1];
    const row = document.createElement('div'); row.className = 'crit'; row.tabIndex = 0;
    const no = document.createElement('span'); no.className = 'cno'; no.textContent = (Math.floor(i / 2) + 1) + (white ? '.' : '…');
    const cell = document.createElement('span'); cell.className = 'csan';
    const k = classifications[i];
    if (k) { const g = document.createElement('span'); g.className = 'g'; g.style.background = CLASS[k].color; g.textContent = CLASS[k].sym; cell.appendChild(g); }
    const sm = document.createElement('span'); sm.textContent = game.moves[i].san; cell.appendChild(sm);
    const sw = document.createElement('span'); sw.className = 'cswing'; sw.textContent = fmtEval(before) + ' → ' + fmtEval(after);
    row.appendChild(no); row.appendChild(cell); row.appendChild(sw);
    const go = () => gotoPly(p);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    list.appendChild(row);
  }
}

/* --------------------------- share card (#4) -------------------------- */
function buildShareData() {
  const wA = [], bA = [];
  for (let i = 0; i < accuracies.length; i++) { if (accuracies[i] == null) continue; (i % 2 === 0 ? wA : bA).push(accuracies[i]); }
  const avg = (a) => (a.length ? +aggregateAccuracy(a).toFixed(1) : null);
  const order = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];
  const cw = {}, cb = {}; order.forEach((k) => { cw[k] = 0; cb[k] = 0; });
  for (let i = 0; i < classifications.length; i++) { const k = classifications[i]; if (!k) continue; (i % 2 === 0 ? cw : cb)[k]++; }
  return {
    white: game.meta.white, black: game.meta.black,
    whiteAcc: avg(wA), blackAcc: avg(bA),
    result: game.meta.result || '*',
    openingName: opening ? opening.name : '', eco: opening ? opening.eco : '',
    counts: { white: cw, black: cb },
    whiteIsUser: userSide === 'w', blackIsUser: userSide === 'b',
  };
}

/* --------------------------- simple mode (#6) ------------------------- */
function syncSimpleUI() {
  const tog = $('simpleToggle'); if (tog) tog.classList.toggle('on', simpleMode);
  const sides = $('simpleSides'); if (sides) sides.style.display = simpleMode ? '' : 'none';
  document.querySelectorAll('#simpleSides button').forEach((b) => b.classList.toggle('active', b.dataset.side === simpleSide));
}

/* ----------------------------- i18n re-render ------------------------- */
function computeUserSide(meta) {
  if (!pendingUserName) return null;
  const w = (meta.white || '').toLowerCase(), b = (meta.black || '').toLowerCase();
  if (w === pendingUserName) return 'w';
  if (b === pendingUserName) return 'b';
  return null;
}

function relocalize() {
  applyI18n();
  $('depthNote').textContent = t(DEPTH_NOTE_KEY[depthLevel]);
  syncSimpleUI();
  if (game) {
    renderHeader();
    renderOpening();
    renderMoveInfo();
    renderMoves();
    renderCritical();
    if (!analyzing) renderSummary();
  }
}


/* ----------------------------- navigation ----------------------------- */
function updateNav() {
  const last = game.fens.length - 1;
  $('navStart').disabled = curPly <= 0;
  $('navPrev').disabled = curPly <= 0;
  $('navNext').disabled = curPly >= last;
  $('navEnd').disabled = curPly >= last;
}
function gotoPly(n) {
  if (!game) return;
  curPly = Math.max(0, Math.min(game.fens.length - 1, n));
  renderBoard(); renderEvalBar(); renderGraph(); highlightMove(); renderMoveInfo(); updateNav();
}

/* ------------------------------- engine ------------------------------- */
function terminalEval(fen) {
  let c; try { c = new Chess(fen); } catch (e) { return null; }
  if (c.isCheckmate && c.isCheckmate()) {
    const stmWhite = fen.split(' ')[1] === 'w';
    return { cpWhite: stmWhite ? -MATE_CP : MATE_CP, mate: stmWhite ? -1 : 1, bestUci: null, pv2: null, terminal: 'mate' };
  }
  const draw = (c.isStalemate && c.isStalemate()) || (c.isInsufficientMaterial && c.isInsufficientMaterial()) ||
               (c.isThreefoldRepetition && c.isThreefoldRepetition()) || (c.isDraw && c.isDraw());
  if (draw) return { cpWhite: 0, mate: null, bestUci: null, pv2: null, terminal: 'draw' };
  return null;
}
async function evalNode(i) {
  const fen = game.fens[i];
  const term = terminalEval(fen);
  if (term) return term;
  return engine.analyse(fen, DEPTHS[depthLevel]);
}

// Returns the net material (in pawns) the mover gives up after the opponent's
// best reply. 0 if not a sacrifice / not computable.
function sacrificeAmount(i, moverWhite) {
  const matBeforeW = materialWhiteMinusBlack(game.fens[i]);
  const matBefore = moverWhite ? matBeforeW : -matBeforeW;
  const oppBest = evals[i + 1] && evals[i + 1].bestUci;
  if (!oppBest) return 0;
  try {
    const c = new Chess(game.fens[i + 1]);
    const mv = c.move({ from: oppBest.slice(0, 2), to: oppBest.slice(2, 4), promotion: oppBest.slice(4, 5) || undefined });
    if (!mv) return 0;
    const w = materialWhiteMinusBlack(c.fen());
    const matAfter = moverWhite ? w : -w;
    return matBefore - matAfter;
  } catch (e) { return 0; }
}

function legalMoveCount(fen) {
  try { return new Chess(fen).moves().length; } catch (e) { return 99; }
}

function classifyAt(i) {
  const moverWhite = i % 2 === 0;
  const before = evals[i], after = evals[i + 1];
  // Forced: the mover had only one legal move.
  if (legalMoveCount(game.fens[i]) === 1) return { cls: 'forced', acc: 100 };
  const bestMover = moverWhite ? before.cpWhite : -before.cpWhite;
  const afterMover = moverWhite ? after.cpWhite : -after.cpWhite;
  const winBefore = cpToWin(bestMover);
  const winAfter = cpToWin(afterMover);
  const isBest = !!(before.bestUci && game.moves[i].uci === before.bestUci);
  let pv2WinBefore = null;
  if (before.pv2) { const pv2Mover = moverWhite ? before.pv2.cpWhite : -before.pv2.cpWhite; pv2WinBefore = cpToWin(pv2Mover); }
  const sacAmount = isBest ? sacrificeAmount(i, moverWhite) : 0;
  const L = effectiveLoss({ winBefore, winAfter, bestCpMover: bestMover, afterCpMover: afterMover });
  const cls = classifyMove({ isBest, sacAmount, winBefore, winAfter, pv2WinBefore, afterCpMover: afterMover, bestCpMover: bestMover, loss: L });
  const acc = moveAccuracy(L);
  return { cls, acc };
}

async function runAnalysis() {
  const token = ++runToken;
  analyzing = true;
  const N = game.fens.length;
  evals = new Array(N).fill(null);
  classifications = new Array(game.moves.length).fill(null);
  accuracies = new Array(game.moves.length).fill(null);

  // openings (instant)
  opening = analyzeOpenings(game.moves.map((m) => m.san));
  renderOpening();
  if (opening) for (let k = 0; k <= opening.deepestBookPly; k++) { classifications[k] = 'book'; accuracies[k] = 100; }

  $('progCard').style.display = '';
  $('reviewCard').style.display = 'none';
  $('graphCard').style.display = '';
  $('movesCard').style.display = '';
  if ($('criticalCard')) $('criticalCard').style.display = 'none';
  criticalPlies = [];
  renderMoves(); renderGraph();

  // engine
  $('progText').textContent = t('progEngine');
  $('progSub').textContent = t('progEngineSub');
  if (!engine) { engine = new Engine(); await engine.init(2); }
  if (token !== runToken) return;

  $('progSub').textContent = t('progAnalyzingSub');

  const total = game.moves.length;
  const t0 = Date.now();
  for (let i = 0; i < total; i++) {
    if (token !== runToken) return;
    if (!evals[i]) { evals[i] = await evalNode(i); if (i === 0) { renderEvalBar(); renderGraph(); } }
    if (token !== runToken) return;
    if (!evals[i + 1]) evals[i + 1] = await evalNode(i + 1);
    if (token !== runToken) return;

    if (classifications[i] !== 'book') { const { cls, acc } = classifyAt(i); classifications[i] = cls; accuracies[i] = acc; }
    updateGlyph(i);
    if (curPly === i || curPly === i + 1) { renderBoard(); renderMoveInfo(); }

    const done = i + 1;
    const pct = Math.round((done / total) * 100);
    $('progFill').style.width = pct + '%';
    $('progPct').textContent = pct + '%';
    $('progText').textContent = t('progMove', { done, total });
    const elapsed = (Date.now() - t0) / 1000;
    if (done >= 2) {
      const remain = Math.max(0, Math.round((elapsed / done) * (total - done)));
      $('progSub').textContent = remain > 0 ? t('progEta', { s: remain }) : t('progAlmost');
    }
    renderGraph();

    if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  if (token !== runToken) return;

  computeCritical();
  renderCritical();
  if ($('criticalCard')) $('criticalCard').style.display = '';
  renderGraph();
  renderSummary();
  $('reviewCard').style.display = '';
  $('progCard').style.display = 'none';
  analyzing = false;
}

/* ------------------------------- start -------------------------------- */
function startGame(g) {
  game = g; curPly = 0; flipped = false; opening = null;
  evals = []; classifications = []; accuracies = []; criticalPlies = [];
  userSide = computeUserSide(g.meta);
  simpleMode = false; simpleSide = userSide || 'all';
  syncSimpleUI();
  clearError();
  showBoardPage();
  renderHeader();
  renderBoard(); renderEvalBar(); renderMoveInfo(); updateNav();
  runAnalysis();
}

async function handleLink() {
  const url = $('urlInput').value;
  if (!url.trim()) { showError(t('errNeedUrl')); return; }
  pendingUserName = null;
  clearError();
  const btn = $('goLink'); const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span>' + esc(t('loading')) + '</span>';
  try {
    const g = await fetchChessComGame(url, (s) => { btn.innerHTML = '<span>' + esc(s) + '</span>'; });
    startGame(g);
  } catch (e) {
    showError(e.message || t('errFetchFail'));
  } finally { btn.disabled = false; btn.innerHTML = orig; }
}

function handlePgn() {
  const pgn = $('pgnInput').value;
  if (!pgn.trim()) { showError(t('errNeedPgn')); return; }
  pendingUserName = null;
  try { const g = loadPgnGame(pgn); startGame(g); }
  catch (e) { showError(t('errPgnFail')); }
}

function tcLabel(tc) { return tc ? t('tc' + cap(tc)) : ''; }
function fmtDate(ts) { if (!ts) return ''; try { return new Date(ts * 1000).toLocaleDateString(getLang() + '-' + getLang().toUpperCase()); } catch (e) { return ''; } }

function renderUserGames(list) {
  const box = $('userGames');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="empty-note">' + esc(t('gameNotFound')) + '</div>'; return; }
  const note = document.createElement('div'); note.className = 'empty-note'; note.textContent = t('pickGame'); box.appendChild(note);
  for (const g of list) {
    const row = document.createElement('div'); row.className = 'ugame';
    const res = document.createElement('div'); res.className = 'res'; res.textContent = g.result; row.appendChild(res);
    const who = document.createElement('div'); who.className = 'who';
    who.innerHTML = '<b>' + esc(g.white) + '</b> <span class="elo">' + (g.whiteElo ? g.whiteElo : '') + '</span> – <b>' + esc(g.black) + '</b> <span class="elo">' + (g.blackElo ? g.blackElo : '') + '</span>';
    row.appendChild(who);
    const tags = document.createElement('div'); tags.className = 'tags';
    tags.textContent = [tcLabel(g.timeClass), fmtDate(g.endTime)].filter(Boolean).join(' · ');
    row.appendChild(tags);
    row.addEventListener('click', () => loadApiGame(g));
    box.appendChild(row);
  }
}

function loadApiGame(g) {
  clearError();
  try { startGame(loadPgnGame(g.pgn)); }
  catch (e) { showError(t('errGameLoad')); }
}

async function handleUser() {
  const name = $('userInput').value;
  if (!name.trim()) { showError(t('errNeedUser')); return; }
  pendingUserName = name.trim().toLowerCase();
  clearError();
  const btn = $('goUser'); const orig = btn.innerHTML; btn.disabled = true; btn.innerHTML = '<span>' + esc(t('loading')) + '</span>';
  $('userGames').innerHTML = '<div class="empty-note">' + esc(t('loading')) + '</div>';
  try {
    const list = await fetchPlayerGames(name, (s) => { btn.innerHTML = '<span>' + esc(s) + '</span>'; });
    renderUserGames(list);
  } catch (e) {
    $('userGames').innerHTML = '';
    showError(e.message || t('errUserFail'));
  } finally { btn.disabled = false; btn.innerHTML = orig; }
}

function loadSample() { clearError(); pendingUserName = null; try { startGame(loadPgnGame(SAMPLE_PGN)); } catch (e) { showError(t('errSampleFail')); } }

/* ------------------------------- wiring ------------------------------- */
function wire() {
  document.querySelectorAll('#seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('#depth button').forEach((b) => b.addEventListener('click', () => {
    depthLevel = b.dataset.d;
    document.querySelectorAll('#depth button').forEach((x) => x.classList.toggle('active', x === b));
    $('depthNote').textContent = t(DEPTH_NOTE_KEY[depthLevel]);
  }));
  $('goUser').addEventListener('click', handleUser);
  $('userInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleUser(); });
  $('goLink').addEventListener('click', handleLink);
  $('urlInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLink(); });
  $('goPgn').addEventListener('click', handlePgn);
  $('sampleLink').addEventListener('click', loadSample);
  $('newGameBtn').addEventListener('click', resetToIntro);

  // language selector
  const langSel = $('langSel');
  if (langSel) langSel.addEventListener('change', () => { setLang(langSel.value); relocalize(); });
  // share image
  const sb = $('shareBtn');
  if (sb) sb.addEventListener('click', () => { if (game && !analyzing) openShareCard(buildShareData()); });
  // simple mode
  const st = $('simpleToggle');
  if (st) st.addEventListener('click', () => { simpleMode = !simpleMode; syncSimpleUI(); if (game) renderMoves(); });
  document.querySelectorAll('#simpleSides button').forEach((b) => b.addEventListener('click', () => { simpleSide = b.dataset.side; syncSimpleUI(); if (game) renderMoves(); }));

  $('navStart').addEventListener('click', () => gotoPly(0));
  $('navPrev').addEventListener('click', () => gotoPly(curPly - 1));
  $('navNext').addEventListener('click', () => gotoPly(curPly + 1));
  $('navEnd').addEventListener('click', () => gotoPly(game ? game.fens.length - 1 : 0));
  $('navFlip').addEventListener('click', () => { flipped = !flipped; renderBoard(); renderEvalBar(); });

  document.addEventListener('keydown', (e) => {
    if (!$('boardPage').classList.contains('show')) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft') gotoPly(curPly - 1);
    else if (e.key === 'ArrowRight') gotoPly(curPly + 1);
    else if (e.key === 'ArrowUp') gotoPly(0);
    else if (e.key === 'ArrowDown') gotoPly(game ? game.fens.length - 1 : 0);
    else if (e.key.toLowerCase() === 'f') { flipped = !flipped; renderBoard(); renderEvalBar(); }
  });
}

function populateLangSel() {
  const sel = $('langSel'); if (!sel) return;
  sel.innerHTML = '';
  for (const l of LANGS) { const o = document.createElement('option'); o.value = l.code; o.textContent = l.label; sel.appendChild(o); }
  sel.value = getLang();
}

initLang();
wire();
setMode('user');
populateLangSel();
applyI18n();
$('depthNote').textContent = t(DEPTH_NOTE_KEY[depthLevel]);

// PWA: register the service worker (offline + installable). Relative path so it
// works whether the app is served from the domain root or a subfolder.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
