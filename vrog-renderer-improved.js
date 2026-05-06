/**
 * VROGRenderer — Virtual ROG canvas rendering library (Enhanced v2)
 *
 * Key improvements:
 *   - Row-aware layout using rogShelfInfo outer index (physical shelf tiers)
 *   - Shelf rail bars between rows for realistic shelf look
 *   - Light/dark adaptive backgrounds with subtle gradients
 *   - Rounded cluster crops with drop shadows
 *   - Bottom gradient label overlays
 *   - Blue-glow highlight with rounded punch-out
 *   - HiDPI-aware overlay
 *
 * API (fully backward-compatible):
 *   const vrog = new VROGRenderer(container, imgSrc, shelfInfo, bgColor);
 *   await vrog.render();
 *   vrog.highlightByKey('LABEL_CODE');
 *   vrog.clearHighlight();
 *   vrog.destroy();
 */
class VROGRenderer {
  constructor(container, imgSrc, shelfInfo, backgroundColor = '#eaecf1') {
    this._container = container;
    this._imgSrc    = imgSrc;
    this._shelfInfo = shelfInfo;
    this._bgColor   = backgroundColor;
    this._cPos      = [];
    this._overlay   = null;
    this._cW        = 0;
    this._cH        = 0;
    this._dpr       = 1;
  }

  /* ═══════ render ═══════ */
  async render() {
    const container = this._container;
    if (!container) throw new Error('container is required');
    container.innerHTML =
      '<div style="padding:18px;text-align:center;color:#6b7280;font-size:11px;">Loading image\u2026</div>';

    const rowGroups = this._groupByRow(this._shelfInfo);
    const clusters  = rowGroups.flat();
    if (!clusters.length) {
      container.innerHTML = '<div style="padding:16px;color:#6b7280;font-size:11px;">No data</div>';
      return;
    }

    let img;
    try { img = await this._loadImage(this._imgSrc); }
    catch {
      container.innerHTML =
        '<div style="padding:16px;color:#f87171;font-size:11px;">Failed to load image</div>';
      return;
    }
    container.innerHTML = '';

    // Global bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of clusters) {
      const [x1, y1, x2, y2] = c.cluster_bbox;
      if (x1 < minX) minX = x1; if (x2 > maxX) maxX = x2;
      if (y1 < minY) minY = y1; if (y2 > maxY) maxY = y2;
    }

    const PAD     = 16;
    const RAIL_H  = 5;
    const ROW_GAP = 4;
    const tW = maxX - minX, tH = maxY - minY;
    if (tW <= 0 || tH <= 0) return;

    const numRails = Math.max(0, rowGroups.length - 1);
    const extraH   = numRails * (RAIL_H + ROW_GAP * 2);

    const FIXED_H = 500;
    const sc  = (FIXED_H - PAD * 2 - extraH) / tH;
    const cW  = Math.round(tW * sc) + PAD * 2;
    const cH  = FIXED_H;
    const dpr = window.devicePixelRatio || 1;
    this._cW = cW; this._cH = cH; this._dpr = dpr;

    const canvas  = document.createElement('canvas');
    canvas.width  = Math.round(cW * dpr);
    canvas.height = Math.round(cH * dpr);
    canvas.style.cssText = `width:${cW}px;height:${cH}px;border-radius:8px;display:block;`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const isDark = this._isDark();

