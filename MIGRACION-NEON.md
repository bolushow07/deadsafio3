# Migración de MySQL (Railway) a Postgres (Neon)

## v2 — Ya guarda todo lo nuevo

Esta versión, además del cambio MySQL → Postgres, amplía el esquema para
persistir en base de datos **todo lo que antes solo vivía en `localStorage`**:

- PC completa (`pcBoxes`, con sus cajas y nombres) y el listado plano `box`.
- Medallas (`badges`).
- Marcas por pokémon: **muerto** (`dead`), **robado** (`stolen`, `stolenBy`, `stolenAt`) y **blindado** (`blindado`).
- Contador persistente de muertes (`deathCount`) — revivir no lo resta, igual que en el frontend.
- **Escudo real** activo por participante (`royalShield`).

Si vienes de la v1 (solo Postgres, sin estas columnas), `schema.sql` incluye
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` para todas las columnas nuevas,
así que puedes volver a ejecutarlo sin miedo a perder lo que ya tuvieras.

## Qué cambió (resumen técnico)

- `mysql2/promise` → `pg` (driver oficial de Postgres, funciona perfecto con Neon).
- Placeholders `?` → `$1, $2, ...` (se convierten solos con un helper).
- Transacciones: `conn.beginTransaction()/commit()/rollback()` → `client.query('BEGIN'/'COMMIT'/'ROLLBACK')`.
- IDs autogenerados: `result.insertId` (MySQL) → `RETURNING id` (Postgres).
- `shiny`, `dead`, `stolen`, `blindado`, `royalShield` pasan de `1/0` a `BOOLEAN` nativo de Postgres.
- Cada pokémon lleva ahora `ubicacion` (`'team'` o `'pc'`), y si es de PC, también `pc_box_index` y `pc_box_nombre` para poder reconstruir las cajas tal cual estaban.
- Las rutas (`/api/participantes`, `/api/torneo`, `/api/anuncios`...) siguen igual — solo cambia lo que viaja dentro del JSON (ahora con más campos).

## Pasos para migrar

1. **Crear el proyecto en Neon**
   - Ve a [neon.tech](https://neon.tech), crea una cuenta y un proyecto nuevo.
   - En el dashboard, pulsa "Connect" y copia la cadena de conexión (elige **"Pooled connection"**).

2. **Crear/actualizar las tablas**
   - Abre el "SQL Editor" de Neon y pega el contenido de `schema.sql`, o ejecútalo desde tu terminal:
     ```
     psql "TU_CADENA_DE_CONEXION" -f schema.sql
     ```

3. **Instalar el driver nuevo**
   ```
   npm uninstall mysql2
   npm install pg
   ```

4. **Configurar las variables de entorno**
   - Copia `env.example.txt` a `.env` (o renómbralo directamente a `.env`) y pega tu `DATABASE_URL` de Neon.
   - Si despliegas en Railway (u otro hosting), añade `DATABASE_URL` como variable de entorno en su panel — **no** subas el `.env` real a git.

5. **Sustituir `server.js`** por el que te adjunto, y también actualiza tu `index.html` con la versión que te pasé (los cambios están en `dbParticipantToUI`, `dbRowToPokemon` y `saveParticipantToDB`).

6. **Probar**
   ```
   node server.js
   ```
   Deberías ver `🎮 Deadsafio 3 API arrancada (Postgres / Neon)`. Visita `/api/health` — debe responder `{"ok":true, "message":"Conectado a la base de datos ✓"}`.
   Luego prueba a subir una partida completa (con PC y algún pokémon marcado como muerto/robado/blindado) y recarga la página: todo debería seguir ahí.

## Si ya tenías datos en MySQL

Este cambio crea las tablas vacías en Neon; no migra datos automáticamente (MySQL → Postgres no es un simple volcado, los tipos no son 1:1). Si tienes participantes reales que quieres conservar, dime y te preparo un script de migración de datos aparte.

