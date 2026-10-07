/* Máquina de estados y forma del estado de la partida. */
(function (R) {
  'use strict';

  const PHASES = {
    LOBBY: 'LOBBY',                         // Sala abierta, los equipos se van uniendo
    WAITING: 'WAITING',                     // Partida iniciada, ruleta lista para girar
    SPINNING: 'SPINNING',
    CATEGORY_SELECTED: 'CATEGORY_SELECTED',
    QUESTION_ACTIVE: 'QUESTION_ACTIVE',
    ANSWER_LOCKED: 'ANSWER_LOCKED',
    RESULTS: 'RESULTS',
    LEADERBOARD: 'LEADERBOARD',
    NEXT_ROUND: 'NEXT_ROUND',               // Transitoria: limpia la ronda y vuelve a WAITING
    GAME_OVER: 'GAME_OVER'
  };

  const TRANSITIONS = {
    LOBBY: ['WAITING'],
    WAITING: ['SPINNING'],
    SPINNING: ['CATEGORY_SELECTED'],
    CATEGORY_SELECTED: ['QUESTION_ACTIVE'],
    QUESTION_ACTIVE: ['ANSWER_LOCKED'],
    ANSWER_LOCKED: ['NEXT_ROUND', 'GAME_OVER', 'RESULTS'],   // los puntos se guardan sin mostrarse
    // RESULTS y LEADERBOARD ya no se usan entre rondas: el marcador solo aparece al final
    RESULTS: ['LEADERBOARD'],
    LEADERBOARD: ['NEXT_ROUND', 'GAME_OVER'],
    NEXT_ROUND: ['WAITING'],
    GAME_OVER: []
  };

  function canTransition(from, to) {
    return (TRANSITIONS[from] || []).indexOf(to) !== -1;
  }

  /* Estado AUTORITATIVO: vive solo en el anfitrión (y en el futuro, en el servidor). */
  function createInitialState(roomCode, totalRounds) {
    return {
      roomCode: roomCode,
      phase: PHASES.LOBBY,
      currentRound: 1,
      totalRounds: totalRounds,
      teams: [],               // { id, name, score, correct, isBot, lastSeen, connected }
      wheel: [],               // segmentos que quedan: { c: categoría, q: id de pregunta (privado) }
      wheelRotation: 0,        // grados acumulados de la ruleta
      spin: null,              // { id, categoryIndex (índice del segmento), rotation, durationMs }
      currentCategory: null,   // id de categoría
      currentQuestion: null,   // pregunta completa (incluye correctAnswer: NO se publica tal cual)
      usedQuestionIds: [],
      questionStartedAt: null, // ms, reloj autoritativo
      questionDeadline: null,
      answers: {},             // teamId -> { index, receivedAt, responseTime }
      results: null
    };
  }

  /* Instantánea que se envía a TODOS los dispositivos.
     Oculta la respuesta correcta y las respuestas ajenas hasta que corresponda. */
  function toPublicState(s, now) {
    const showQuestion = [
      PHASES.QUESTION_ACTIVE, PHASES.ANSWER_LOCKED, PHASES.RESULTS, PHASES.LEADERBOARD
    ].indexOf(s.phase) !== -1;
    const q = s.currentQuestion;

    return {
      serverNow: now,
      roomCode: s.roomCode,
      phase: s.phase,
      currentRound: s.currentRound,
      totalRounds: s.totalRounds,
      teams: s.teams.map(function (t) {
        return { id: t.id, name: t.name, score: t.score, correct: t.correct, isBot: t.isBot, connected: t.connected };
      }),
      wheel: s.wheel.map(function (seg) { return { c: seg.c }; }),   // sin ids de pregunta
      wheelRotation: s.wheelRotation,
      spin: s.spin,
      currentCategory: s.phase === PHASES.WAITING || s.phase === PHASES.SPINNING ? null : s.currentCategory,
      question: showQuestion && q ? {
        id: q.id, type: q.type, question: q.question, options: q.options, context: q.context || null
      } : null,
      questionStartedAt: s.questionStartedAt,
      questionDeadline: s.questionDeadline,
      answeredCount: Object.keys(s.answers).length,
      results: s.results
    };
  }

  R.PHASES = PHASES;
  R.canTransition = canTransition;
  R.createInitialState = createInitialState;
  R.toPublicState = toPublicState;
})(window.Ruleta = window.Ruleta || {});
