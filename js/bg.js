/* Fondo ambiental animado de LOGÍSTICA REVERSA: bucles de circulación (economía circular) por los que
   viajan paquetes, camiones y partículas; símbolos de reciclaje, flechas de retorno y hojas que flotan;
   pulsos de energía. Muy sutil, 24–30 fps, se pausa con la pestaña oculta y respeta "reducir movimiento". */
(function (R) {
  'use strict';

  function start(canvas) {
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const touch = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const frameMs = touch ? 42 : 33;   // 24 fps en teléfonos (batería), 30 fps en computador
    let W = 0, H = 0, dpr = 1;
    let loops = [], movers = [], floaters = [], dust = [], pulses = [];
    let last = 0, raf = 0, t = 0;

    const rand = function (a, b) { return a + Math.random() * (b - a); };
    const pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const area = Math.min(1.4, Math.max(0.6, (W * H) / (1280 * 800)));
      const small = W < 700;
      const base = Math.max(W, 600);
      loops = [   // tres circuitos: recolección, recuperación y reintegro
        { cx: W * 0.18, cy: H * 0.8, rx: base * 0.34, ry: H * 0.22, rot: -0.35, speed: 0.045, hue: 105 },
        { cx: W * 0.86, cy: H * 0.2, rx: base * 0.3, ry: H * 0.2, rot: 0.42, speed: -0.035, hue: 130 },
        { cx: W * 0.55, cy: H * 0.55, rx: base * 0.48, ry: H * 0.34, rot: 0.08, speed: 0.025, hue: 90 }
      ];
      movers = [];
      loops.forEach(function (l, li) {
        const n = Math.round((small ? 6 : 10) * area);
        for (let i = 0; i < n; i++) {
          const r = Math.random();
          const kind = li === 2 && r < 0.18 ? 'truck' : r < 0.5 ? 'box' : 'dot';
          movers.push({ loop: li, a: (i / n) * Math.PI * 2 + rand(0, 0.3), kind: kind, s: kind === 'truck' ? rand(9, 12) : kind === 'box' ? rand(5, 8) : rand(1.2, 2.4) });
        }
      });
      floaters = [];
      const nf = small ? 8 : 14;
      for (let i = 0; i < nf; i++) floaters.push(newFloater(true));
      dust = [];
      const nd = Math.round((small ? 18 : 36) * area);
      for (let i = 0; i < nd; i++) dust.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.5), vy: rand(4, 12), vx: rand(-3, 3), a: rand(0.15, 0.4) });
    }

    function newFloater(anywhere) {
      return {
        kind: pick(['leaf', 'leaf', 'recycle', 'recycle', 'return', 'box']),
        x: rand(0, W), y: anywhere ? rand(0, H) : H + 40, s: rand(8, 15), rot: rand(0, Math.PI * 2),
        vr: rand(-0.22, 0.22), vy: rand(5, 12), sway: rand(10, 26), ph: rand(0, 6), a: rand(0.07, 0.15)
      };
    }

    function pointOn(l, a) {
      const x = Math.cos(a) * l.rx, y = Math.sin(a) * l.ry;
      return { x: l.cx + x * Math.cos(l.rot) - y * Math.sin(l.rot), y: l.cy + x * Math.sin(l.rot) + y * Math.cos(l.rot) };
    }

    /* ---- Figuras ---- */
    function leaf(s) {
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.quadraticCurveTo(s * 0.85, 0, 0, s); ctx.quadraticCurveTo(-s * 0.85, 0, 0, -s);
      ctx.fillStyle = '#8bd36a'; ctx.fill();
      ctx.strokeStyle = 'rgba(10,30,10,.6)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.8); ctx.lineTo(0, s * 0.8); ctx.stroke();
    }
    function arrowArc(rad, a0, a1, w) {   // arco con punta de flecha (sentido horario)
      ctx.beginPath(); ctx.arc(0, 0, rad, a0, a1); ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.stroke();
      const hx = Math.cos(a1) * rad, hy = Math.sin(a1) * rad, tan = a1 + Math.PI / 2, h = w * 2.4;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(tan) * h, hy + Math.sin(tan) * h);
      ctx.lineTo(hx + Math.cos(tan + 2.5) * h, hy + Math.sin(tan + 2.5) * h);
      ctx.lineTo(hx + Math.cos(tan - 2.5) * h, hy + Math.sin(tan - 2.5) * h);
      ctx.closePath(); ctx.fill();
    }
    function recycle(s) {   // tres flechas que se persiguen
      ctx.strokeStyle = '#7ed957'; ctx.fillStyle = '#7ed957';
      for (let i = 0; i < 3; i++) { const a = i * (Math.PI * 2 / 3); arrowArc(s, a + 0.25, a + 1.75, s * 0.2); }
    }
    function returnArrow(s) {   // flecha de retorno (devolución)
      ctx.strokeStyle = '#a5d65a'; ctx.fillStyle = '#a5d65a';
      arrowArc(s, Math.PI * 0.15, Math.PI * 1.75, s * 0.2);
    }
    function box(s) {   // paquete isométrico con cinta
      const h = s * 0.55;
      ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(s, -h * 0.45); ctx.lineTo(0, h * 0.1); ctx.lineTo(-s, -h * 0.45); ctx.closePath();
      ctx.fillStyle = '#f6d9a8'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s, -h * 0.45); ctx.lineTo(0, h * 0.1); ctx.lineTo(0, h * 1.25); ctx.lineTo(-s, h * 0.7); ctx.closePath();
      ctx.fillStyle = '#d9a86a'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(s, -h * 0.45); ctx.lineTo(0, h * 0.1); ctx.lineTo(0, h * 1.25); ctx.lineTo(s, h * 0.7); ctx.closePath();
      ctx.fillStyle = '#b98a4f'; ctx.fill();
      ctx.strokeStyle = 'rgba(80,50,15,.6)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(-s * 0.5, -h * 0.72); ctx.lineTo(s * 0.5, -h * 0.17); ctx.stroke();
    }
    function truck(s) {   // camión de recolección (mirando a la derecha)
      ctx.fillStyle = '#7ed957';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-s * 1.6, -s * 0.9, s * 2, s * 1.2, s * 0.15) : ctx.rect(-s * 1.6, -s * 0.9, s * 2, s * 1.2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(s * 0.5, -s * 0.6); ctx.lineTo(s * 1.0, -s * 0.6); ctx.lineTo(s * 1.35, -s * 0.15); ctx.lineTo(s * 1.35, s * 0.3); ctx.lineTo(s * 0.5, s * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(10,30,10,.75)';
      ctx.fillRect(s * 0.65, -s * 0.45, s * 0.35, s * 0.3);
      ctx.beginPath(); ctx.arc(-s * 0.95, s * 0.38, s * 0.28, 0, Math.PI * 2); ctx.arc(s * 0.85, s * 0.38, s * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(10,30,10,.55)'; ctx.lineWidth = s * 0.12;   // símbolo de reciclaje en la carga
      ctx.beginPath(); ctx.arc(-s * 0.6, -s * 0.3, s * 0.3, 0.3, Math.PI * 1.7); ctx.stroke();
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < frameMs) return;      // un fondo no necesita 60 fps
      const dt = Math.min(0.1, (now - last) / 1000 || 0.033);
      last = now; t += dt;
      ctx.clearRect(0, 0, W, H);

      // Circuitos (líneas discontinuas que avanzan en el sentido del flujo)
      loops.forEach(function (l) {
        ctx.beginPath();
        ctx.ellipse(l.cx, l.cy, l.rx, l.ry, l.rot, 0, Math.PI * 2);
        ctx.strokeStyle = 'hsla(' + l.hue + ',70%,60%,0.06)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 10]);
        ctx.lineDashOffset = -t * 12 * Math.sign(l.speed);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Paquetes, camiones y partículas que recorren los circuitos
      movers.forEach(function (m) {
        const l = loops[m.loop];
        m.a += l.speed * dt * 2.2;
        const p = pointOn(l, m.a);
        if (m.kind === 'dot') {
          for (let k = 5; k >= 0; k--) {
            const q = pointOn(l, m.a - Math.sign(l.speed) * 0.25 * (k / 5));
            ctx.beginPath(); ctx.arc(q.x, q.y, m.s * (1 - k / 7), 0, Math.PI * 2);
            ctx.fillStyle = 'hsla(' + l.hue + ',85%,68%,' + (0.3 * (1 - k / 5)) + ')'; ctx.fill();
          }
          return;
        }
        const ahead = pointOn(l, m.a + Math.sign(l.speed) * 0.02);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = m.kind === 'truck' ? 0.2 : 0.17;
        if (m.kind === 'truck') {
          ctx.rotate(Math.atan2(ahead.y - p.y, ahead.x - p.x));
          truck(m.s);
        } else {
          ctx.rotate(Math.sin(t * 0.8 + m.a) * 0.15);
          box(m.s);
        }
        ctx.restore();
      });

      // Polvo ambiental ascendente
      dust.forEach(function (d) {
        d.y -= d.vy * dt; d.x += d.vx * dt;
        if (d.y < -5) { d.y = H + 5; d.x = rand(0, W); }
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(205,250,180,' + d.a * (0.6 + 0.4 * Math.sin(t + d.x)) + ')'; ctx.fill();
      });

      // Hojas, reciclaje, flechas de retorno y paquetes que flotan
      floaters.forEach(function (F, i) {
        F.y -= F.vy * dt; F.rot += F.vr * dt;
        if (F.y < -40) { floaters[i] = newFloater(false); return; }
        ctx.save();
        ctx.translate(F.x + Math.sin(t * 0.6 + F.ph) * F.sway, F.y);
        ctx.rotate(F.rot);
        ctx.globalAlpha = F.a;
        if (F.kind === 'leaf') leaf(F.s);
        else if (F.kind === 'recycle') recycle(F.s);
        else if (F.kind === 'return') returnArrow(F.s);
        else box(F.s * 0.8);
        ctx.restore();
      });

      // Pulsos de energía ocasionales
      if (Math.random() < dt * 0.25 && pulses.length < 3) pulses.push({ x: rand(W * 0.1, W * 0.9), y: rand(H * 0.1, H * 0.9), r: 0 });
      pulses = pulses.filter(function (p) {
        p.r += 38 * dt;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(126,217,87,' + Math.max(0, 0.12 * (1 - p.r / 220)) + ')';
        ctx.lineWidth = 1.2; ctx.stroke();
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
