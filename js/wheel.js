/* Ruleta tipo mesa de casino, dibujada en canvas de alta resolución y animada con requestAnimationFrame.
   - Los segmentos vienen del estado (state.wheel): uno por pregunta que queda + los BONUS. Cada segmento
     usado desaparece, así la ruleta mantiene su tamaño pero tiene cada vez menos opciones.
   - El progreso del giro se calcula con la HORA DEL ANFITRIÓN/SERVIDOR (spin.id = inicio del giro):
     todos los dispositivos ven la ruleta en la misma posición en el mismo instante.
   Convención: el puntero está arriba; el segmento 0 empieza en el puntero y avanza en sentido horario. */
(function (R) {
  'use strict';

  const TAU = Math.PI * 2;
  const SETTLE_MS = 520;   // rebote final: la aguja "engancha" el último perno

  /* Curva cúbica de Bézier (como en CSS): arranque suave y frenado largo, como una ruleta real. */
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = function (t) { return ((ax * t + bx) * t + cx) * t; };
    const sy = function (t) { return ((ay * t + by) * t + cy) * t; };
    const dx = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };
    return function (x) {
      let t = x;
      for (let i = 0; i < 8; i++) {
        const err = sx(t) - x, d = dx(t);
        if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      return sy(Math.max(0, Math.min(1, t)));
    };
  }
  const ease = bezier(0.16, 0.22, 0.06, 1);

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = function (c) { return Math.max(0, Math.min(255, Math.round(c + amt * 255))); };
    return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  function segInfo(seg) {
    if (seg.c === 'BONUS') return R.BONUS;
    return R.CATEGORIES.find(function (c) { return c.id === seg.c; }) || { id: seg.c, name: seg.c, color: '#2fd4c0' };
  }

  function Wheel(opts) {
    this.canvas = opts.canvas;
    this.rotor = opts.rotor;
    this.pointer = opts.pointer;
    this.wrap = opts.wrap;
    this.highlight = opts.highlight;
    this.segments = [];
    this.signature = null;
    this.angle = 0;
    this.anim = null;
    this.appliedSpinId = null;
    this.lastKick = 0;
    this.onLand = function () {};
    const self = this;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self.draw(); });
    if (window.ResizeObserver) {
      let w = 0;
      new ResizeObserver(function () {
        const nw = self.rotor.clientWidth;
        if (nw && Math.abs(nw - w) > 4) { w = nw; self.draw(); }
      }).observe(this.rotor);
    }
  }

  Wheel.prototype.setSegments = function (segments) {
    const sig = segments.map(function (s) { return s.c; }).join(',');
    if (sig === this.signature) return;
    const first = this.signature === null;
    this.signature = sig;
    this.segments = segments.slice();
    this.draw();
    if (!first) {   // un segmento usado desaparece: transición suave
      this.rotor.classList.remove('refresh'); void this.rotor.offsetWidth; this.rotor.classList.add('refresh');
    }
  };

  Wheel.prototype.updateHighlight = function () {
    if (!this.highlight || !this.segments.length) return;
    const half = Math.PI / this.segments.length, rr = 43.6;
    const x1 = 50 + rr * Math.cos(-Math.PI / 2 - half), y1 = 50 + rr * Math.sin(-Math.PI / 2 - half);
    const x2 = 50 + rr * Math.cos(-Math.PI / 2 + half), y2 = 50 + rr * Math.sin(-Math.PI / 2 + half);
    this.highlight.setAttribute('d', 'M50 50 L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z');
  };

  Wheel.prototype.draw = function () {
    const segs = this.segments;
    const css = this.rotor.clientWidth || 520;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const S = Math.max(420, Math.min(1600, Math.round(css * dpr)));
    const c = this.canvas;
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const r = S / 2, cx = r, cy = r;
    const Rb = r * 0.995;      // borde exterior
    const Rt = r * 0.905;      // inicio de la pista metálica
    const Rs = r * 0.872;      // radio de los segmentos
    const Rp = r * 0.80;       // banda interior de los segmentos (detalle tipo casino)
    const Ri = r * 0.235;      // anillo central
    ctx.clearRect(0, 0, S, S);
    this.updateHighlight();

    // Aro exterior: metal oscuro con biseles
    let g = ctx.createRadialGradient(cx, cy, Rt, cx, cy, Rb);
    g.addColorStop(0, '#061615'); g.addColorStop(0.18, '#1c4a44'); g.addColorStop(0.45, '#0e2f2c');
    g.addColorStop(0.72, '#2a6a61'); g.addColorStop(0.9, '#0d2826'); g.addColorStop(1, '#030b0b');
    ctx.beginPath(); ctx.arc(cx, cy, Rb, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = r * 0.005; ctx.strokeStyle = 'rgba(190,255,235,.35)'; ctx.stroke();
    // Marcas finas del dial
    ctx.save(); ctx.translate(cx, cy);
    for (let i = 0; i < 120; i++) {
      ctx.rotate(TAU / 120);
      ctx.beginPath(); ctx.moveTo(0, -Rb * 0.985); ctx.lineTo(0, -Rb * (i % 5 === 0 ? 0.962 : 0.972));
      ctx.strokeStyle = 'rgba(190,255,235,' + (i % 5 === 0 ? .32 : .14) + ')'; ctx.lineWidth = r * 0.0035; ctx.stroke();
    }
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, Rt, 0, TAU); ctx.lineWidth = r * 0.006; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();

    if (!segs.length) return;
    const n = segs.length;
    const seg = TAU / n;
    const start = -Math.PI / 2;

    // Segmentos
    segs.forEach(function (sg, i) {
      const info = segInfo(sg);
      const bonus = sg.c === 'BONUS';
      const a0 = start + i * seg, a1 = a0 + seg;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Rs, a0, a1); ctx.closePath();
      const lg = ctx.createRadialGradient(cx, cy, Ri, cx, cy, Rs);
      if (bonus) {
        lg.addColorStop(0, '#8a5a06'); lg.addColorStop(0.5, '#d9a21b'); lg.addColorStop(0.85, '#f6d36b'); lg.addColorStop(1, '#ffe7a3');
      } else {
        lg.addColorStop(0, shade(info.color, -0.2)); lg.addColorStop(0.6, info.color); lg.addColorStop(1, shade(info.color, 0.1));
      }
      ctx.fillStyle = lg; ctx.fill();
      // Banda exterior (bolsillo) ligeramente más clara
      ctx.beginPath(); ctx.arc(cx, cy, Rs, a0, a1); ctx.arc(cx, cy, Rp, a1, a0, true); ctx.closePath();
      ctx.fillStyle = bonus ? 'rgba(255,245,210,.22)' : 'rgba(255,255,255,.09)'; ctx.fill();
    });
    // Línea que separa la banda exterior
    ctx.beginPath(); ctx.arc(cx, cy, Rp, 0, TAU); ctx.lineWidth = r * 0.004; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke();

    // Profundidad: sombra hacia el borde y hacia el centro
    g = ctx.createRadialGradient(cx, cy, Rs * 0.82, cx, cy, Rs);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fillStyle = g; ctx.fill();
    g = ctx.createRadialGradient(cx, cy, Ri, cx, cy, Ri * 2.4);
    g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fillStyle = g; ctx.fill();

    // Separadores metálicos (dos tonos: luz y sombra)
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = start + i * seg;
      const x0 = cx + Math.cos(a) * Ri, y0 = cy + Math.sin(a) * Ri, x1 = cx + Math.cos(a) * Rs, y1 = cy + Math.sin(a) * Rs;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = r * 0.011; ctx.stroke();
      const sg = ctx.createLinearGradient(x0, y0, x1, y1);
      sg.addColorStop(0, 'rgba(220,255,245,.35)'); sg.addColorStop(1, 'rgba(255,255,255,.85)');
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = sg; ctx.lineWidth = r * 0.0045; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = r * 0.006; ctx.stroke();

    // Pernos plateados en el aro (contra ellos golpea la aguja)
    for (let i = 0; i < n; i++) {
      const a = start + i * seg;
      const pr = (Rs + Rt) / 2;
      const px = cx + Math.cos(a) * pr, py = cy + Math.sin(a) * pr;
      const rad = r * 0.017;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = r * 0.012; ctx.shadowOffsetY = r * 0.004;
      const pg = ctx.createRadialGradient(px - rad * 0.35, py - rad * 0.45, rad * 0.1, px, py, rad);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.45, '#d6e6e2'); pg.addColorStop(0.85, '#7f9893'); pg.addColorStop(1, '#3d524e');
      ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fillStyle = pg; ctx.fill();
      ctx.restore();
    }

    // Anillo central metálico con muescas
    g = ctx.createRadialGradient(cx, cy, Ri * 0.9, cx, cy, Ri * 1.22);
    g.addColorStop(0, '#0a2220'); g.addColorStop(0.5, '#2b6b62'); g.addColorStop(1, '#071817');
    ctx.beginPath(); ctx.arc(cx, cy, Ri * 1.22, 0, TAU); ctx.fillStyle = g; ctx.fill();
    for (let i = 0; i < n; i++) {
      const a = start + (i + 0.5) * seg;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * Ri * 1.1, cy + Math.sin(a) * Ri * 1.1, r * 0.006, 0, TAU);
      ctx.fillStyle = 'rgba(190,255,235,.45)'; ctx.fill();
    }

    // Etiquetas radiales, ajustadas al ancho y al alto disponibles
    const xEnd = Rs - r * 0.05;
    segs.forEach(function (sg, i) {
      const info = segInfo(sg);
      const bonus = sg.c === 'BONUS';
      const label = bonus ? '★ BONUS' : info.name;
      const mid = start + i * seg + seg / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let size = r * 0.058;
      const font = function (sz) { ctx.font = '800 ' + sz + 'px Montserrat, system-ui, sans-serif'; if ('letterSpacing' in ctx) ctx.letterSpacing = (sz * 0.06) + 'px'; };
      font(size);
      for (let k = 0; k < 60; k++) {
        const w = ctx.measureText(label).width;
        const innerX = xEnd - w;
        const fitsLen = innerX > Ri * 1.3;
        const fitsHeight = size < innerX * seg * 0.62;
        if (fitsLen && fitsHeight) break;
        size *= 0.95; font(size);
      }
      ctx.shadowColor = bonus ? 'rgba(255,240,200,.5)' : 'rgba(0,0,0,.5)';
      ctx.shadowBlur = r * 0.01; ctx.shadowOffsetY = r * 0.003;
      ctx.fillStyle = bonus ? '#3b2400' : '#ffffff';
      if (bonus) {
        ctx.fillText(label, xEnd, -size * 0.32);
        const s2 = size * 0.62;
        ctx.font = '800 ' + s2 + 'px Montserrat, system-ui, sans-serif';
        ctx.fillText('+' + R.CONFIG.BONUS_POINTS + ' PTS', xEnd, size * 0.62);
      } else {
        ctx.fillText(label, xEnd, 0);
      }
      ctx.restore();
    });
  };

  Wheel.prototype.setAngle = function (a) {
    this.angle = a;
    this.rotor.style.transform = 'rotate(' + a + 'deg)';
  };

  /* Golpe del perno contra la aguja: sonido + aleteo. speed 0..1 */
  Wheel.prototype.kick = function (speed) {
    const now = performance.now();
    if (now - this.lastKick < 40) return;
    this.lastKick = now;
    if (R.Sound) R.Sound.tick(speed);
    if (!this.pointer.animate) return;
    const amp = 7 + 17 * Math.min(1, 0.3 + (1 - speed) * 0.7);   // al frenar, cada perno empuja más la aguja
    this.pointer.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + (-amp) + 'deg)', offset: 0.28 }, { transform: 'rotate(' + (amp * 0.18) + 'deg)', offset: 0.7 }, { transform: 'rotate(0deg)' }],
      { duration: 230, easing: 'cubic-bezier(.25,.7,.35,1)' }
    );
  };

  /* Aplica el estado público. Anima solo cuando llega un giro nuevo. */
  Wheel.prototype.sync = function (state, nowFn) {
    const spin = state.spin;
    if (!this.anim && state.wheel) this.setSegments(state.wheel);
    this.wrap.classList.toggle('landed', state.phase === 'CATEGORY_SELECTED' && !this.anim);
    this.wrap.classList.toggle('spinning', !!this.anim);
    this.wrap.classList.toggle('is-bonus', state.phase === 'CATEGORY_SELECTED' && state.currentCategory === 'BONUS');
    if (state.phase === 'SPINNING' && spin && spin.id !== this.appliedSpinId) {
      this.appliedSpinId = spin.id;
      this.startSpin(spin, nowFn);
    } else if (state.phase !== 'SPINNING' && !this.anim) {
      if (spin) this.appliedSpinId = spin.id;
      this.setAngle(state.wheelRotation);
    }
  };

  Wheel.prototype.startSpin = function (spin, nowFn) {
    const self = this;
    const from = this.angle;
    const to = spin.rotation;
    const n = Math.max(1, this.segments.length);
    const segDeg = 360 / n;
    let lastIdx = Math.floor(from / segDeg);
    if (nowFn() - spin.id >= spin.durationMs + SETTLE_MS) { this.setAngle(to); return; }   // se unió tarde

    this.wrap.classList.add('spinning');
    this.wrap.classList.remove('landed');
    let prevA = from, prevT = performance.now();
    const step = function () {
      const el = nowFn() - spin.id;
      const p = Math.min(1, Math.max(0, el / spin.durationMs));
      let a = from + (to - from) * ease(p);
      if (p >= 1) {   // rebote amortiguado: la aguja retiene la ruleta un instante
        const q = Math.min(1, (el - spin.durationMs) / SETTLE_MS);
        a = to - Math.min(segDeg * 0.08, 1.1) * Math.sin(Math.PI * q) * (1 - q);
      }
      self.setAngle(a);
      const t = performance.now();
      const speed = Math.min(1, Math.abs(a - prevA) / Math.max(1, t - prevT) / 1.2);   // grados/ms normalizados
      prevA = a; prevT = t;
      const idx = Math.floor(a / segDeg);
      if (idx !== lastIdx && p < 1) {
        lastIdx = idx;
        self.kick(speed);
      }
      if (el < spin.durationMs + SETTLE_MS) {
        self.anim = requestAnimationFrame(step);
      } else {
        self.anim = null;
        self.setAngle(to);
        self.wrap.classList.remove('spinning');
        self.wrap.classList.add('landed');
        if (R.Sound) R.Sound.select();
        if (navigator.vibrate) { try { navigator.vibrate(25); } catch (e) { /* noop */ } }
        self.onLand();
      }
    };
    this.anim = requestAnimationFrame(step);
  };

  R.Wheel = Wheel;
})(window.Ruleta = window.Ruleta || {});