    // ── Background ──
    if (isDark) {
      const g = ctx.createLinearGradient(0, 0, 0, cH);
      g.addColorStop(0, '#1f2128'); g.addColorStop(0.5, '#181a20'); g.addColorStop(1, '#111318');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, cH);
      g.addColorStop(0, this._lighten(this._bgColor, 4));
      g.addColorStop(1, this._darken(this._bgColor, 3));
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, cW, cH);

    // ── Per-row metadata ──
    const rowMeta = rowGroups.map(group => {
      let rMinY = Infinity, rMaxY = -Infinity;
      for (const c of group) {
        const [, y1, , y2] = c.cluster_bbox;
        if (y1 < rMinY) rMinY = y1;
        if (y2 > rMaxY) rMaxY = y2;
      }
      return { minY: rMinY, maxY: rMaxY, cells: group };
    });

    // ── Draw rows ──
    this._cPos = [];
    let curY = PAD;

    for (let ri = 0; ri < rowMeta.length; ri++) {
      const rm   = rowMeta[ri];
      const rowH = Math.round((rm.maxY - rm.minY) * sc);

      // Alternating row strip
      if (ri % 2 === 0) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.024)';
        this._fillRoundRect(ctx, PAD - 6, curY - 3, cW - PAD * 2 + 12, rowH + 6, 6);
      }

      // Clusters
      for (const cluster of rm.cells) {
        const [x1, y1, x2, y2] = cluster.cluster_bbox;
        const bW = x2 - x1, bH = y2 - y1;
        if (bW <= 0 || bH <= 0) continue;

        const dX = PAD + Math.round((x1 - minX) * sc);
        const dY = curY + Math.round((y1 - rm.minY) * sc);
        const dW = Math.max(1, Math.round(bW * sc));
        const dH = Math.max(1, Math.round(bH * sc));
        const key = cluster.esl_info?.[0]?.label_code || '';
        this._cPos.push({ key, dispX: dX, dispY: dY, dispW: dW, dispH: dH });

        const R = Math.min(4, Math.min(dW, dH) / 6);

        // Shadow
        ctx.save();
        ctx.shadowColor   = isDark ? 'rgba(0,0,0,0.50)' : 'rgba(0,0,0,0.18)';
        ctx.shadowBlur    = isDark ? 10 : 8;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = isDark ? 3 : 2;
        ctx.fillStyle     = isDark ? 'rgba(0,0,0,0.01)' : 'rgba(255,255,255,0.01)';
        ctx.beginPath(); this._roundRect(ctx, dX, dY, dW, dH, R); ctx.fill();
        ctx.restore();

        // Clip → image → label
        ctx.save();
        ctx.beginPath(); this._roundRect(ctx, dX, dY, dW, dH, R); ctx.clip();
        try { ctx.drawImage(img, x1, y1, bW, bH, dX, dY, dW, dH); }
        catch { ctx.fillStyle = isDark ? '#2a2d35' : '#d8dae0'; ctx.fillRect(dX, dY, dW, dH); }
        const articleName = cluster.prd_info?.[0]?.article_name || '';
        if (articleName && dW >= 22 && dH >= 18) {
          this._drawLabelInClip(ctx, articleName, dX, dY, dW, dH);
        }
        ctx.restore();

        // Border
        ctx.save();
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)';
        ctx.lineWidth = 1;
        ctx.beginPath(); this._roundRect(ctx, dX + 0.5, dY + 0.5, dW - 1, dH - 1, R); ctx.stroke();
        ctx.restore();
      }

      curY += rowH;

      // ── Shelf rail ──
      if (ri < rowMeta.length - 1) {
        curY += ROW_GAP;
        this._drawShelfRail(ctx, PAD, curY, cW - PAD * 2, RAIL_H, isDark);
        curY += RAIL_H + ROW_GAP;
      }
    }

    // ── Overlay (HiDPI) ──
    const overlay  = document.createElement('canvas');
    overlay.width  = Math.round(cW * dpr);
    overlay.height = Math.round(cH * dpr);
    overlay.style.cssText =
      `position:absolute;inset:0;width:${cW}px;height:${cH}px;pointer-events:none;border-radius:8px;`;
    this._overlay = overlay;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;line-height:0;';
    wrapper.appendChild(canvas);
    wrapper.appendChild(overlay);
    container.appendChild(wrapper);
  }

  /* ═══════ highlight ═══════ */
  highlightByKey(key) {
    if (!this._overlay) return;
    const dpr = this._dpr;
    const octx = this._overlay.getContext('2d');
    const { _cW: cW, _cH: cH } = this;
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, cW, cH);
    if (!key) return;

    const target = this._cPos.find(p => p.key === key);
    if (!target) return;
    const R = Math.min(4, Math.min(target.dispW, target.dispH) / 6);

    // Dim
    octx.fillStyle = this._isDark() ? 'rgba(0,0,0,0.55)' : 'rgba(240,240,245,0.72)';
    octx.fillRect(0, 0, cW, cH);

    // Punch-out
    octx.save();
    octx.globalCompositeOperation = 'destination-out';
    octx.fillStyle = '#fff';
    octx.beginPath();
    this._roundRect(octx,
      target.dispX - 3, target.dispY - 3,
      target.dispW + 6, target.dispH + 6, R + 2);
    octx.fill();
    octx.restore();

    // Blue glow
    octx.save();
    octx.strokeStyle = 'rgba(59,130,246,0.85)';
    octx.lineWidth   = 2;
    octx.shadowColor = 'rgba(59,130,246,0.50)';
    octx.shadowBlur  = 14;
    octx.beginPath();
    this._roundRect(octx,
      target.dispX - 3, target.dispY - 3,
      target.dispW + 6, target.dispH + 6, R + 2);
    octx.stroke();
    octx.restore();
  }

  clearHighlight() {
    if (!this._overlay) return;
    const octx = this._overlay.getContext('2d');
    octx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    octx.clearRect(0, 0, this._cW, this._cH);
  }

  async setBackgroundColor(color) { this._bgColor = color; await this.render(); }

  destroy() {
    if (this._container) this._container.innerHTML = '';
    this._overlay = null;
    this._cPos    = [];
  }

  /* ═══════ private helpers ═══════ */

  _isDark() {
    const c = this._bgColor.toLowerCase().replace(/\s/g, '');
    if (c === 'black' || c === '#000' || c === '#000000' ||
        c === '#111'  || c === '#111111') return true;
    const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (m) {
      const lum = (parseInt(m[1],16)*299 + parseInt(m[2],16)*587 + parseInt(m[3],16)*114) / 1000;
      return lum < 100;
    }
    return false;
  }

  _lighten(hex, pct) {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    const f = 1 + pct / 100;
    const cl = v => Math.min(255, Math.round(parseInt(v, 16) * f));
    return '#' + [m[1], m[2], m[3]].map(v => cl(v).toString(16).padStart(2, '0')).join('');
  }

  _darken(hex, pct) {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return hex;
    const f = 1 - pct / 100;
    const cl = v => Math.max(0, Math.round(parseInt(v, 16) * f));
    return '#' + [m[1], m[2], m[3]].map(v => cl(v).toString(16).padStart(2, '0')).join('');
  }

  /** Preserves rogShelfInfo outer index as _shelfRow */
  _groupByRow(shelfInfo) {
    const groups = [];
    for (let ri = 0; ri < (shelfInfo || []).length; ri++) {
      const row = shelfInfo[ri] || [];
      const cells = [];
      for (const cell of row) {
        if (cell) cells.push(Object.assign({}, cell, { _shelfRow: ri }));
      }
      if (cells.length) groups.push(cells);
    }
    return groups;
  }

  _drawShelfRail(ctx, x, y, w, h, isDark) {
    ctx.save();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (isDark) {
      g.addColorStop(0,   'rgba(255,255,255,0.05)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.10)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.08)');
      g.addColorStop(1,   'rgba(255,255,255,0.03)');
    } else {
      g.addColorStop(0,   '#c0c3ca');
      g.addColorStop(0.15,'#cfd2d8');
      g.addColorStop(0.5, '#dadce2');
      g.addColorStop(0.85,'#cdd0d6');
      g.addColorStop(1,   '#b4b7be');
    }
    ctx.fillStyle = g;
    ctx.beginPath(); this._roundRect(ctx, x, y, w, h, 2); ctx.fill();

    // Top highlight
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 0.5);
    ctx.lineTo(x + w - 2, y + 0.5);
    ctx.stroke();

    // Bottom shadow line
    ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + h - 0.5);
    ctx.lineTo(x + w - 2, y + h - 0.5);
    ctx.stroke();
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    if (w < 2*r) r = w/2; if (h < 2*r) r = h/2; if (r < 0) r = 0;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  _fillRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); this._roundRect(ctx, x, y, w, h, r); ctx.fill();
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload  = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = src;
    });
  }

  _drawLabelInClip(ctx, text, dX, dY, dW, dH) {
    const fs = Math.min(11, Math.max(7, Math.floor(dW / 10)));
    const lH = fs + 4;
    const mL = Math.min(2, Math.floor((dH - 6) / lH));
    if (mL < 1) return;

    ctx.save();
    ctx.font         = `600 ${fs}px 'Segoe UI', system-ui, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';

    const maxTW = dW - 8;
    const words = text.split(/\s+/);
    let lines = [], cur = '';
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxTW && cur) { lines.push(cur); cur = w; }
      else { cur = t; }
    }
    if (cur) lines.push(cur);
    if (lines.length > mL) lines = lines.slice(0, mL);
    lines = lines.map(line => {
      if (ctx.measureText(line).width <= maxTW) return line;
      let t = line;
      while (t.length > 0 && ctx.measureText(t + '\u2026').width > maxTW) t = t.slice(0, -1);
      return t + '\u2026';
    });

    const totalTextH = lines.length * lH + 6;
    const gradH = totalTextH + 16;
    const g = ctx.createLinearGradient(0, dY + dH - gradH, 0, dY + dH);
    g.addColorStop(0,   'rgba(0,0,0,0)');
    g.addColorStop(0.4, 'rgba(0,0,0,0.40)');
    g.addColorStop(1,   'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(dX, dY + dH - gradH, dW, gradH);

    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    let bY = dY + dH - 5;
    for (let i = lines.length - 1; i >= 0; i--) {
      ctx.fillText(lines[i], dX + dW / 2, bY);
      bY -= lH;
    }
    ctx.restore();
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = VROGRenderer;
