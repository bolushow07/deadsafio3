-- ═══════════════════════════════════════════════════════════
-- DEADSAFIO 3 — Esquema Postgres (Neon)
-- Ejecuta este archivo en tu base de datos de Neon (SQL Editor
-- del dashboard, o con: psql "$DATABASE_URL" -f schema.sql)
--
-- Usa siempre CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
-- EXISTS, así que puedes volver a ejecutarlo entero sin miedo a
-- perder nada de lo que ya tuvieras.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS participantes (
  id            SERIAL PRIMARY KEY,
  nombre        VARCHAR(255) NOT NULL,
  emoji         VARCHAR(16)  DEFAULT '💀',
  estado        VARCHAR(32)  DEFAULT 'activo',
  num           INTEGER,
  badges        INTEGER DEFAULT 0,      -- medallas
  death_count   INTEGER DEFAULT 0,      -- contador persistente de muertes (revivir NO lo resta)
  royal_shield  BOOLEAN DEFAULT FALSE,  -- (histórico, ya no se usa activamente)
  creado_en     TIMESTAMP DEFAULT NOW()
);
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
  forma            INTEGER DEFAULT 0,      -- forma regional (Alola/Galar/Paldea/Hisui): @form del save
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

ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS ubicacion     VARCHAR(10) DEFAULT 'team';
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS pc_box_index  INTEGER;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS pc_box_nombre VARCHAR(64);
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS dead          BOOLEAN DEFAULT FALSE;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen        BOOLEAN DEFAULT FALSE;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen_by     VARCHAR(255);
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS stolen_at     TIMESTAMP;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS blindado      BOOLEAN DEFAULT FALSE;
ALTER TABLE pokemon ADD COLUMN IF NOT EXISTS forma         INTEGER DEFAULT 0;

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
INSERT INTO torneo (id, titulo, nota, fase)
VALUES (1, 'Deadsafio 3', NULL, 'en_curso')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS anuncios (
  id         SERIAL PRIMARY KEY,
  emoji      VARCHAR(16) DEFAULT '📢',
  mensaje    TEXT NOT NULL,
  creado_en  TIMESTAMP DEFAULT NOW()
);

-- Historial de ataques recibidos por participante (Robas un Pokémon,
-- Matas un Pokémon, Profanatumbas, Combate Pokémon), para poder
-- revertirlos con Escudo real / Reviertefectos. Incluye también los
-- CONTRAATAQUES: cuando alguien te revierte un ataque, se registra un
-- nuevo ataque contra quien te lo hizo originalmente, para que pueda
-- revertirlo de vuelta.
CREATE TABLE IF NOT EXISTS ataques_recibidos (
  id               SERIAL PRIMARY KEY,
  client_id        VARCHAR(64),            -- id generado en el navegador (para que el frontend lo referencie)
  participante_id  INTEGER NOT NULL REFERENCES participantes(id) ON DELETE CASCADE,
  carta            VARCHAR(64),            -- 'Robas un Pokémon' | 'Matas un Pokémon' | 'Profanatumbas' | 'Combate Pokémon' | 'Escudo real' | 'Reviertefectos'
  atacante         VARCHAR(255),           -- usuario que causó este registro
  pokemon_nombre   VARCHAR(64),
  efecto           VARCHAR(16),            -- 'stolen' | 'dead' | NULL
  apply_efecto     BOOLEAN DEFAULT FALSE,  -- true = revertir esto APLICA el efecto (contraataque); false = lo QUITA (ataque normal)
  owner_nombre     VARCHAR(255),           -- dueño real del Pokémon afectado (puede diferir del participante que recibe este registro, en los contraataques)
  ubicacion        VARCHAR(10),            -- 'team' | 'pc' | 'box'
  pc_box_index     INTEGER,
  pokemon_index    INTEGER,
  revertido        BOOLEAN DEFAULT FALSE,
  creado_en        TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ataques_participante ON ataques_recibidos(participante_id);

ALTER TABLE ataques_recibidos ADD COLUMN IF NOT EXISTS apply_efecto BOOLEAN DEFAULT FALSE;
ALTER TABLE ataques_recibidos ADD COLUMN IF NOT EXISTS owner_nombre VARCHAR(255);

-- Colección de cartas de CADA CUENTA (usuario de login), no del navegador.
-- Antes vivía solo en localStorage bajo una única clave compartida.
CREATE TABLE IF NOT EXISTS colecciones (
  id        SERIAL PRIMARY KEY,
  usuario   VARCHAR(255) NOT NULL,
  carta     VARCHAR(128) NOT NULL,
  cantidad  INTEGER DEFAULT 0,
  UNIQUE (usuario, carta)
);
CREATE INDEX IF NOT EXISTS idx_colecciones_usuario ON colecciones(usuario);

-- Contraseñas de sobre ya canjeadas, para que sean de un solo uso de
-- verdad (antes cada navegador llevaba su propia lista local, así que
-- una misma contraseña se podía reutilizar desde otro dispositivo).
-- Contraseñas de sobre canjeadas POR CUENTA: cada cuenta puede usar cada
-- contraseña una vez, aunque otra cuenta ya la haya usado (antes era de
-- un solo uso GLOBAL entre todas las cuentas, lo cual generaba el falso
-- positivo de "esa contraseña ya ha sido usada" para cuentas que nunca
-- la habían probado).
CREATE TABLE IF NOT EXISTS sobres_usados (
  id         SERIAL PRIMARY KEY,
  codigo     VARCHAR(64) NOT NULL,
  usado_por  VARCHAR(255) NOT NULL,
  usado_en   TIMESTAMP DEFAULT NOW(),
  UNIQUE (codigo, usado_por)
);

-- Si la tabla ya existía con la restricción antigua (codigo UNIQUE a
-- secas), la sustituimos por la nueva (codigo, usado_por).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sobres_usados_codigo_key'
  ) THEN
    ALTER TABLE sobres_usados DROP CONSTRAINT sobres_usados_codigo_key;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sobres_usados_codigo_usado_por_key'
  ) THEN
    ALTER TABLE sobres_usados ADD CONSTRAINT sobres_usados_codigo_usado_por_key UNIQUE (codigo, usado_por);
  END IF;
END $$;
