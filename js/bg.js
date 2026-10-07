/* Fondo ambiental animado: bucles de circulación de materiales (economía circular), partículas
   que recorren esos bucles, hojas que flotan y pulsos de energía. Muy sutil, ~30 fps, se pausa
   cuando la pestaña no está visible y respeta "reducir movimiento". */
(function (R) {
  'use strict';

  function start(canvas) {
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const frameMs = touch ? 42 : 33;   // 24 fps en teléfonos (batería), 30 fps en computador
    let W = 0, H = 0, dpr = 1;
    let loops = [], flows = [], leaves = [], dust = [], pulses = [];
    let last = 0, raf = 0, t = 0;

    const rand = function (a, b) { return a + Math.random() * (b - a); };

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = (W * H) / (1280 * 800);
      const small = W < 700;
      // Tres bucles grandes, inclinados: la "circulación" de la logística reversa
      loops = [
        { cx: W * 0.18, cy: H * 0.78, rx: Math.max(W, 600) * 0.34, ry: H * 0.22, rot: -0.35, speed: 0.045, hue: 160 },
        { cx: W * 0.86, cy: H * 0.22, rx: Math.max(W, 600) * 0.30, ry: H * 0.2, rot: 0.42, speed: -0.035, hue: 190 },
        { cx: W * 0.55, cy: H * 0.55, rx: Math.max(W, 600) * 0.48, ry: H * 0.34, rot: 0.08, speed: 0.025, hue: 140 }
      ];
      flows = [];
      loops.forEach(function (l, li) {
        const n = Math.round((small ? 7 : 12) * Math.min(1.4, Math.max(0.6, area)));
        for (let i = 0; i < n; i++) flows.push({ loop: li, a: (i / n) * Math.PI * 2 + rand(0, 0.3), r: rand(1.2, 2.4), trail: rand(0.18, 0.32) });
      });
      leaves = [];
      const nLeaves = small ? 5 : 9;
      for (let i = 0; i < nLeaves; i++) leaves.push(newLeaf(true));
      dust = [];
      const nDust = Math.round((small ? 22 : 45) * Math.min(1.3, Math.max(0.6, area)));
      for (let i = 0; i < nDust; i++) dust.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.6), vy: rand(4, 12), vx: rand(-3, 3), a: rand(0.15, 0.45) });
    }

    function newLeaf(anywhere) {
      return {
        x: rand(0, W), y: anywhere ? rand(0, H) : H + 30, s: rand(7, 15), rot: rand(0, Math.PI * 2),
        vr: rand(-0.25, 0.25), vy: rand(6, 14), sway: rand(10, 28), ph: rand(0, 6), a: rand(0.06, 0.14)
      };
    }

    function pointOn(l, a) {
      const x = Math.cos(a) * l.rx, y = Math.sin(a) * l.ry;
      return { x: l.cx + x * Math.cos(l.rot) - y * Math.sin(l.rot), y: l.cy + x * Math.sin(l.rot) + y * Math.cos(l.rot) };
    }

    function drawLeaf(L) {
      ctx.save();
      ctx.translate(L.x + Math.sin(t * 0.6 + L.ph) * L.sway, L.y);
      ctx.rotate(L.rot);
      ctx.globalAlpha = L.a;
      ctx.beginPath();
      ctx.moveTo(0, -L.s);
      ctx.quadraticCurveTo(L.s * 0.85, 0, 0, L.s);
      ctx.quadraticCurveTo(-L.s * 0.85, 0, 0, -L.s);
      ctx.fillStyle = '#7be0a8';
      ctx.fill();
      ctx.strokeStyle = 'rgba(4,30,26,.6)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, -L.s * 0.8); ctx.lineTo(0, L.s * 0.8); ctx.stroke();
      ctx.restore();
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < frameMs) return;      // un fondo no necesita 60 fps
      const dt = Math.min(0.1, (now - last) / 1000 || 0.033);
      last = now; t += dt;
      ctx.clearRect(0, 0, W, H);

      // Bucles de circulación (líneas muy tenues con flechas implícitas por el movimiento)
      loops.forEach(function (l) {
        ctx.beginPath();
        ctx.ellipse(l.cx, l.cy, l.rx, l.ry, l.rot, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsla(' + l.hue + ',70%,60%,0.055)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 10]);
        ctx.lineDashOffset = -t * 12 * Math.sign(l.speed);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Partículas que circulan por los bucles, con estela
      flows.forEach(function (f) {
        const l = loops[f.loop];
        f.a += l.speed * dt * 2.2;
        const p = pointOn(l, f.a);
        const steps = 6;
        for (let k = steps; k >= 0; k--) {
          const q = pointOn(l, f.a - Math.sign(l.speed) * f.trail * (k / steps));
          ctx.beginPath();
          ctx.arc(q.x, q.y, f.r * (1 - k / (steps + 2)), 0, Math.PI * 2);
          ctx.fillStyle = 'hsla(' + l.hue + ',85%,68%,' + (0.32 * (1 - k / steps)) + ')';
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, f.r * 3.2, 0, Math.PI * 2);
        ctx.fillStyle = 'hsla(' + l.hue + ',90%,70%,0.06)';
        ctx.fill();
      });

      // Polvo / partículas ambientales ascendentes
      dust.forEach(function (d) {
        d.y -= d.vy * dt; d.x += d.vx * dt;
        if (d.y < -5) { d.y = H + 5; d.x = rand(0, W); }
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(190,255,230,' + d.a * (0.6 + 0.4 * Math.sin(t + d.x)) + ')';
        ctx.fill();
      });

      // Hojas
      leaves.forEach(function (L, i) {
        L.y -= L.vy * dt; L.rot += L.vr * dt;
        if (L.y < -30) leaves[i] = newLeaf(false);
        drawLeaf(L);
      });

      // Pulsos de energía ocasionales
      if (Math.random() < dt * 0.25 && pulses.length < 3) pulses.push({ x: rand(W * 0.1, W * 0.9), y: rand(H * 0.1, H * 0.9), r: 0 });
      pulses = pulses.filter(function (p) {
        p.r += 38 * dt;
        const a = Math.max(0, 0.12 * (1 - p.r / 220));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(94,234,212,' + a + ')';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        return p.r < 220;
      });
    }

    build();
    let rt = null;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(build, 150); });
    if (reduce) { frame(1000); cancelAnimationFrame(raf); return; }   // un único fotograma estático
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) cancelAnimationFrame(raf);
      else { last = 0; raf = requestAnimationFrame(frame); }
    });
    raf = requestAnimationFrame(frame);
  }

  R.startBackground = start;
})(window.Ruleta = window.Ruleta || {});
