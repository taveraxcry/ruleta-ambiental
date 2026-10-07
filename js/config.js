/* Configuración global del juego. Cambia aquí rondas, tiempos, categorías y puntuación. */
(function (R) {
  'use strict';

  R.CONFIG = {
    TOTAL_ROUNDS: 10,          // Número de rondas por partida
    QUESTION_TIME: 20,         // Segundos por pregunta
    SPIN_DURATION_MS: 5200,    // Duración de la animación de la ruleta
    RESULTS_DELAY_MS: 1600,    // Pausa entre "respuestas cerradas" y resultados
    MAX_TEAM_NAME: 20,
    MIN_TEAM_NAME: 2,
    HEARTBEAT_MS: 4000,        // Latido de los equipos
    OFFLINE_AFTER_MS: 13000,   // Sin latido durante este tiempo => desconectado
    JOIN_TIMEOUT_MS: 2500,
    CHANNEL_NAME: 'ruleta-ambiental-v1'
  };

  /* Para añadir, quitar o dividir categorías basta con editar esta lista.
     La ruleta se dibuja con tantos segmentos como elementos haya. */
  R.CATEGORIES = [
    { id: 'KYOTO',       name: 'KYOTO',       emoji: '🌡️', color: '#2e9e4f', topic: 'Reducción de gases de efecto invernadero' },
    { id: 'ROTTERDAM',   name: 'ROTTERDAM',   emoji: '🧪', color: '#1c78c0', topic: 'Comercio de químicos y plaguicidas peligrosos' },
    { id: 'ESCAZU',      name: 'ESCAZÚ',      emoji: '⚖️', color: '#c97d12', topic: 'Acceso a la información y justicia ambiental' },
    { id: 'BASILEA',     name: 'BASILEA',     emoji: '♻️', color: '#0f9b8e', topic: 'Residuos peligrosos y movimientos transfronterizos' },
    { id: 'CITES',       name: 'CITES',       emoji: '🦜', color: '#6f8f18', topic: 'Comercio internacional de especies amenazadas' },
    { id: 'RAMSAR',      name: 'RAMSAR',      emoji: '🦆', color: '#3b4fb8', topic: 'Conservación de humedales' },
    { id: 'PARIS',       name: 'PARÍS',       emoji: '🌍', color: '#1f8a5b', topic: 'Acuerdo climático global' },
    { id: 'MONTREAL',    name: 'MONTREAL',    emoji: '🛡️', color: '#0e8fb5', topic: 'Protección de la capa de ozono' },
    { id: 'GINEBRA',     name: 'GINEBRA',     emoji: '🌫️', color: '#bf4a35', topic: 'Contaminación atmosférica transfronteriza' },
    { id: 'GOTHENBURG',  name: 'GOTHENBURG',  emoji: '🏭', color: '#4a9a28', topic: 'Acidificación, eutrofización y ozono troposférico' },
    { id: 'BRUNDTLAND',  name: 'BRUNDTLAND',  emoji: '🌱', color: '#127a8a', topic: 'Desarrollo sostenible' },
    { id: 'EPI',         name: 'EPI',         emoji: '📊', color: '#8250bd', topic: 'Índice de Desempeño Ambiental' }
  ];

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
    error_identification: 'Identifica el error',
    interpretation:       'Interpretación'
  };
})(window.Ruleta = window.Ruleta || {});
