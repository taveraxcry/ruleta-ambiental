# 🌎 Ruleta Ambiental

Concurso educativo multijugador sobre gestión ambiental y logística reversa. HTML + CSS + JavaScript vanilla; el estado de la partida vive en Supabase (Postgres + Realtime). Se publica como sitio estático (GitHub Pages).

- **Anfitrión** (computador): crea la sala, gira la ruleta y controla cada paso. En su pantalla las opciones son de solo lectura: responden los equipos.
- **Equipos** (teléfonos o computadores): entran con el código y el nombre que quieran; un equipo = un dispositivo.
- **PREVIEW / DEMO** (un solo computador): recorre el juego completo con datos simulados para revisarlo. Controlas la partida y respondes como "Tu equipo" contra 4 equipos simulados. No usa Supabase, no crea salas y no envía nada por la red.

## Puesta en marcha (una sola vez)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **Authentication → Providers → Anonymous sign-ins → activar.** Cada dispositivo usa una sesión anónima para identificar a su equipo (así se reconecta sin duplicarse).
3. **SQL Editor:** ejecuta `supabase/schema.sql` y después `supabase/seed_questions.sql`. Ambos se pueden repetir sin problema.
4. **Settings → API:** copia la *Project URL* y la clave *anon / publishable* en [js/supabase-config.js](js/supabase-config.js). Esa clave es pública por diseño. **Nunca** pongas la `service_role` ni la contraseña de la base en el frontend.
5. Publica: en GitHub → Settings → Pages → *Deploy from a branch* → `main` / raíz.

Mientras `supabase-config.js` esté vacío, la app arranca en **modo local** (varias pestañas del mismo navegador) y lo avisa en la pantalla de inicio.

## Cómo se garantiza un único estado y la seguridad

| Requisito | Dónde se resuelve |
|---|---|
| Un estado autoritativo | Tabla `rooms` en Postgres; los clientes solo la leen |
| Categoría y pregunta iguales para todos | `spin()` / `show_question()` deciden una vez en el servidor |
| Tiempo de respuesta autoritativo | `submit_answer()` usa `clock_timestamp()` del servidor |
| Puntos por corrección + velocidad | `_calc_score()` + `show_results()` (solo se calculan una vez por ronda) |
| Una respuesta por equipo | clave primaria `(sala, ronda, equipo)` + error si repite |
| Nadie manipula puntos ni respuestas | RLS: sin permisos de escritura; todo pasa por funciones RPC |
| Respuesta correcta oculta | vive en `questions`, que ningún cliente puede leer; solo se publica al mostrar resultados |
| Solo el anfitrión controla | cada RPC de control verifica `host_id = auth.uid()` |
| Reconexión sin duplicados | sesión anónima persistente + `join_room` idempotente (`unique(sala, usuario)`) |

## Preguntas y categorías

- El banco definitivo (20 preguntas) está en [js/questions.js](js/questions.js). Tras editarlo: `node tools/generate-seed.js` y vuelve a ejecutar `supabase/seed_questions.sql` en Supabase.
- Una partida real usa 10 preguntas (`TOTAL_ROUNDS`) sin repetir. La ruleta solo cae en categorías que todavía tienen preguntas sin usar, y la pregunta siempre es de la categoría que salió.
- **ROTTERDAM** y **MONTREAL** aparecen en la ruleta como "Próximamente" (`enabled: false` en `js/config.js`) porque aún no tienen material. Nunca se seleccionan. Para activarlas: añade sus preguntas, cambia `enabled` a `true` y regenera el seed.
- **INTEGRADORA** es un segmento propio para las preguntas que relacionan varios instrumentos.
- En una partida con Supabase el navegador de los equipos **no descarga** `js/questions.js`; solo lo cargan el Preview y el modo local. Ojo: como el repositorio es público, el archivo (y por tanto las respuestas) es visible en GitHub.

## Configuración

`js/config.js`: `TOTAL_ROUNDS` (rondas reales), `PREVIEW_ROUNDS` (rondas del Preview), `QUESTION_TIME` (segundos), categorías y tabla de puntos.
La tabla de puntos y el orden de las categorías también existen en `supabase/schema.sql` (`_calc_score`, `_wheel_categories`); si cambias uno, cambia el otro.

## Sonido

Ticks de la ruleta, selección y confirmación se sintetizan con Web Audio (sin archivos). Nada suena al cargar: el audio se habilita con el primer clic o toque (en el anfitrión, con **Girar ruleta**). Hay un botón de silencio en el encabezado.

## Pruebas

```
cd tests
npm install
npm run test:sql      # seguridad, flujo, puntuación y selección de preguntas sobre Postgres real
npm run test:e2e      # anfitrión + 3 equipos móviles (mouse y táctil), partida completa de 2 rondas
npm run test:preview  # Preview completo: ruleta, sonido, A/B/C/D, V/F, bloqueo, tiempo agotado, final, 0 llamadas a Supabase
```

Las pruebas usan un Postgres embebido con el mismo `schema.sql` y un puente que imita la API de Supabase. **No** sustituyen una prueba con el proyecto real de Supabase y varios dispositivos físicos.

## Estructura

```
index.html, css/styles.css
js/        config, questions, scoring, state, host/client (modo local y Preview), supabase-backend,
           wheel (ruleta), sound (Web Audio), bg (fondo animado), app (interfaz)
supabase/  schema.sql, seed_questions.sql (generado con tools/generate-seed.js)
tests/     pruebas SQL y de extremo a extremo
```
