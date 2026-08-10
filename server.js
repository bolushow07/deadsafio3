// ═══════════════════════════════════════════════════════════
// DEADSAFIO 3 — API Server (Postgres / Neon)
// Arranca con: node server.js
//
// v3: además del equipo, PC (pcBoxes), medallas, marcas de las
// cartas (muerto/robado/blindado), contador de muertes y Escudo
// real, ahora persiste también el historial de ataques recibidos
// (para Escudo real / Reviertefectos), incluidos los contraataques
// (ownerName + applyEffect). Ejecuta schema.sql (v3) antes de usar
// esta versión.
// ═══════════════════════════════════════════════════════════

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Servir el index.html en la raíz
app.get('/', (req, res) => {
  // Sin esto, algunos navegadores se quedan con una copia en caché de
  // index.html y no ven los cambios nuevos hasta que el usuario fuerza un
  // refresco manual — esto obliga a que siempre pidan la versión actual.
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Config (lee .env si existe, si no usa valores por defecto) ─
function getEnv(key, fallback) {
  if (process.env[key]) return process.env[key];
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : fallback;
  } catch { return fallback; }
}

// Neon te da UNA cadena de conexión completa (dashboard → "Connect").
const DATABASE_URL = getEnv('DATABASE_URL', '');

const DB_CONFIG = DATABASE_URL
  ? { connectionString: DATABASE_URL }
  : {
      host:     getEnv('DB_HOST',     'localhost'),
      port:     parseInt(getEnv('DB_PORT', '5432')),
      user:     getEnv('DB_USER',     'postgres'),
      password: getEnv('DB_PASSWORD', ''),
      database: getEnv('DB_NAME',     'deadsafio3'),
    };

const isLocal = (DATABASE_URL || DB_CONFIG.host || '').includes('localhost');
const pool = new Pool({
  ...DB_CONFIG,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

const PORT = parseInt(process.env.PORT || getEnv('API_PORT', '3001'));

// ── Helper de queries ───────────────────────────────────────
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}
async function query(sql, params = []) {
  const { rows } = await pool.query(toPgSql(sql), params);
  return rows;
}

// ── Health check ───────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, message: 'Conectado a la base de datos ✓' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// PARTICIPANTES
// ════════════════════════════════════════════════════════════

// GET /api/participantes — lista todos con equipo + PC + ataques
app.get('/api/participantes', async (req, res) => {
  try {
    const parts = await query(`
      SELECT id, nombre, emoji, estado, num, badges, death_count, royal_shield, hall_of_fame, creado_en
      FROM participantes ORDER BY COALESCE(num, id)
    `);

    for (const p of parts) {
      p.pokemon = await query(
        'SELECT * FROM pokemon WHERE participante_id = ? ORDER BY ubicacion, pc_box_index, slot',
        [p.id]
      );
      p.cartas = await query(
        'SELECT * FROM cartas WHERE participante_id = ? ORDER BY creado_en',
        [p.id]
      );
      p.ataques = await query(
        'SELECT * FROM ataques_recibidos WHERE participante_id = ? ORDER BY creado_en',
        [p.id]
      );
    }

    res.json(parts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/participantes/:id — uno solo con equipo + PC + ataques completos
app.get('/api/participantes/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM participantes WHERE id = ?', [req.params.id]);
    const p = rows[0];
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    p.pokemon = await query('SELECT * FROM pokemon WHERE participante_id = ? ORDER BY ubicacion, pc_box_index, slot', [p.id]);
    p.cartas  = await query('SELECT * FROM cartas WHERE participante_id = ? ORDER BY creado_en', [p.id]);
    p.ataques = await query('SELECT * FROM ataques_recibidos WHERE participante_id = ? ORDER BY creado_en', [p.id]);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/participantes — crear nuevo con equipo + PC + ataques
app.post('/api/participantes', async (req, res) => {
  const {
    nombre, emoji = '💀', estado = 'activo', num,
    badges = 0, deathCount = 0, royalShield = false, hallOfFame = false,
    team = [], pcBoxes = [], cartas = [], attacksReceived = [],
  } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertPart = await client.query(
      `INSERT INTO participantes (nombre, emoji, estado, num, badges, death_count, royal_shield, hall_of_fame)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [nombre, emoji, estado, num || null, badges || 0, deathCount || 0, !!royalShield, !!hallOfFame]
    );
    const partId = insertPart.rows[0].id;

    await insertAllPokemon(client, partId, team, pcBoxes);
    await insertAllAtaques(client, partId, attacksReceived);

    for (const carta of cartas) {
      await client.query(
        'INSERT INTO cartas (participante_id, carta_id, nombre, tipo, rareza, imagen_url) VALUES ($1,$2,$3,$4,$5,$6)',
        [partId, carta.carta_id || carta.id, carta.nombre || '', carta.tipo || '', carta.rareza || '', carta.imagen_url || '']
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, id: partId });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// PUT /api/participantes/:id — actualizar datos + equipo + PC + ataques completos
app.put('/api/participantes/:id', async (req, res) => {
  const { nombre, emoji, estado, num, badges, deathCount, royalShield, hallOfFame, team, pcBoxes, attacksReceived } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const sets = [];
    const vals = [];
    let i = 0;
    if (nombre)                  { sets.push(`nombre=$${++i}`);       vals.push(nombre); }
    if (emoji)                   { sets.push(`emoji=$${++i}`);        vals.push(emoji); }
    if (estado)                  { sets.push(`estado=$${++i}`);       vals.push(estado); }
    if (num !== undefined)       { sets.push(`num=$${++i}`);          vals.push(num); }
    if (badges !== undefined)    { sets.push(`badges=$${++i}`);       vals.push(badges); }
    if (deathCount !== undefined){ sets.push(`death_count=$${++i}`);  vals.push(deathCount); }
    if (royalShield !== undefined){ sets.push(`royal_shield=$${++i}`); vals.push(!!royalShield); }
    if (hallOfFame !== undefined) { sets.push(`hall_of_fame=$${++i}`); vals.push(!!hallOfFame); }
    if (sets.length) {
      vals.push(req.params.id);
      await client.query(`UPDATE participantes SET ${sets.join(',')} WHERE id=$${++i}`, vals);
    }

    // El cliente siempre manda team + pcBoxes juntos (aunque estén vacíos),
    // así que si llega "team" reemplazamos TODO el pokémon (equipo + PC).
    if (team !== undefined) {
      await client.query('DELETE FROM pokemon WHERE participante_id=$1', [req.params.id]);
      await insertAllPokemon(client, req.params.id, team, pcBoxes || []);
    }

    // El cliente manda SIEMPRE el array completo de ataques recibidos
    // (con los ya revertidos y los contraataques incluidos), así que
    // reemplazamos entero.
    if (attacksReceived !== undefined) {
      await client.query('DELETE FROM ataques_recibidos WHERE participante_id=$1', [req.params.id]);
      await insertAllAtaques(client, req.params.id, attacksReceived);
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// DELETE /api/participantes/:id
app.delete('/api/participantes/:id', async (req, res) => {
  try {
    await query('DELETE FROM participantes WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Helper: insertar TODO el pokémon de un participante ─────
// (equipo + todas las cajas de PC), en una misma transacción.
async function insertAllPokemon(client, partId, team, pcBoxes) {
  for (let i = 0; i < team.length && i < 6; i++) {
    await insertPokemon(client, partId, i, team[i], 'team', null, null);
  }
  for (let boxIndex = 0; boxIndex < (pcBoxes || []).length; boxIndex++) {
    const box = pcBoxes[boxIndex];
    const boxPokemon = box?.pokemon || [];
    for (let i = 0; i < boxPokemon.length; i++) {
      await insertPokemon(client, partId, i, boxPokemon[i], 'pc', box.num ?? boxIndex, box.name || null);
    }
  }
}

// ── Helper: insertar el historial de ataques recibidos ──────
// Incluye tanto ataques normales como contraataques (owner_nombre +
// apply_efecto indican, respectivamente, el dueño real del Pokémon
// afectado y si revertir este registro APLICA el efecto en vez de
// quitarlo).
async function insertAllAtaques(client, partId, attacksReceived) {
  for (const a of (attacksReceived || [])) {
    if (!a) continue;
    await client.query(
      `INSERT INTO ataques_recibidos (
         client_id, participante_id, carta, atacante, pokemon_nombre,
         efecto, apply_efecto, owner_nombre, ubicacion, pc_box_index,
         pokemon_index, revertido, creado_en
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        a.id || null, partId, a.card || null, a.attacker || null, a.pokemonName || null,
        a.effect || null, !!a.applyEffect, a.ownerName || null, a.location || null,
        a.boxIndex ?? null, a.pokemonIndex ?? null, !!a.reverted, a.timestamp || new Date().toISOString(),
      ]
    );
  }
}

// ── Helper: insertar un pokémon (equipo o PC) ──────────────
async function insertPokemon(client, partId, slot, pk, ubicacion, pcBoxIndex, pcBoxNombre) {
  if (!pk || !pk.species) return;
  await client.query(`
    INSERT INTO pokemon (
      participante_id, ubicacion, slot, pc_box_index, pc_box_nombre,
      especie, mote, nivel, shiny, pokeball, objeto, habilidad,
      ps, ps_max, ataque, defensa, sp_ataque, sp_defensa, velocidad,
      iv_hp, iv_ataque, iv_defensa, iv_sp_ataque, iv_sp_defensa, iv_velocidad,
      ev_hp, ev_ataque, ev_defensa, ev_sp_ataque, ev_sp_defensa, ev_velocidad,
      naturaleza, felicidad, forma, movimiento_1, movimiento_2, movimiento_3, movimiento_4,
      dead, stolen, stolen_by, stolen_at, blindado
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
      $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43
    )`,
    [
      partId, ubicacion, slot, pcBoxIndex, pcBoxNombre,
      pk.species || pk.especie,
      pk.nickname || pk.mote || null,
      pk.level   || pk.nivel || 1,
      !!pk.shiny,
      pk.pokeball || null,
      pk.item    || pk.objeto || null,
      pk.ability || pk.habilidad || null,
      pk.hp      || null, pk.total_hp || pk.ps_max || null,
      pk.attack  || pk.ataque  || null,
      pk.defense || pk.defensa || null,
      pk.spatk   || pk.sp_ataque || null,
      pk.spdef   || pk.sp_defensa || null,
      pk.speed   || pk.velocidad || null,
      (pk.ivs && pk.ivs.HP)        || pk.iv_hp        || null,
      (pk.ivs && pk.ivs.Attack)    || pk.iv_ataque     || null,
      (pk.ivs && pk.ivs.Defense)   || pk.iv_defensa    || null,
      (pk.ivs && pk.ivs['Sp.Atk']) || pk.iv_sp_ataque  || null,
      (pk.ivs && pk.ivs['Sp.Def']) || pk.iv_sp_defensa || null,
      (pk.ivs && pk.ivs.Speed)     || pk.iv_velocidad  || null,
      (pk.evs && pk.evs.HP)        || pk.ev_hp         || 0,
      (pk.evs && pk.evs.Attack)    || pk.ev_ataque      || 0,
      (pk.evs && pk.evs.Defense)   || pk.ev_defensa     || 0,
      (pk.evs && pk.evs['Sp.Atk']) || pk.ev_sp_ataque   || 0,
      (pk.evs && pk.evs['Sp.Def']) || pk.ev_sp_defensa  || 0,
      (pk.evs && pk.evs.Speed)     || pk.ev_velocidad   || 0,
      pk.nature || pk.naturaleza || null,
      pk.happiness != null ? pk.happiness : (pk.felicidad != null ? pk.felicidad : 255),
      Number.isInteger(pk.form) ? pk.form : (Number.isInteger(pk.forma) ? pk.forma : 0),
      (pk.moves && pk.moves[0] && pk.moves[0].name) || pk.movimiento_1 || null,
      (pk.moves && pk.moves[1] && pk.moves[1].name) || pk.movimiento_2 || null,
      (pk.moves && pk.moves[2] && pk.moves[2].name) || pk.movimiento_3 || null,
      (pk.moves && pk.moves[3] && pk.moves[3].name) || pk.movimiento_4 || null,
      !!pk.dead,
      !!pk.stolen,
      pk.stolenBy || null,
      pk.stolenAt || null,
      !!pk.blindado,
    ]
  );
}

// ════════════════════════════════════════════════════════════
// TORNEO
// ════════════════════════════════════════════════════════════

app.get('/api/torneo', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM torneo WHERE id=1');
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/torneo', async (req, res) => {
  const { titulo, nota, fase } = req.body;
  try {
    await query(
      'UPDATE torneo SET titulo=COALESCE(?,titulo), nota=COALESCE(?,nota), fase=COALESCE(?,fase) WHERE id=1',
      [titulo || null, nota || null, fase || null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// ANUNCIOS
// ════════════════════════════════════════════════════════════

app.get('/api/anuncios', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM anuncios ORDER BY creado_en DESC LIMIT 50');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/anuncios', async (req, res) => {
  const { emoji = '📢', mensaje } = req.body;
  if (!mensaje) return res.status(400).json({ error: 'mensaje requerido' });
  try {
    const rows = await query('INSERT INTO anuncios (emoji, mensaje) VALUES (?,?) RETURNING id', [emoji, mensaje]);
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/anuncios/:id', async (req, res) => {
  try {
    await query('DELETE FROM anuncios WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// COLECCIÓN DE CARTAS (por cuenta, no por navegador)
// ════════════════════════════════════════════════════════════

// GET /api/coleccion/:usuario — cartas y cantidades de esa cuenta
app.get('/api/coleccion/:usuario', async (req, res) => {
  try {
    const rows = await query(
      'SELECT carta, cantidad FROM colecciones WHERE usuario = ?',
      [req.params.usuario]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/coleccion/:usuario — reemplaza toda la colección de esa cuenta
app.put('/api/coleccion/:usuario', async (req, res) => {
  const { cards = [] } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM colecciones WHERE usuario=$1', [req.params.usuario]);
    for (const c of cards) {
      if (!c || !c.carta || !c.cantidad) continue;
      await client.query(
        'INSERT INTO colecciones (usuario, carta, cantidad) VALUES ($1,$2,$3)',
        [req.params.usuario, c.carta, c.cantidad]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ════════════════════════════════════════════════════════════
// CONTRASEÑAS DE SOBRE YA USADAS (de un solo uso POR CUENTA)
// ════════════════════════════════════════════════════════════

// GET /api/sobres-usados/:usuario — códigos que ESA cuenta ya ha usado
// (otras cuentas pueden seguir usando la misma contraseña).
app.get('/api/sobres-usados/:usuario', async (req, res) => {
  try {
    const rows = await query(
      'SELECT codigo, usado_en FROM sobres_usados WHERE usado_por = ?',
      [req.params.usuario]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sobres-usados — marca un código como usado por una cuenta
// concreta (idempotente: si esa misma cuenta ya lo había usado, no falla
// ni lo duplica; otras cuentas pueden seguir usándolo con normalidad).
app.post('/api/sobres-usados', async (req, res) => {
  const { codigo, usadoPor } = req.body;
  if (!codigo) return res.status(400).json({ error: 'codigo requerido' });
  if (!usadoPor) return res.status(400).json({ error: 'usadoPor requerido' });
  try {
    await query(
      'INSERT INTO sobres_usados (codigo, usado_por) VALUES (?,?) ON CONFLICT (codigo, usado_por) DO NOTHING',
      [codigo, usadoPor]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arrancar ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎮 Deadsafio 3 API arrancada (Postgres / Neon)`);
  console.log(`   http://localhost:${PORT}/api/health\n`);
  console.log(`   DB: ${DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ':****@') : `${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`}`);
});
