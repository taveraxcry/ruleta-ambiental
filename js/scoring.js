/* Cálculo de puntos. Función pura: no sabe de dónde viene el tiempo.
   En multiplayer real, `responseTime` debe calcularse con el reloj del servidor:
   (momento de recepción en el servidor) - (momento de inicio de la pregunta). */
(function (R) {
  'use strict';

  /**
   * @param {number|null} responseTime segundos transcurridos (null = sin respuesta)
   * @param {boolean} isCorrect
   * @returns {number} puntos de la ronda
   */
  function calculateScore(responseTime, isCorrect) {
    if (!isCorrect) return 0;
    if (responseTime === null || responseTime === undefined || isNaN(responseTime)) return 0;
    const t = Math.max(0, responseTime);
    for (const band of R.SCORE_TABLE) {
      if (t <= band.maxSeconds) return band.points;
    }
    return 0;
  }

  R.calculateScore = calculateScore;
})(window.Ruleta = window.Ruleta || {});
