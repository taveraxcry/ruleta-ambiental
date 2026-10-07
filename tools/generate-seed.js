/* Genera supabase/seed_questions.sql a partir de js/questions.js (única fuente de las preguntas demo).
   Uso: node tools/generate-seed.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

global.window = {};
eval(fs.readFileSync(path.join(root, 'js/questions.js'), 'utf8'));

const q = (s) => (s === null || s === undefined ? 'null' : "'" + String(s).replace(/'/g, "''") + "'");
const rows = window.Ruleta.QUESTIONS.map((x) =>
  `  (${x.id}, ${q(x.category)}, ${q(x.type)}, ${q(x.question)}, ${q(JSON.stringify(x.options))}::jsonb, ${q(x.context)}, ${q(x.explanation)}, ${x.correctAnswer})`
);

const sql = `-- Preguntas DEMO (generado por tools/generate-seed.js — no editar a mano).
-- Ejecutar después de schema.sql. Se puede repetir: actualiza las preguntas existentes.
insert into public.questions (id, category, type, question, options, context, explanation, correct_answer) values
${rows.join(',\n')}
on conflict (id) do update set
  category = excluded.category, type = excluded.type, question = excluded.question,
  options = excluded.options, context = excluded.context, explanation = excluded.explanation,
  correct_answer = excluded.correct_answer;
`;
fs.writeFileSync(path.join(root, 'supabase/seed_questions.sql'), sql);
console.log('seed_questions.sql:', rows.length, 'preguntas');
