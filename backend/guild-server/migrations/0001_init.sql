-- Схема «Гильдии». Выполняется с уже установленным search_path
-- (см. app/migrate.py), поэтому имена таблиц идут без префикса схемы.

CREATE TABLE IF NOT EXISTS classes (
    id              SERIAL PRIMARY KEY,
    school_code     TEXT NOT NULL,
    class_name      TEXT NOT NULL,
    nickname_style  TEXT NOT NULL DEFAULT 'totem'
                    CHECK (nickname_style IN ('totem', 'element', 'craft')),
    class_target    INTEGER NOT NULL DEFAULT 100 CHECK (class_target > 0),
    tree_adjust     INTEGER NOT NULL DEFAULT 0,   -- накопленные дебаффы, п.п.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_code, class_name)
);

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    login           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,                -- bcrypt
    role            TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
    totp_secret     TEXT,                         -- 2FA, только для учителя
    totp_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS heroes (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    nickname        TEXT NOT NULL,
    branch          TEXT NOT NULL CHECK (branch IN ('tactics', 'diplomacy', 'keeper')),
    avatar          TEXT NOT NULL DEFAULT '',
    souls           INTEGER NOT NULL DEFAULT 0,
    branch_points   INTEGER NOT NULL DEFAULT 0,
    armor           INTEGER NOT NULL DEFAULT 10,
    hand_raises     INTEGER NOT NULL DEFAULT 0,
    weakness_until  TIMESTAMPTZ,
    debuff_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, nickname)
);

-- Реестр: единственное место, где кличка связана с человеком.
-- real_name_enc — Fernet-шифротекст, ключ живёт только в окружении сервера.
CREATE TABLE IF NOT EXISTS registry (
    hero_id         INTEGER PRIMARY KEY REFERENCES heroes(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    real_name_enc   BYTEA NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token           TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS souls_log (
    id              BIGSERIAL PRIMARY KEY,
    hero_id         INTEGER NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    delta           INTEGER NOT NULL,
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS souls_log_hero_idx ON souls_log(hero_id, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance (
    id              BIGSERIAL PRIMARY KEY,
    hero_id         INTEGER NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    day             DATE NOT NULL,
    lesson          SMALLINT NOT NULL DEFAULT 1,
    status          TEXT NOT NULL CHECK (status IN ('present', 'absent', 'excused')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hero_id, day, lesson)
);
CREATE INDEX IF NOT EXISTS attendance_day_idx ON attendance(class_id, day);

-- Итог ночного пересчёта: по одной строке на героя в день, чтобы
-- повторный запуск задачи не начислял Броню дважды.
CREATE TABLE IF NOT EXISTS armor_log (
    id              BIGSERIAL PRIMARY KEY,
    hero_id         INTEGER NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    day             DATE NOT NULL,
    absences        SMALLINT NOT NULL,
    armor_delta     SMALLINT NOT NULL,
    tree_delta      SMALLINT NOT NULL,
    weakness        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (hero_id, day)
);

-- Тихая почта: 3 стикера. Текста нет — только сигнал учителю.
CREATE TABLE IF NOT EXISTS quiet_mail (
    id              BIGSERIAL PRIMARY KEY,
    hero_id         INTEGER NOT NULL REFERENCES heroes(id) ON DELETE CASCADE,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    sticker         TEXT NOT NULL CHECK (sticker IN ('angry', 'scared', 'change')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS debuffs (
    id              BIGSERIAL PRIMARY KEY,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    hero_id         INTEGER REFERENCES heroes(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('mat', 'absence', 'whistle')),
    tree_delta      SMALLINT NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,
    source          TEXT NOT NULL DEFAULT 'manual',  -- manual | auto
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS festivals (
    id              SERIAL PRIMARY KEY,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'finished', 'raid')),
    tree_at_start   SMALLINT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);

-- Голосования: стиль кличек и меню чаепития.
CREATE TABLE IF NOT EXISTS votes (
    id              BIGSERIAL PRIMARY KEY,
    class_id        INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL CHECK (topic IN ('nickname_style', 'tea_menu')),
    hero_id         INTEGER REFERENCES heroes(id) ON DELETE CASCADE,
    option          TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, topic, hero_id)
);

-- Журнал действий. Хранится 7 лет (§8 ТЗ), чистится вручную/по cron.
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    class_id        INTEGER REFERENCES classes(id) ON DELETE SET NULL,
    actor_user_id   INTEGER,
    actor_role      TEXT NOT NULL DEFAULT '',
    event           TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_log_class_idx ON audit_log(class_id, created_at DESC);
