/* Configuración global del juego. Cambia aquí rondas, tiempos, categorías y puntuación. */
(function (R) {
  'use strict';

  R.CONFIG = {
    TOTAL_ROUNDS: 10,          // Rondas por partida real (se usan 10 de las 20 preguntas, sin repetir)
    PREVIEW_ROUNDS: 5,         // Rondas del modo PREVIEW / DEMO
    QUESTION_TIME: 10,         // Segundos por pregunta (el servidor recibe este valor al crear la sala)
    SPIN_DURATION_MS: 7000,    // Duración del giro (debe coincidir con spin() en supabase/schema.sql)
    RESULTS_DELAY_MS: 2200,    // Pausa con "Respuestas cerradas" antes de volver a la ruleta
    MAX_TEAM_NAME: 20,
    MIN_TEAM_NAME: 2,
    HEARTBEAT_MS: 4000,        // Latido de los equipos (modo local)
    OFFLINE_AFTER_MS: 13000,   // Sin latido durante este tiempo => desconectado
    JOIN_TIMEOUT_MS: 2500,
    CHANNEL_NAME: 'ruleta-ambiental-v1',
    DEMO_TEAMS: ['Circular Lab', 'Green Route', 'ReLogística', 'Eco Norte']
  };

  /* Segmentos de la ruleta, en orden horario desde el puntero.
     IMPORTANTE: el orden debe coincidir con v_cats de public.spin() en supabase/schema.sql.
     enabled:false = categoría prevista en el diseño académico pero sin material cargado todavía:
     se dibuja atenuada y la ruleta nunca la selecciona. Al cargar sus preguntas, cambiar a true. */
  R.CATEGORIES = [
    { id: 'KYOTO',       name: 'KYOTO',       color: '#1f9e6e', enabled: true,  topic: 'Reducción de gases de efecto invernadero' },
    { id: 'ROTTERDAM',   name: 'ROTTERDAM',   color: '#3d5a6c', enabled: false, topic: 'Comercio de químicos y plaguicidas peligrosos' },
    { id: 'ESCAZU',      name: 'ESCAZÚ',      color: '#d28a2e', enabled: true,  topic: 'Acceso a la información, participación y justicia ambiental' },
    { id: 'BASILEA',     name: 'BASILEA',     color: '#0f8f9a', enabled: true,  topic: 'Movimientos transfronterizos de residuos peligrosos' },
    { id: 'CITES',       name: 'CITES',       color: '#6f9a2a', enabled: true,  topic: 'Comercio internacional de especies silvestres' },
    { id: 'RAMSAR',      name: 'RAMSAR',      color: '#2f6fd0', enabled: true,  topic: 'Conservación y uso racional de humedales' },
    { id: 'PARIS',       name: 'PARÍS',       color: '#18a67a', enabled: true,  topic: 'Acuerdo climático global' },
    { id: 'MONTREAL',    name: 'MONTREAL',    color: '#4a6378', enabled: false, topic: 'Protección de la capa de ozono' },
    { id: 'GINEBRA',     name: 'GINEBRA',     color: '#c4553f', enabled: true,  topic: 'Contaminación atmosférica transfronteriza (1979)' },
    { id: 'GOTHENBURG',  name: 'GOTHENBURG',  color: '#5b4fc4', enabled: true,  topic: 'Límites a contaminantes atmosféricos' },
    { id: 'BRUNDTLAND',  name: 'BRUNDTLAND',  color: '#2a9d4b', enabled: true,  topic: 'Desarrollo sostenible' },
    { id: 'EPI',         name: 'EPI',         color: '#8a4fbf', enabled: true,  topic: 'Índice de Desempeño Ambiental' },
    { id: 'INTEGRADORA', name: 'INTEGRADORA', color: '#0e7fb8', enabled: true,  topic: 'Relaciona varios instrumentos ambientales' }
  ];

  /* Segmentos de la ruleta: UNO POR PREGUNTA. Cada segmento usado desaparece al empezar la ronda siguiente,
     así la ruleta mantiene su tamaño pero va teniendo menos opciones. Orden: ronda por categorías (primera
     pregunta de cada categoría, luego la segunda…) para no juntar colores.
     IMPORTANTE: public._build_wheel() en supabase/schema.sql usa exactamente el mismo algoritmo. */
  R.buildWheel = function (questions) {
    const order = R.CATEGORIES.filter(function (c) { return c.enabled; }).map(function (c) { return c.id; });
    const byCat = {};
    questions.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (q) {
      if (order.indexOf(q.category) !== -1) (byCat[q.category] = byCat[q.category] || []).push(q.id);
    });
    const segs = [];
    for (let k = 0; ; k++) {
      let added = false;
      order.forEach(function (c) { if (byCat[c] && byCat[c][k] !== undefined) { segs.push({ c: c, q: byCat[c][k] }); added = true; } });
      if (!added) break;
    }
    return segs;
  };

  /* Tabla de puntos por velocidad (solo respuestas correctas).
     Se usa el primer tramo cuyo límite superior (en segundos) sea >= al tiempo de respuesta. */
  R.SCORE_TABLE = [
    { maxSeconds: 2,  points: 100 },
    { maxSeconds: 4,  points: 90 },
    { maxSeconds: 6,  points: 80 },
    { maxSeconds: 8,  points: 70 },
    { maxSeconds: 10, points: 60 },
    { maxSeconds: 12, points: 50 },
    { maxSeconds: 14, points: 40 },
    { maxSeconds: 16, points: 30 },
    { maxSeconds: 18, points: 25 },
    { maxSeconds: 20, points: 20 }
  ];

  R.QUESTION_TYPES = {
    multiple_choice:      'Selección múltiple',
    true_false:           'Verdadero / Falso',
    situational:          'Situacional',
    error_identification: 'Detecta el error',
    interpretation:       'Interpretación'
  };
})(window.Ruleta = window.Ruleta || {});
