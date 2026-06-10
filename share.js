// share.js — build a shareable result card (canvas) for Twitter/Instagram.
import { t } from './i18n.js';

const COL = {
  bg1: '#2b2926', bg2: '#1d1b19', panel: '#35322e', line: '#46423d',
  text: '#efece8', dim: '#a8a39d', green: '#81b64c', greenHi: '#9bd45f',
};
const CLS_COL = {
  brilliant: '#1bbfa6', great: '#5b9bd1', best: '#8bc34a', excellent: '#9fc15f',
  good: '#a7b59b', book: '#b08a5a', forced: '#6f8088', inaccuracy: '#f2c14e',
  mistake: '#e8923a', miss: '#e8693a', blunder: '#d34b46',
};
const CLS_SYM = {
  brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '◆',
  forced: '⊡', inaccuracy: '?!', mistake: '?', miss: '✗', blunder: '??',
};
const ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

export async function openShareCard(data) {
  try { await document.fonts.ready; } catch (e) {}
  const canvas = drawCard(data);
  showModal(canvas);
}

function roundRect(x, c, X, y, w, h, r) {
  c.beginPath();
  c.moveTo(X + r, y); c.arcTo(X + w, y, X + w, y + h, r); c.arcTo(X + w, y + h, X, y + h, r);
  c.arcTo(X, y + h, X, y, r); c.arcTo(X, y, X + w, y, r); c.closePath();
}

