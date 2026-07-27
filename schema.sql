-- ═══════════════════════════════════════════════════════════
-- DEADSAFIO 3 — Esquema Postgres (Neon)
-- Ejecuta este archivo una vez en tu base de datos de Neon
-- (SQL Editor del dashboard, o con: psql "$DATABASE_URL" -f schema.sql)
--
-- v2: añade persistencia de PC, caja, medallas, muerte/robo/blindaje
-- por pokémon, contador de muertes y Escudo real por participante.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS participantes (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(255) NOT NULL,
  emoji         VARCHAR(16)  DEFAULT '💀',
  estado        VARCHAR(32)  DEFAULT 'activo',
  num           INTEGER,
  badges        INTEGER DEFAULT 0,      -- medallas
  death_count   INTEGER DEFAULT 0,      -- contador persistente de muertes (revivir NO lo resta)
  royal_shield  BOOLEAN DEFAULT FALSE,  -- Escudo real activo
  creado_en     TIMESTAMP DEFAULT NOW()
);

-- Si ya tenías la tabla creada de antes (v1), esto añade las columnas nuevas sin borrar nada:
ALTER TABLE participantes ADD COLUMN IF NOT EXISTS badges       INTEGER DEFAULT 0;
ALTER TABLE participantes ADD COLUMN IF NOT EXISTS death_count  INTEGER DEFAULT 0;
ALTER TABLE participantes ADD COLUMN IF NOT EXISTS royal_shield BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS pokemon (
  id               SERIAL PRIMARY KEY,
  participante_id  INTEGER NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,

  -- Ubicación dentro de la partida
  ubicacion        VARCHAR(10) DEFAULT 'team',  -- 'team' | 'pc'
  slot             INTEGER,                     -- posición dentro del equipo o de su caja de PC
  pc_box_index     INTEGER,                     -- nº de caja de PC (NULL si ubicacion='team')
  pc_box_nombre    VARCHAR(64),                 -- nombre de la caja de PC (NULL si ubicacion='team')

  especie          VARCHAR(64),
  mote             VARCHAR(64),
  nivel            INTEGER,
  shiny            BOOLEAN DEFAULT FALSE,
  pokeball         VARCHAR(64),
  objeto           VARCHAR(64),
  habilidad        VARCHAR(64),
  ps               INTEGER,
  ps_max           INTEGER,
  ataque           INTEGER,
  defensa          INTEGER,
  sp_ataque        INTEGER,
  sp_defensa       INTEGER,
  velocidad        INTEGER,
  iv_hp            INTEGER,
  iv_ataque        INTEGER,
  iv_defensa       INTEGER,
  iv_sp_ataque     INTEGER,
  iv_sp_defensa    INTEGER,
  iv_velocidad     INTEGER,
  ev_hp            INTEGER DEFAULT 0,
  ev_ataque        INTEGER DEFAULT 0,
  ev_defensa       INTEGER DEFAULT 0,
  ev_sp_ataque     INTEGER DEFAULT 0,
  ev_sp_defensa    INTEGER DEFAULT 0,
  ev_velocidad     INTEGER DEFAULT 0,
  naturaleza       VARCHAR(32),
  felicidad        INTEGER DEFAULT 255,
  movimiento_1     VARCHAR(64),
  movimiento_2     VARCHAR(64),
  movimiento_3     VARCHAR(64),
  movimiento_4     VARCHAR(64),

  -- Marcas de las cartas
  dead             BOOLEAN DEFAULT FALSE,  -- marcado como muerto
  stolen           BOOLEAN DEFAULT FALSE,  -- marcado como robado
  stolen_by        VARCHAR(255),           -- quién lo robó
  stolen_at        TIMESTAMP,              -- cuándo se robó
  blindado         BOOLEAN DEFAULT FALSE   -- marcado como blindado
);
CREATE INDEX IF NOT EXISTS idx_pokemon_participante ON pokemon(participante_id);

-- Si ya tenías la tabla creada de antes (v1), esto añade las columnas nuevas sin borrar nada:
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS ubicacion     VARCHAR(10) DEFAULT 'team';
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS pc_box_index  INTEGER;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS pc_box_nombre VARCHAR(64);
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS dead          BOOLEAN DEFAULT FALSE;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen        BOOLEAN DEFAULT FALSE;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen_by     VARCHAR(255);
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen_at     TIMESTAMP;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS blindado      BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS cartas (
  id               SERIAL PRIMARY KEY,
  participante_id  INTEGER NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,
  carta_id         VARCHAR(64),
  nombre           VARCHAR(128),
  tipo             VARCHAR(64),
  rareza           VARCHAR(32),
  imagen_url       TEXT,
  creado_en        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cartas_participante ON cartas(participante_id);

CREATE TABLE IF NOT EXISTS torneo (
  id      INTEGER PRIMARY KEY DEFAULT 1,
  titulo  VARCHAR(255),
  nota    TEXT,
  fase    VARCHAR(64)
);
-- Fila única con id=1 (la app hace UPDATE ... WHERE id=1)
INSERT INTO torneo (id, titulo, nota, fase)
VALUES (1, 'Deadsafio 3', NULL, 'en_curso')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS anuncios (
  id         SERIAL PRIMARY KEY,
  emoji      VARCHAR(16) DEFAULT '📢',
  mensaje    TEXT NOT NULL,
  creado_en  TIMESTAMP DEFAULT NOW()
);
