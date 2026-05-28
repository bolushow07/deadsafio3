// ═══════════════════════════════════════════════════════════
// DEADSAFIO 3 — API Server
// Arranca con: node server.js
// ═══════════════════════════════════════════════════════════

const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// Servir el Index.html en la raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Config (lee .env si existe, si no usa valores por defecto) ─
function getEnv(key, fallback) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    const match = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].trim() : fallback;
  } catch { return fallback; }
}

const DB_CONFIG = {
  host:     getEnv('DB_HOST',     'localhost'),
  port:     parseInt(getEnv('DB_PORT', '3306')),
  user:     getEnv('DB_USER',     'root'),
  password: getEnv('DB_PASSWORD', ''),
  database: getEnv('DB_NAME',     'deadsafio3'),
  charset:  'utf8mb4',
};
const PORT = parseInt(process.env.PORT || getEnv('API_PORT', '3001'));

// ── Pool de conexiones ─────────────────────────────────────
let pool;
async function getPool() {
  if (!pool) pool = mysql.createPool({ ...DB_CONFIG, waitForConnections: true, connectionLimit: 10 });
  return pool;
}

async function query(sql, params = []) {
  const p = await getPool();
  const [rows] = await p.execute(sql, params);
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

// GET /api/participantes — lista todos con su equipo pokémon
app.get('/api/participantes', async (req, res) => {
  try {
    const parts = await query(`
      SELECT id, nombre, emoji, estado, num, creado_en
      FROM participantes ORDER BY COALESCE(num, id)
    `);

    for (const p of parts) {
      p.pokemon = await query(
        'SELECT * FROM pokemon WHERE participante_id = ? ORDER BY slot',
        [p.id]
      );
      p.cartas = await query(
        'SELECT * FROM cartas WHERE participante_id = ? ORDER BY creado_en',
        [p.id]
      );
    }

    res.json(parts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/participantes/:id — uno solo con equipo completo
app.get('/api/participantes/:id', async (req, res) => {
  try {
    const [p] = await query('SELECT * FROM participantes WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'No encontrado' });
    p.pokemon = await query('SELECT * FROM pokemon WHERE participante_id = ? ORDER BY slot', [p.id]);
    p.cartas  = await query('SELECT * FROM cartas WHERE participante_id = ? ORDER BY creado_en', [p.id]);
    res.json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/participantes — crear nuevo con su equipo
app.post('/api/participantes', async (req, res) => {
  const { nombre, emoji = '💀', estado = 'activo', num, team = [], cartas = [] } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });

  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.execute(
      'INSERT INTO participantes (nombre, emoji, estado, num) VALUES (?, ?, ?, ?)',
      [nombre, emoji, estado, num || null]
    );
    const partId = result.insertId;

    // Insertar equipo pokémon
    for (let i = 0; i < team.length && i < 6; i++) {
      await insertPokemon(conn, partId, i, team[i]);
    }

    // Insertar cartas
    for (const carta of cartas) {
      await conn.execute(
        'INSERT INTO cartas (participante_id, carta_id, nombre, tipo, rareza, imagen_url) VALUES (?,?,?,?,?,?)',
        [partId, carta.carta_id || carta.id, carta.nombre || '', carta.tipo || '', carta.rareza || '', carta.imagen_url || '']
      );
    }

    await conn.commit();
    res.json({ ok: true, id: partId });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// PUT /api/participantes/:id — actualizar datos + equipo completo
app.put('/api/participantes/:id', async (req, res) => {
  const { nombre, emoji, estado, num, team } = req.body;
  const p = await getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();

    if (nombre || emoji || estado || num !== undefined) {
      const sets = [];
      const vals = [];
      if (nombre) { sets.push('nombre=?'); vals.push(nombre); }
      if (emoji)  { sets.push('emoji=?');  vals.push(emoji);  }
      if (estado) { sets.push('estado=?'); vals.push(estado); }
      if (num !== undefined) { sets.push('num=?'); vals.push(num); }
      if (sets.length) {
        vals.push(req.params.id);
        await conn.execute(`UPDATE participantes SET ${sets.join(',')} WHERE id=?`, vals);
      }
    }

    if (team) {
      await conn.execute('DELETE FROM pokemon WHERE participante_id=?', [req.params.id]);
      for (let i = 0; i < team.length && i < 6; i++) {
        await insertPokemon(conn, req.params.id, i, team[i]);
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
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

// ── Helper: insertar un pokémon ────────────────────────────
async function insertPokemon(conn, partId, slot, pk) {
  if (!pk || !pk.species) return;
  await conn.execute(`
    INSERT INTO pokemon (
      participante_id, slot, especie, mote, nivel, shiny, pokeball, objeto, habilidad,
      ps, ps_max, ataque, defensa, sp_ataque, sp_defensa, velocidad,
      iv_hp, iv_ataque, iv_defensa, iv_sp_ataque, iv_sp_defensa, iv_velocidad,
      ev_hp, ev_ataque, ev_defensa, ev_sp_ataque, ev_sp_defensa, ev_velocidad,
      naturaleza, felicidad, movimiento_1, movimiento_2, movimiento_3, movimiento_4
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      partId, slot,
      pk.species || pk.especie,
      pk.nickname || pk.mote || null,
      pk.level   || pk.nivel || 1,
      pk.shiny   ? 1 : 0,
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
      (pk.moves && pk.moves[0] && pk.moves[0].name) || pk.movimiento_1 || null,
      (pk.moves && pk.moves[1] && pk.moves[1].name) || pk.movimiento_2 || null,
      (pk.moves && pk.moves[2] && pk.moves[2].name) || pk.movimiento_3 || null,
      (pk.moves && pk.moves[3] && pk.moves[3].name) || pk.movimiento_4 || null,
    ]
  );
}

// ════════════════════════════════════════════════════════════
// TORNEO
// ════════════════════════════════════════════════════════════

app.get('/api/torneo', async (req, res) => {
  try {
    const [t] = await query('SELECT * FROM torneo WHERE id=1');
    res.json(t || {});
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
    const r = await query('INSERT INTO anuncios (emoji, mensaje) VALUES (?,?)', [emoji, mensaje]);
    res.json({ ok: true, id: r.insertId });
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

// ── Arrancar ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎮 Deadsafio 3 API arrancada`);
  console.log(`   http://localhost:${PORT}/api/health\n`);
  console.log(`   DB: ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
});
