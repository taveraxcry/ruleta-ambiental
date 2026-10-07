# 🌎 Ruleta Ambiental

Concurso educativo multijugador sobre gestión ambiental y logística reversa. HTML + CSS + JavaScript vanilla; el estado de la partida vive en Supabase (Postgres + Realtime). Se publica como sitio estático (GitHub Pages).

- **Anfitrión** (computador): crea la sala, gira la ruleta y controla cada paso. En su pantalla las opciones son de solo lectura: responden los equipos.
- **Equipos** (teléfonos o computadores): entran con el código y el nombre que quieran; un equipo = un dispositivo.
- **Crear sala** solo aparece en computador; en teléfonos la página solo ofrece **Unirse a una sala** (o se entra directo escaneando el QR).
- **Revisión / demo** (oculta): `?demo=1` al final del enlace abre una partida simulada en un solo computador. No usa Supabase ni crea salas.

## Cómo se juega

1. El anfitrión gira la ruleta. Cada segmento es **una pregunta**, con el color de su tema.
2. Si sale una pregunta, todos los equipos la reciben a la vez y tienen **20 s**. Una sola respuesta por equipo.
3. Al cerrar, **no se muestran resultados**: se vuelve directo a la ruleta. Los puntos se guardan en segundo plano.
4. Cada segmento usado **desaparece** al empezar la ronda siguiente: la ruleta conserva su tamaño pero tiene cada vez menos opciones (20 al inicio, 10 al final). Un tema con dos preguntas tiene dos segmentos: sale uno y el otro sigue.
5. Tras la ronda 10 se revela la **clasificación final** con puntos y aciertos de cada equipo.

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
- Una partida real tiene 10 rondas (`TOTAL_ROUNDS`). Ninguna pregunta se repite y la pregunta siempre es la del segmento que salió. El orden de los segmentos lo arman `R.buildWheel` (js/config.js) y `_build_wheel` (SQL) con el mismo algoritmo.
- **ROTTERDAM** y **MONTREAL** no tienen preguntas todavía, así que no tienen segmentos en la ruleta (`enabled: false` en `js/config.js`). Para activarlas: añade sus preguntas, cambia `enabled` a `true` y regenera el seed.
- **INTEGRADORA** es un segmento propio para las preguntas que relacionan varios instrumentos.
- En una partida con Supabase el navegador de los equipos **no descarga** `js/questions.js`; solo lo cargan el Preview y el modo local. Ojo: como el repositorio es público, el archivo (y por tanto las respuestas) es visible en GitHub.

## Configuración

`js/config.js`: `TOTAL_ROUNDS` (rondas reales), `PREVIEW_ROUNDS` (rondas del Preview), `QUESTION_TIME` (segundos), categorías y tabla de puntos.
La tabla de puntos y el orden de las categorías también existen en `supabase/schema.sql` (`_calc_score`, `_wheel_categories`); si cambias uno, cambia el otro.

## En el teléfono

- **QR en la sala del anfitrión:** al escanearlo, el teléfono abre la app con el código ya escrito; solo falta el nombre del equipo (enlace `?sala=ECO-XXX`).
- **Pantalla encendida:** durante la partida la app pide al teléfono no apagar la pantalla (Wake Lock), porque al bloquearse se corta la conexión en vivo. Si se bloquea igual, al volver se reconecta solo.
- **Diseño compacto:** en pantallas pequeñas (iPhone SE) la ruleta deja ver la categoría y las 4 opciones caben sin scroll. Si una pregunta larga obliga a bajar, el tiempo restante pasa al encabezado.
- **Vibración** al responder y al salir la categoría (Android), botones de 50 px o más, sin recarga accidental al deslizar, y efectos más livianos en teléfonos.

## Sonido

Ticks de la ruleta, selección y confirmación se sintetizan con Web Audio (sin archivos). Nada suena al cargar: el audio se habilita con el primer clic o toque (en el anfitrión, con **Girar ruleta**). Hay un botón de silencio en el encabezado.

## Pruebas

```
cd tests
npm install
npm run test:questions  # las 20 preguntas contra la lista oficial, jugadas una a una, y una partida de 10 rondas
npm run test:sql        # seguridad, flujo, ruleta que se encoge y puntuación sobre Postgres real
npm run test:e2e        # anfitrión + 3 teléfonos (QR, mouse y táctil): 3 rondas + final
npm run test:preview    # ruleta, sonido, A/B/C/D, V/F, bloqueo, tiempo agotado, final, teléfono, 0 llamadas a Supabase
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
