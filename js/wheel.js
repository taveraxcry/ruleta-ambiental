/* Ruleta: se dibuja una sola vez en un canvas y se gira con una transición CSS.
   Convención: el puntero está arriba; el segmento 0 empieza en el puntero y avanza en sentido horario. */
(function (R) {
  'use strict';

  function Wheel(canvas, rotor) {
    this.canvas = canvas;
    this.rotor = rotor;
    this.appliedSpinId = null;
    this.draw();
  }

  Wheel.prototype.draw = function () {
    const cats = R.CATEGORIES;
    const size = 640;
    const c = this.canvas;
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const cx = size / 2, cy = size / 2, radius = size / 2 - 10;
    const seg = (Math.PI * 2) / cats.length;
    const start = -Math.PI / 2;

    ctx.clearRect(0, 0, size, size);
    cats.forEach(function (cat, i) {
      const a0 = start + i * seg, a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, a0, a1);
      ctx.closePath();
      ctx.fillStyle = cat.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.stroke();

      // Texto a lo largo del radio
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a0 + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 4;
      ctx.font = '700 25px Outfit, system-ui, sans-serif';
      ctx.fillText(cat.name, radius - 22, 0);
      ctx.font = '26px system-ui, "Segoe UI Emoji", sans-serif';
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.fillText(cat.emoji, radius * 0.36, 0);
      ctx.restore();
    });

    // Aro exterior
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
  };

  /* Aplica el estado público. Anima solo cuando llega un giro nuevo. */
  Wheel.prototype.sync = function (state) {
    const spin = state.spin;
    const rotor = this.rotor;
    if (state.phase === 'SPINNING' && spin && spin.id !== this.appliedSpinId) {
      this.appliedSpinId = spin.id;
      rotor.style.transition = 'transform ' + spin.durationMs + 'ms cubic-bezier(.12,.62,.12,1)';
      // forzar reflow para que la transición parta de la posición actual
      void rotor.offsetWidth;
      rotor.style.transform = 'rotate(' + spin.rotation + 'deg)';
    } else if (state.phase !== 'SPINNING') {
      if (spin) this.appliedSpinId = spin.id;
      rotor.style.transition = 'none';
      rotor.style.transform = 'rotate(' + state.wheelRotation + 'deg)';
    }
  };

  R.Wheel = Wheel;
})(window.Ruleta = window.Ruleta || {});