function drawCard(d) {
  const W = 1080, P = 72;
  const suffix = t('brandSuffix');
  const colW = (W - 2 * P) / 2;
  const rows = ORDER.filter((k) => (d.counts.white[k] || 0) + (d.counts.black[k] || 0) > 0);
  const lineH = 54;
  const pill = d.openingName ? 84 : 18;
  const H = 228 + pill + 300 + 40 + 156 + 40 + rows.length * lineH + 104;

  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');

  // background + soft green glow
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, COL.bg1); g.addColorStop(1, COL.bg2);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(170, 110, 30, 170, 110, 780);
  rg.addColorStop(0, 'rgba(129,182,76,0.15)'); rg.addColorStop(1, 'rgba(129,182,76,0)');
  c.fillStyle = rg; c.fillRect(0, 0, W, H);

  // header: logo + wordmark + subtitle
  c.fillStyle = COL.green; roundRect(0, c, P, 72, 92, 92, 22); c.fill();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#1c2a12'; c.font = '700 58px "Noto Sans Symbols 2", sans-serif';
  c.fillText('\u265E', P + 46, 121);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.font = '800 58px Sora, sans-serif';
  c.fillStyle = COL.text; c.fillText('\u015Eah', P + 118, 130);
  const wW = c.measureText('\u015Eah').width;
  c.fillStyle = COL.greenHi; c.fillText(suffix, P + 118 + wW, 130);
  c.fillStyle = COL.dim; c.font = '500 25px Outfit, sans-serif';
  c.fillText(t('reviewTitle'), P + 120, 168);

  // accent rule
  const ar = c.createLinearGradient(P, 0, W - P, 0);
  ar.addColorStop(0, 'rgba(129,182,76,0.6)'); ar.addColorStop(1, 'rgba(129,182,76,0)');
  c.fillStyle = ar; c.fillRect(P, 196, W - 2 * P, 3);

  // opening pill
  let y = 228;
  if (d.openingName) {
    const label = (d.eco ? d.eco + ' \u00B7 ' : '') + d.openingName;
    c.font = '600 27px Outfit, sans-serif';
    const tw = Math.min(W - 2 * P, c.measureText(label).width + 40);
    c.fillStyle = 'rgba(176,138,90,.16)'; roundRect(0, c, P, y, tw, 50, 12); c.fill();
    c.fillStyle = '#d8b487'; c.textBaseline = 'middle';
    c.fillText(clip(c, label, W - 2 * P - 40), P + 20, y + 26);
    c.textBaseline = 'alphabetic';
    y += 84;
  } else { y += 18; }

  // accuracy panel
  const panY = y, panH = 300;
  c.fillStyle = COL.panel; roundRect(0, c, P, panY, W - 2 * P, panH, 24); c.fill();
  const whiteWon = d.result === '1-0', blackWon = d.result === '0-1';
  if (whiteWon || blackWon) {
    c.save();
    roundRect(0, c, P, panY, W - 2 * P, panH, 24); c.clip();
    const gx = whiteWon ? P + colW / 2 : P + colW + colW / 2;
    const wg = c.createRadialGradient(gx, panY + panH / 2, 20, gx, panY + panH / 2, colW * 0.85);
    wg.addColorStop(0, 'rgba(129,182,76,0.18)'); wg.addColorStop(1, 'rgba(129,182,76,0)');
    c.fillStyle = wg; c.fillRect(P, panY, W - 2 * P, panH);
    c.restore();
  }
  drawAccCol(c, P, panY, colW, panH, d.white, d.whiteAcc, whiteWon, d.whiteIsUser);
  drawAccCol(c, P + colW, panY, colW, panH, d.black, d.blackAcc, blackWon, d.blackIsUser);
  c.strokeStyle = COL.line; c.lineWidth = 2;
  c.beginPath(); c.moveTo(P + colW, panY + 48); c.lineTo(P + colW, panY + panH - 48); c.stroke();
  c.fillStyle = COL.green; roundRect(0, c, P + colW - 50, panY + panH / 2 - 30, 100, 60, 15); c.fill();
  c.fillStyle = '#fff'; c.font = '800 30px Sora, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(d.result && d.result !== '*' ? d.result : 'vs', P + colW, panY + panH / 2 + 1);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  y = panY + panH + 40;

  // comparison bars
  drawBar(c, P, y, W - 2 * P, d.white, d.whiteAcc, whiteWon); y += 70;
  drawBar(c, P, y, W - 2 * P, d.black, d.blackAcc, blackWon); y += 86;

  // classification header
  c.font = '700 24px Sora, sans-serif'; c.fillStyle = COL.dim; c.textBaseline = 'alphabetic';
  c.textAlign = 'left'; c.fillText(clip(c, d.white, colW - 70), P + 4, y);
  c.textAlign = 'right'; c.fillText(clip(c, d.black, colW - 70), W - P - 4, y);
  c.textAlign = 'left';
  y += 14;
  c.strokeStyle = COL.line; c.lineWidth = 1; c.beginPath(); c.moveTo(P, y); c.lineTo(W - P, y); c.stroke();
  y += 26;

  for (let i = 0; i < rows.length; i++) {
    const k = rows[i]; const ry = y + i * lineH;
    if (i % 2 === 0) { c.fillStyle = 'rgba(255,255,255,0.025)'; roundRect(0, c, P - 8, ry - 18, W - 2 * P + 16, lineH - 6, 10); c.fill(); }
    c.fillStyle = CLS_COL[k]; c.beginPath(); c.arc(P + 22, ry + 9, 21, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = '800 22px "Noto Sans Symbols 2", Sora, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(CLS_SYM[k], P + 22, ry + 10);
    c.textAlign = 'left'; c.fillStyle = COL.text; c.font = '600 30px Outfit, sans-serif';
    c.fillText(t('cls' + cap(k)), P + 58, ry + 10);
    c.font = '700 32px Sora, sans-serif'; c.textAlign = 'center';
    c.fillStyle = (d.counts.white[k] || 0) ? COL.text : COL.dim;
    c.fillText(String(d.counts.white[k] || 0), P + colW - 30, ry + 10);
    c.fillStyle = (d.counts.black[k] || 0) ? COL.text : COL.dim;
    c.fillText(String(d.counts.black[k] || 0), P + 2 * colW - 30, ry + 10);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  }

  // footer: localized brand + url, centered
  const brand = '\u015Eah' + suffix;
  const url = ' \u00B7 tumyla.github.io/sahanaliz';
  const fy = H - 50;
  c.font = '600 25px Outfit, sans-serif'; const urlW = c.measureText(url).width;
  c.font = '800 26px Sora, sans-serif'; const brandW = c.measureText(brand).width;
  const sx = (W - (brandW + urlW)) / 2;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.fillStyle = COL.greenHi; c.font = '800 26px Sora, sans-serif'; c.fillText(brand, sx, fy);
  c.fillStyle = COL.dim; c.font = '600 25px Outfit, sans-serif'; c.fillText(url, sx + brandW, fy);
  return cv;
}

