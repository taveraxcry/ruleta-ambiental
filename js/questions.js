/* Banco de preguntas DEFINITIVO (20 preguntas).
   Forma común: { id, category, type, question, options[], correctAnswer (índice desde 0) }.
   En una partida real este archivo NO se carga en el navegador: las preguntas viven en Supabase
   (supabase/seed_questions.sql se genera desde aquí con tools/generate-seed.js).
   Solo lo cargan el modo PREVIEW / DEMO y el modo local sin Supabase. */
(function (R) {
  'use strict';

  const TF = ['Verdadero', 'Falso'];
  const V = 0, F = 1;

  R.QUESTIONS = [
    { id: 1, category: 'BRUNDTLAND', type: 'multiple_choice',
      question: 'Una empresa quiere aumentar su producción rápidamente, pero para hacerlo tendría que agotar recursos naturales que serán necesarios en el futuro. ¿Qué elemento de esta decisión contradice el enfoque planteado por Brundtland?',
      options: ['Considerar las necesidades sociales', 'Proteger los recursos pensando en el futuro', 'Buscar mayor eficiencia productiva', 'Agotar los recursos para aumentar la producción'],
      correctAnswer: 3 },
    { id: 2, category: 'BRUNDTLAND', type: 'true_false',
      question: 'Para el enfoque de Brundtland, el desarrollo no debería basarse en una explotación ilimitada de los recursos naturales.',
      options: TF, correctAnswer: V },

    { id: 3, category: 'KYOTO', type: 'multiple_choice',
      question: '¿En qué año entró en vigor el Protocolo de Kioto?',
      options: ['1992', '1997', '2005', '2015'],
      correctAnswer: 2 },
    { id: 4, category: 'KYOTO', type: 'multiple_choice',
      question: '¿Cuál de las siguientes afirmaciones sobre Estados Unidos y el Protocolo de Kioto es correcta?',
      options: ['Estados Unidos firmó el protocolo, pero no lo ratificó.', 'Estados Unidos nunca firmó el protocolo.', 'Estados Unidos ratificó el protocolo en 2005.', 'Estados Unidos fue uno de los países que creó el Convenio de Ramsar.'],
      correctAnswer: 0 },

    { id: 5, category: 'PARIS', type: 'multiple_choice',
      question: 'Además de las acciones para enfrentar el cambio climático, ¿qué elemento contempla el Acuerdo de París?',
      options: ['Comercio internacional de especies', 'Transporte transfronterizo de residuos', 'Protección exclusiva de humedales', 'Financiamiento climático'],
      correctAnswer: 3 },
    { id: 6, category: 'PARIS', type: 'true_false',
      question: 'El Acuerdo de París contempla aspectos relacionados con adaptación y resiliencia, además de las acciones de reducción de emisiones.',
      options: TF, correctAnswer: V },

    { id: 7, category: 'CITES', type: 'multiple_choice',
      question: 'Un país desea solicitar cooperación internacional para controlar el comercio de una especie que ya regula dentro de su territorio. ¿Qué apéndice de CITES corresponde a esta situación?',
      options: ['Apéndice I', 'Apéndice III', 'Apéndice II', 'Ningún apéndice'],
      correctAnswer: 1 },
    { id: 8, category: 'CITES', type: 'error_identification',
      question: '¿Cuál de las siguientes afirmaciones sobre CITES es INCORRECTA?',
      options: ['Utiliza permisos y certificados en determinados casos.', 'Cuenta con diferentes apéndices para establecer niveles de regulación.', 'Prohíbe absolutamente todo comercio internacional de especies silvestres.', 'Busca controlar determinados casos de comercio internacional de fauna y flora silvestres.'],
      correctAnswer: 2 },

    { id: 9, category: 'RAMSAR', type: 'multiple_choice',
      question: 'Una comunidad quiere aprovechar un humedal sin destruir sus características ecológicas. ¿Cuál de las siguientes decisiones se relaciona mejor con el principio de “uso racional” promovido por Ramsar?',
      options: ['Utilizar el humedal de manera sostenible conservando sus funciones ecológicas.', 'Drenar completamente el humedal.', 'Eliminar toda actividad humana sin excepción.', 'Convertir el humedal en una zona industrial.'],
      correctAnswer: 0 },
    { id: 10, category: 'RAMSAR', type: 'true_false',
      question: 'El enfoque de Ramsar implica que los humedales deben permanecer completamente aislados de cualquier forma de uso humano.',
      options: TF, correctAnswer: F },

    { id: 11, category: 'BASILEA', type: 'multiple_choice',
      question: 'Antes de realizar determinados movimientos transfronterizos de residuos regulados por el Convenio de Basilea, ¿qué principio resulta fundamental?',
      options: ['Uso racional', 'Participación pública', 'Adaptación climática', 'Consentimiento fundamentado previo'],
      correctAnswer: 3 },
    { id: 12, category: 'BASILEA', type: 'error_identification',
      question: '¿Cuál de las siguientes relaciones es INCORRECTA?',
      options: ['Basilea → movimientos transfronterizos de residuos peligrosos', 'CITES → protección y comercio internacional de especies silvestres', 'Ramsar → comercio internacional de especies silvestres', 'Basilea → consentimiento fundamentado previo'],
      correctAnswer: 2 },

    { id: 13, category: 'GINEBRA', type: 'true_false',
      question: 'Los problemas relacionados con la lluvia ácida ayudaron a evidenciar la necesidad de cooperación internacional frente a la contaminación atmosférica que puede desplazarse entre países.',
      options: TF, correctAnswer: V },

    { id: 14, category: 'GOTHENBURG', type: 'multiple_choice',
      question: 'Un programa ambiental establece límites para las emisiones de SO₂, NOx, compuestos orgánicos volátiles (COV) y NH₃. ¿Con qué instrumento se relaciona principalmente?',
      options: ['Acuerdo de París', 'Protocolo de Kioto', 'Protocolo de Gotemburgo', 'Convenio de Ramsar'],
      correctAnswer: 2 },
    { id: 15, category: 'GOTHENBURG', type: 'true_false',
      question: 'El Protocolo de Gotemburgo está relacionado exclusivamente con las emisiones de CO₂.',
      options: TF, correctAnswer: F },

    { id: 16, category: 'ESCAZU', type: 'multiple_choice',
      question: 'Una persona que defiende activamente el ambiente en su territorio recibe amenazas debido a su labor. ¿Qué aspecto relacionado con el Acuerdo de Escazú resulta especialmente pertinente?',
      options: ['Comercio internacional de especies', 'Gestión de humedales', 'Transporte de residuos peligrosos', 'Protección de personas defensoras del ambiente'],
      correctAnswer: 3 },

    { id: 17, category: 'EPI', type: 'multiple_choice',
      question: '¿Cuál de las siguientes afirmaciones describe correctamente la estructura del Índice de Desempeño Ambiental (EPI) presentada en el material?',
      options: ['Se publica anualmente y utiliza únicamente un indicador.', 'Se publica bienalmente y utiliza múltiples indicadores agrupados en categorías y objetivos.', 'Solo compara las emisiones de CO₂.', 'Mide exclusivamente la cantidad de residuos producidos.'],
      correctAnswer: 1 },
    { id: 18, category: 'EPI', type: 'true_false',
      question: 'El Índice de Desempeño Ambiental (EPI) se publica de manera bienal.',
      options: TF, correctAnswer: V },

    { id: 19, category: 'INTEGRADORA', type: 'multiple_choice',
      question: '¿Cuál de las siguientes relaciones es CORRECTA?',
      options: ['Protocolo de Gotemburgo → límites de determinados contaminantes atmosféricos', 'Ramsar → comercio internacional de especies', 'CITES → conservación y uso racional de humedales', 'Basilea → protección de defensores ambientales'],
      correctAnswer: 0 },
    { id: 20, category: 'INTEGRADORA', type: 'error_identification',
      question: 'Una empresa está analizando diferentes instrumentos ambientales. ¿Cuál de las siguientes decisiones está MAL RELACIONADA?',
      options: ['Consultar Basilea antes de analizar determinados movimientos transfronterizos de residuos.', 'Consultar Escazú cuando exista participación y defensa de derechos ambientales.', 'Consultar Gotemburgo frente a determinados contaminantes atmosféricos.', 'Consultar CITES para establecer el uso racional de un humedal.'],
      correctAnswer: 3 }
  ];
})(window.Ruleta = window.Ruleta || {});
