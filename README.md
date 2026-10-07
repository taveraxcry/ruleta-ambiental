# 🌎 Ruleta Ambiental

Concurso educativo multijugador sobre gestión ambiental y logística reversa. HTML + CSS + JavaScript vanilla; el estado de la partida vive en Supabase (Postgres + Realtime). Se publica como sitio estático (GitHub Pages).

- **Anfitrión** (computador): crea la sala, gira la ruleta y controla cada paso.
- **Equipos** (teléfonos o computadores): entran con el código y el nombre que quieran; un equipo = un dispositivo.

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

## Configuración

`js/config.js`: `TOTAL_ROUNDS` (rondas), `QUESTION_TIME` (segundos), categorías y tabla de puntos.
La tabla de puntos y la lista de categorías también existen en `supabase/schema.sql` (`_calc_score`, `spin`); si cambias una, cambia la otra.

## Pruebas

```
cd tests
npm install
npm run test:sql    # 25 pruebas de seguridad, flujo y puntuación sobre Postgres real
npm run test:e2e    # anfitrión + 3 equipos móviles en Chrome, partida completa de 2 rondas
```

Las pruebas usan un Postgres embebido con el mismo `schema.sql` y un puente que imita la API de Supabase. **No** sustituyen una prueba con el proyecto real de Supabase y varios dispositivos físicos.

## Estructura

```
index.html, css/styles.css
js/        config, questions, scoring, state, host/client (modo local), supabase-backend, wheel, app
supabase/  schema.sql, seed_questions.sql (generado con tools/generate-seed.js)
tests/     pruebas SQL y de extremo a extremo
```