function drawAccCol(c, x, y, w, h, name, acc, won, isUser) {
  const cx = x + w / 2;
  c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.fillStyle = won ? COL.greenHi : COL.dim;
  c.font = '600 30px Outfit, "Noto Sans Symbols 2", sans-serif';
  const star = won ? '\u265B ' : (isUser ? '\u2605 ' : '');
  c.fillText(clip(c, star + (name || ''), w - 36), cx, y + 64);
  c.fillStyle = won ? COL.greenHi : COL.text;
  c.font = '800 104px Sora, sans-serif';
  c.fillText(acc != null ? String(acc) : '\u2014', cx, y + 186);
  c.fillStyle = COL.dim; c.font = '700 24px Outfit, sans-serif';
  c.fillText(t('shareAccuracy').toUpperCase(), cx, y + 226);
  c.textAlign = 'left';
}

function drawBar(c, x, y, maxW, name, acc, won) {
  const a = Math.max(0, Math.min(100, acc || 0));
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillStyle = won ? COL.greenHi : COL.text; c.font = '600 27px Outfit, sans-serif';
  c.fillText(clip(c, name || '', maxW - 120), x, y);
  c.textAlign = 'right'; c.fillStyle = won ? COL.greenHi : COL.dim; c.font = '700 27px Sora, sans-serif';
  c.fillText(acc != null ? acc + '%' : '\u2014', x + maxW, y);
  const by = y + 24, bh = 16;
  c.fillStyle = 'rgba(255,255,255,0.07)'; roundRect(0, c, x, by, maxW, bh, 8); c.fill();
  const fw = Math.max(bh, maxW * a / 100);
  c.fillStyle = won ? COL.greenHi : COL.green; roundRect(0, c, x, by, fw, bh, 8); c.fill();
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}

function clip(c, s, maxW) {
  s = String(s == null ? '' : s);
  if (c.measureText(s).width <= maxW) return s;
  while (s.length > 1 && c.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function showModal(canvas) {
  const old = document.getElementById('shareModal'); if (old) old.remove();
  const overlay = document.createElement('div'); overlay.id = 'shareModal'; overlay.className = 'share-modal';
  const box = document.createElement('div'); box.className = 'share-box';
  const img = document.createElement('img'); img.className = 'share-img'; img.alt = t('shareTitle');
  img.src = canvas.toDataURL('image/png');
  const row = document.createElement('div'); row.className = 'share-actions';

  const saveBtn = document.createElement('button'); saveBtn.className = 'go'; saveBtn.innerHTML = '<span>' + t('shareBtnSave') + '</span>';
  saveBtn.onclick = () => canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sahanaliz.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');

  const shareBtn = document.createElement('button'); shareBtn.className = 'ghost-btn'; shareBtn.textContent = t('shareBtnShare');
  shareBtn.onclick = () => canvas.toBlob(async (blob) => {
    const file = new File([blob], 'sahanaliz.png', { type: 'image/png' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'ŞahAnaliz', text: t('shareFooter') });
      } else { saveBtn.click(); }
    } catch (e) { /* user cancelled */ }
  }, 'image/png');

  const closeBtn = document.createElement('button'); closeBtn.className = 'ghost-btn'; closeBtn.textContent = t('shareBtnClose');
  closeBtn.onclick = () => overlay.remove();

  row.appendChild(saveBtn); row.appendChild(shareBtn); row.appendChild(closeBtn);
  box.appendChild(img); box.appendChild(row); overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}
