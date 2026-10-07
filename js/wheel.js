/* Ruleta: disco dibujado en canvas (alta resolución) que gira con requestAnimationFrame.
   El progreso del giro se calcula con la HORA DEL ANFITRIÓN/SERVIDOR (spin.id = inicio del giro),
   así todos los dispositivos ven la ruleta en la misma posición en el mismo instante.
   Convención: el puntero está arriba; el segmento 0 empieza en el puntero y avanza en sentido horario. */
(function (R) {
  'use strict';

  const TAU = Math.PI * 2;

  function ease(p) { return 1 - Math.pow(1 - p, 4); }            // arranque rápido, frenado largo
  function easeSpeed(p) { return 4 * Math.pow(1 - p, 3); }        // derivada (velocidad relativa)

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = function (c) { return Math.max(0, Math.min(255, Math.round(c + amt * 255))); };
    return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }

  function Wheel(opts) {
    this.canvas = opts.canvas;
    this.rotor = opts.rotor;
    this.pointer = opts.pointer;
    this.wrap = opts.wrap;
    this.angle = 0;
    this.anim = null;
    this.appliedSpinId = null;
    this.lastKick = 0;
    this.onLand = function () {};
    const self = this;
    if (opts.highlight) {   // cuña fija bajo el puntero que se ilumina al detenerse
      const half = Math.PI / R.CATEGORIES.length, rr = 44.25;
      const x1 = 50 + rr * Math.cos(-Math.PI / 2 - half), y1 = 50 + rr * Math.sin(-Math.PI / 2 - half);
      const x2 = 50 + rr * Math.cos(-Math.PI / 2 + half), y2 = 50 + rr * Math.sin(-Math.PI / 2 + half);
      opts.highlight.setAttribute('d', 'M50 50 L' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' A' + rr + ' ' + rr + ' 0 0 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z');
    }
    this.draw();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { self.draw(); });
    if (window.ResizeObserver) {
      let w = 0;
      new ResizeObserver(function () {
        const nw = self.rotor.clientWidth;
        if (nw && Math.abs(nw - w) > 4) { w = nw; self.draw(); }
      }).observe(this.rotor);
    }
  }

  Wheel.prototype.draw = function () {
    const cats = R.CATEGORIES;
    const css = this.rotor.clientWidth || 520;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const S = Math.max(360, Math.min(1400, Math.round(css * dpr)));
    const c = this.canvas;
    c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    const r = S / 2, cx = r, cy = r;
    const Rb = r * 0.995;          // borde exterior del bisel
    const Rs = r * 0.885;          // radio de los segmentos
    const Ri = r * 0.215;          // anillo interior (bajo el centro)
    const n = cats.length;
    const seg = TAU / n;
    const start = -Math.PI / 2;

    ctx.clearRect(0, 0, S, S);

    // Bisel exterior
    let g = ctx.createRadialGradient(cx, cy, Rs, cx, cy, Rb);
    g.addColorStop(0, '#0a1d1c'); g.addColorStop(0.35, '#1d4a45'); g.addColorStop(0.7, '#0f2d2b'); g.addColorStop(1, '#071514');
    ctx.beginPath(); ctx.arc(cx, cy, Rb, 0, TAU); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = r * 0.006; ctx.strokeStyle = 'rgba(160,255,225,.28)'; ctx.stroke();

    // Segmentos
    cats.forEach(function (cat, i) {
      const a0 = start + i * seg, a1 = a0 + seg;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, Rs, a0, a1); ctx.closePath();
      if (cat.enabled) {
        const lg = ctx.createRadialGradient(cx, cy, Ri, cx, cy, Rs);
        lg.addColorStop(0, shade(cat.color, -0.16)); lg.addColorStop(0.55, cat.color); lg.addColorStop(1, shade(cat.color, 0.08));
        ctx.fillStyle = lg;
      } else {
        ctx.fillStyle = '#1b2a2e';
      }
      ctx.fill();
      if (!cat.enabled) {   // trama diagonal discreta: categoría en preparación
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = r * 0.012;
        for (let k = -S; k < S; k += r * 0.05) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + S, S); ctx.stroke(); }
        ctx.restore();
      }
    });

    // Sombra interior (profundidad)
    g = ctx.createRadialGradient(cx, cy, Rs * 0.86, cx, cy, Rs);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fillStyle = g; ctx.fill();
    g = ctx.createRadialGradient(cx, cy, Ri, cx, cy, Ri * 2.2);
    g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.fillStyle = g; ctx.fill();

    // Separadores
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = start + i * seg;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * Ri, cy + Math.sin(a) * Ri);
      ctx.lineTo(cx + Math.cos(a) * Rs, cy + Math.sin(a) * Rs);
      ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = r * 0.0055; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, Rs, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = r * 0.006; ctx.stroke();

    // Pernos luminosos en el bisel (donde "chocan" con el puntero)
    for (let i = 0; i < n; i++) {
      const a = start + i * seg;
      const px = cx + Math.cos(a) * (Rs + (Rb - Rs) * 0.5), py = cy + Math.sin(a) * (Rs + (Rb - Rs) * 0.5);
      const pg = ctx.createRadialGradient(px - r * 0.004, py - r * 0.004, 0, px, py, r * 0.017);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.5, '#c9fff0'); pg.addColorStop(1, '#4fd1b0');
      ctx.save(); ctx.shadowColor = 'rgba(110,255,210,.8)'; ctx.shadowBlur = r * 0.03;
      ctx.beginPath(); ctx.arc(px, py, r * 0.0135, 0, TAU); ctx.fillStyle = pg; ctx.fill(); ctx.restore();
    }

    // Etiquetas (radiales, ajustadas al espacio disponible)
    const maxLen = (Rs - Ri) * 0.78;
    cats.forEach(function (cat, i) {
      const mid = start + i * seg + seg / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let size = r * 0.06;
      ctx.font = '700 ' + size + 'px Montserrat, system-ui, sans-serif';
      if ('letterSpacing' in ctx) ctx.letterSpacing = (size * 0.06) + 'px';
      while (ctx.measureText(cat.name).width > maxLen && size > r * 0.03) {
        size -= 1; ctx.font = '700 ' + size + 'px Montserrat, system-ui, sans-serif';
      }
      ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = r * 0.012; ctx.shadowOffsetY = r * 0.003;
      ctx.fillStyle = cat.enabled ? '#ffffff' : 'rgba(255,255,255,.42)';
      const x = Rs - r * 0.05;
      if (cat.enabled) {
        ctx.fillText(cat.name, x, 0);
      } else {
        ctx.fillText(cat.name, x, -size * 0.38);
        const s2 = size * 0.5;
        ctx.font = '600 ' + s2 + 'px Montserrat, system-ui, sans-serif';
        if ('letterSpacing' in ctx) ctx.letterSpacing = (s2 * 0.18) + 'px';
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        ctx.fillText('PRÓXIMAMENTE', x, size * 0.62);
      }
      ctx.restore();
    });
  };

  Wheel.prototype.setAngle = function (a) {
    this.angle = a;
    this.rotor.style.transform = 'rotate(' + a + 'deg)';
  };

  Wheel.prototype.kick = function (speed) {
    const now = performance.now();
    if (now - this.lastKick < 40) return;
    this.lastKick = now;
    if (R.Sound) R.Sound.tick(speed);
    if (!this.pointer.animate) return;
    const amp = 6 + 16 * Math.min(1, 0.35 + (1 - speed) * 0.65);   // al frenar, cada perno empuja más el puntero
    this.pointer.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + (-amp) + 'deg)', offset: 0.3 }, { transform: 'rotate(0deg)' }],
      { duration: 170, easing: 'cubic-bezier(.3,.7,.4,1)' }
    );
  };

  /* Aplica el estado público. Anima solo cuando llega un giro nuevo. */
  Wheel.prototype.sync = function (state, nowFn) {
    const spin = state.spin;
    this.wrap.classList.toggle('landed', state.phase === 'CATEGORY_SELECTED' && !this.anim);
    this.wrap.classList.toggle('spinning', !!this.anim);
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
    const seg = 360 / R.CATEGORIES.length;
    let lastIdx = Math.floor(from / seg);
    if (nowFn() - spin.id >= spin.durationMs) { this.setAngle(to); return; }   // se unió tarde: sin animación

    this.wrap.classList.add('spinning');
    this.wrap.classList.remove('landed');
    const step = function () {
      const p = Math.min(1, Math.max(0, (nowFn() - spin.id) / spin.durationMs));
      const a = from + (to - from) * ease(p);
      self.setAngle(a);
      const idx = Math.floor(a / seg);
      if (idx !== lastIdx) {
        lastIdx = idx;
        self.kick(Math.min(1, easeSpeed(p) / 4));
      }
      if (p < 1) {
        self.anim = requestAnimationFrame(step);
      } else {
        self.anim = null;
        self.setAngle(to);
        self.wrap.classList.remove('spinning');
        self.wrap.classList.add('landed');
        if (R.Sound) R.Sound.select();
        self.onLand();
      }
    };
    this.anim = requestAnimationFrame(step);
  };

  R.Wheel = Wheel;
})(window.Ruleta = window.Ruleta || {});
