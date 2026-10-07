/* Banco de preguntas DEMO (Fase 1). Reemplazar por el banco definitivo (o por una tabla de Supabase).
   Todos los tipos comparten la misma forma: { id, category, type, question, options[], correctAnswer }.
   Campos opcionales: context (para interpretación/situacional), explanation. */
(function (R) {
  'use strict';

  const TF = ['Verdadero', 'Falso'];

  R.QUESTIONS = [
    // KYOTO
    { id: 1, category: 'KYOTO', type: 'multiple_choice',
      question: '¿Cuál es el objetivo principal del Protocolo de Kioto?',
      options: ['Proteger los humedales', 'Reducir las emisiones de gases de efecto invernadero', 'Regular el comercio de fauna silvestre', 'Controlar los residuos peligrosos'],
      correctAnswer: 1 },
    { id: 2, category: 'KYOTO', type: 'true_false',
      question: 'El Protocolo de Kioto fijó metas vinculantes de reducción de emisiones para los países desarrollados.',
      options: TF, correctAnswer: 0 },

    // ROTTERDAM
    { id: 3, category: 'ROTTERDAM', type: 'multiple_choice',
      question: '¿Qué mecanismo central aplica el Convenio de Rotterdam?',
      options: ['Subasta de bonos de carbono', 'Consentimiento fundamentado previo para ciertos químicos y plaguicidas', 'Inventario de humedales', 'Prohibición total del transporte marítimo'],
      correctAnswer: 1 },
    { id: 4, category: 'ROTTERDAM', type: 'situational',
      question: 'Una empresa quiere exportar un plaguicida incluido en el Convenio de Rotterdam. ¿Qué debe verificar primero?',
      options: ['Que el país importador haya dado su consentimiento informado', 'Que el producto tenga empaque reciclable', 'Que el precio sea competitivo', 'Que el envío se haga en temporada seca'],
      correctAnswer: 0 },

    // ESCAZÚ
    { id: 5, category: 'ESCAZU', type: 'multiple_choice',
      question: 'El Acuerdo de Escazú garantiza principalmente el acceso a…',
      options: ['Créditos de carbono', 'Información, participación pública y justicia en asuntos ambientales', 'Energía renovable subsidiada', 'Tecnología de reciclaje'],
      correctAnswer: 1 },
    { id: 6, category: 'ESCAZU', type: 'true_false',
      question: 'El Acuerdo de Escazú es un tratado regional de América Latina y el Caribe.',
      options: TF, correctAnswer: 0 },

    // BASILEA
    { id: 7, category: 'BASILEA', type: 'multiple_choice',
      question: '¿Qué regula principalmente el Convenio de Basilea?',
      options: ['Comercio de especies amenazadas', 'Movimiento transfronterizo de residuos peligrosos y su eliminación', 'Protección de la capa de ozono', 'Conservación de humedales'],
      correctAnswer: 1 },
    { id: 8, category: 'BASILEA', type: 'situational',
      question: 'Una empresa necesita transportar residuos peligrosos a otro país. ¿Qué aspecto debe considerar prioritariamente?',
      options: ['El menor costo de flete', 'La notificación y el consentimiento previo de los países implicados', 'El color de los contenedores', 'La rapidez de la entrega'],
      correctAnswer: 1 },

    // CITES
    { id: 9, category: 'CITES', type: 'multiple_choice',
      question: '¿Qué protege la Convención CITES?',
      options: ['Especies de fauna y flora silvestres frente al comercio internacional no sostenible', 'Los océanos de la contaminación por plásticos', 'La calidad del aire urbano', 'Los suelos agrícolas'],
      correctAnswer: 0 },
    { id: 10, category: 'CITES', type: 'error_identification',
      question: 'Un estudiante afirma: "CITES controla el transporte de residuos peligrosos entre países". ¿Cuál es el error?',
      options: ['Ninguno, la afirmación es correcta', 'Eso corresponde al Convenio de Basilea; CITES regula el comercio de especies', 'CITES solo regula la pesca', 'CITES solo aplica dentro de un mismo país'],
      correctAnswer: 1 },

    // RAMSAR
    { id: 11, category: 'RAMSAR', type: 'multiple_choice',
      question: 'La Convención de Ramsar se enfoca en la conservación y el uso racional de…',
      options: ['Bosques tropicales', 'Humedales', 'Glaciares', 'Desiertos'],
      correctAnswer: 1 },
    { id: 12, category: 'RAMSAR', type: 'true_false',
      question: 'Ramsar promueve el uso racional de los humedales de importancia internacional.',
      options: TF, correctAnswer: 0 },

    // PARÍS
    { id: 13, category: 'PARIS', type: 'multiple_choice',
      question: 'El Acuerdo de París busca limitar el aumento de la temperatura global muy por debajo de…',
      options: ['1 °C', '2 °C', '4 °C', '5 °C'],
      correctAnswer: 1 },
    { id: 14, category: 'PARIS', type: 'multiple_choice',
      question: '¿Cómo se llaman los compromisos climáticos que cada país define en el Acuerdo de París?',
      options: ['Contribuciones determinadas a nivel nacional (NDC)', 'Certificados de reciclaje', 'Cuotas de pesca', 'Planes de ordenamiento portuario'],
      correctAnswer: 0 },

    // MONTREAL
    { id: 15, category: 'MONTREAL', type: 'multiple_choice',
      question: 'El Protocolo de Montreal elimina progresivamente sustancias que…',
      options: ['Contaminan los ríos', 'Agotan la capa de ozono', 'Generan residuos electrónicos', 'Amenazan a los humedales'],
      correctAnswer: 1 },
    { id: 16, category: 'MONTREAL', type: 'interpretation',
      context: 'Tras la entrada en vigor del Protocolo de Montreal, la producción de CFC se eliminó de forma progresiva y la capa de ozono muestra señales de recuperación.',
      question: '¿Qué conclusión es la más adecuada?',
      options: ['Los acuerdos ambientales multilaterales no tienen efecto', 'La cooperación internacional puede lograr resultados ambientales medibles', 'El problema del ozono nunca existió', 'Solo la tecnología resuelve problemas ambientales'],
      correctAnswer: 1 },

    // GINEBRA
    { id: 17, category: 'GINEBRA', type: 'multiple_choice',
      question: 'El Convenio de Ginebra de 1979 trata sobre…',
      options: ['Contaminación atmosférica transfronteriza a gran distancia', 'Comercio de especies amenazadas', 'Residuos peligrosos', 'Pesca en alta mar'],
      correctAnswer: 0 },
    { id: 18, category: 'GINEBRA', type: 'true_false',
      question: 'La contaminación del aire puede cruzar fronteras y afectar a países distintos del que la emite.',
      options: TF, correctAnswer: 0 },

    // GOTHENBURG
    { id: 19, category: 'GOTHENBURG', type: 'multiple_choice',
      question: 'El Protocolo de Gotemburgo busca reducir…',
      options: ['La acidificación, la eutrofización y el ozono troposférico', 'La pesca ilegal', 'El tráfico de fauna', 'El uso de papel'],
      correctAnswer: 0 },
    { id: 20, category: 'GOTHENBURG', type: 'true_false',
      question: 'El Protocolo de Gotemburgo establece techos de emisión para contaminantes como SO₂, NOx y amoníaco.',
      options: TF, correctAnswer: 0 },

    // BRUNDTLAND
    { id: 21, category: 'BRUNDTLAND', type: 'multiple_choice',
      question: 'Según el Informe Brundtland, el desarrollo sostenible es el que…',
      options: ['Maximiza el crecimiento económico sin límites', 'Satisface las necesidades presentes sin comprometer a las generaciones futuras', 'Prohíbe toda actividad industrial', 'Prioriza solo la conservación de especies'],
      correctAnswer: 1 },
    { id: 22, category: 'BRUNDTLAND', type: 'situational',
      question: 'Una empresa logística debe elegir entre ahorrar costos con rutas muy contaminantes o rediseñarlas para reducir emisiones. ¿Qué decisión se alinea con el desarrollo sostenible?',
      options: ['Mantener la ruta más contaminante', 'Rediseñar rutas equilibrando costo, ambiente y sociedad', 'Eliminar la distribución', 'Trasladar el problema a otro proveedor'],
      correctAnswer: 1 },

    // EPI
    { id: 23, category: 'EPI', type: 'multiple_choice',
      question: 'El Índice de Desempeño Ambiental (EPI) sirve para…',
      options: ['Clasificar a los países según su desempeño ambiental', 'Fijar el precio del carbono', 'Medir la velocidad del reciclaje', 'Autorizar la exportación de residuos'],
      correctAnswer: 0 },
    { id: 24, category: 'EPI', type: 'true_false',
      question: 'El EPI evalúa indicadores como la salud ambiental y la vitalidad de los ecosistemas.',
      options: TF, correctAnswer: 0 }
  ];
})(window.Ruleta = window.Ruleta || {});
