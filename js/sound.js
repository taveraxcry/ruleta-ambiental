/* Sonidos sintetizados con Web Audio (sin archivos). Nada suena al cargar la página:
   el audio solo se habilita con un gesto del usuario (clic/toque/tecla), como exigen los navegadores. */
(function (R) {
  'use strict';

  const KEY = 'ruleta-sound';
  let ctx = null;
  let master = null;
  let noise = null;
  let lastTick = 0;
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch (e) { /* sin almacenamiento */ }

  const stats = { ticks: 0, selects: 0, confirms: 0 };

  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      // Ruido blanco corto reutilizable para el "clic" mecánico
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function ready() { return enabled && ctx && ctx.state === 'running'; }

  function env(gainNode, t, peak, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  }

  /* Clic del puntero al pasar por un segmento. speed (0..1) modula ligeramente el tono. */
  function tick(speed) {
    const now = performance.now();
    if (now - lastTick < 38) return;   // a máxima velocidad no se satura el oído
    lastTick = now;
    stats.ticks++;
    if (!ready()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600 + (speed || 0) * 1400;
    bp.Q.value = 3;
    const g = ctx.createGain();
    env(g, t, 0.5, 0.035);
    src.connect(bp).connect(g).connect(master);
    src.start(t);

    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500 + (speed || 0) * 500, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const g2 = ctx.createGain();
    env(g2, t, 0.06, 0.04);
    o.connect(g2).connect(master);
    o.start(t);
    o.stop(t + 0.05);
  }

  function chime(freqs, gap, peak, decay) {
    const t0 = ctx.currentTime;
    freqs.forEach(function (f, i) {
      const t = t0 + i * gap;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + decay + 0.05);
    });
  }

  /* Selección de categoría al detenerse la ruleta. */
  function select() {
    stats.selects++;
    if (ready()) chime([659.25, 987.77, 1318.51], 0.07, 0.11, 0.55);
  }

  /* Confirmación suave al registrar una respuesta. */
  function confirm() {
    stats.confirms++;
    if (ready()) chime([880, 1174.66], 0.05, 0.06, 0.25);
  }

  function setEnabled(v) {
    enabled = !!v;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) { /* noop */ }
    if (enabled) unlock();
  }

  // Cualquier gesto del usuario deja el audio listo (sin reproducir nada)
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { passive: true, capture: true });
  });

  R.Sound = {
    unlock: unlock, tick: tick, select: select, confirm: confirm, stats: stats,
    isEnabled: function () { return enabled; },
    setEnabled: setEnabled,
    state: function () { return ctx ? ctx.state : 'none'; }
  };
})(window.Ruleta = window.Ruleta || {});
