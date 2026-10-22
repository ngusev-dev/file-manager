-- Схема БД файлового менеджера. Скрипт идемпотентен: повторный запуск не теряет данные.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_type') THEN
        CREATE TYPE operation_type AS ENUM (
            'register', 'login', 'login_failed',
            'create', 'read', 'modify', 'delete',
            'archive', 'extract'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50)  NOT NULL UNIQUE,
    password_hash   TEXT         NOT NULL,
    failed_attempts INT          NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
    id          SERIAL PRIMARY KEY,
    filename    VARCHAR(255)  NOT NULL,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    size        BIGINT        CHECK (size >= 0),
    location    VARCHAR(1024) NOT NULL,          -- путь относительно песочницы пользователя
    is_deleted  BOOLEAN       NOT NULL DEFAULT false,
    owner_id    INT           NOT NULL REFERENCES users(id),
    UNIQUE (owner_id, location)
);

CREATE TABLE IF NOT EXISTS operations (
    id             SERIAL PRIMARY KEY,
    timestamp      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    operation_type operation_type NOT NULL,
    file_id        INT REFERENCES files(id),
    user_id        INT REFERENCES users(id),  -- NULL для неудачного входа под несуществующим логином
    details        JSONB
);

CREATE INDEX IF NOT EXISTS operations_user_ts_idx ON operations (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS operations_file_idx    ON operations (file_id);
