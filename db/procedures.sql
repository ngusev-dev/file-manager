-- Хранимые функции — единственный интерфейс приложения к данным.
-- SECURITY DEFINER: функции выполняются с правами владельца (администратора БД),
-- а у роли приложения нет прямого доступа к таблицам — только EXECUTE (см. roles.sql).
-- SET search_path защищает SECURITY DEFINER-функции от подмены объектов через search_path.

CREATE OR REPLACE FUNCTION register_user(p_username TEXT, p_password_hash TEXT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_id INT;
BEGIN
    INSERT INTO users (username, password_hash)
    VALUES (p_username, p_password_hash)
    RETURNING id INTO v_id;

    INSERT INTO operations (operation_type, user_id) VALUES ('register', v_id);
    RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION get_user_auth(p_username TEXT)
RETURNS TABLE (id INT, password_hash TEXT, locked_until TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT u.id, u.password_hash, u.locked_until
    FROM users u
    WHERE u.username = p_username;
$$;

-- Счётчик неудачных попыток увеличивается одним UPDATE: параллельные попытки входа
-- не могут «потерять» инкремент (нет гонки read-modify-write в приложении).
CREATE OR REPLACE FUNCTION register_login_failure(
    p_user_id INT, p_username TEXT, p_max_attempts INT, p_lock_minutes INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_user_id IS NOT NULL THEN
        UPDATE users
        SET failed_attempts = CASE WHEN failed_attempts + 1 >= p_max_attempts THEN 0
                                   ELSE failed_attempts + 1 END,
            locked_until    = CASE WHEN failed_attempts + 1 >= p_max_attempts
                                   THEN now() + make_interval(mins => p_lock_minutes)
                                   ELSE locked_until END
        WHERE id = p_user_id;
    END IF;

    INSERT INTO operations (operation_type, user_id, details)
    VALUES ('login_failed', p_user_id, jsonb_build_object('username', p_username));
END
$$;

CREATE OR REPLACE FUNCTION register_login_success(p_user_id INT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = p_user_id;
    INSERT INTO operations (operation_type, user_id) VALUES ('login', p_user_id);
END
$$;

-- Фиксирует операцию над файлом: обновляет таблицу files и пишет запись в журнал.
-- Вызов функции выполняется атомарно (одна транзакция), поэтому состояние files
-- и журнал operations не могут разойтись.
CREATE OR REPLACE FUNCTION record_file_operation(
    p_user_id   INT,
    p_type      operation_type,
    p_location  TEXT,
    p_filename  TEXT,
    p_size      BIGINT,
    p_details   JSONB
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_file_id INT;
BEGIN
    IF p_type = 'delete' THEN
        UPDATE files
        SET is_deleted = true, updated_at = now()
        WHERE owner_id = p_user_id AND location = p_location AND NOT is_deleted
        RETURNING id INTO v_file_id;
    ELSIF p_type IN ('create', 'modify', 'archive', 'extract') THEN
        INSERT INTO files (filename, size, location, owner_id)
        VALUES (p_filename, p_size, p_location, p_user_id)
        ON CONFLICT (owner_id, location) DO UPDATE
        SET filename   = EXCLUDED.filename,
            size       = EXCLUDED.size,
            updated_at = now(),
            created_at = CASE WHEN files.is_deleted THEN now() ELSE files.created_at END,
            is_deleted = false
        RETURNING id INTO v_file_id;
    ELSE
        SELECT id INTO v_file_id
        FROM files
        WHERE owner_id = p_user_id AND location = p_location AND NOT is_deleted;
    END IF;

    INSERT INTO operations (operation_type, file_id, user_id, details)
    VALUES (p_type, v_file_id, p_user_id, p_details);

    RETURN v_file_id;
END
$$;

CREATE OR REPLACE FUNCTION get_user_files(p_user_id INT)
RETURNS TABLE (id INT, filename VARCHAR, location VARCHAR, size BIGINT,
               created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT f.id, f.filename, f.location, f.size, f.created_at, f.updated_at
    FROM files f
    WHERE f.owner_id = p_user_id AND NOT f.is_deleted
    ORDER BY f.location;
$$;

CREATE OR REPLACE FUNCTION get_user_operations(p_user_id INT, p_limit INT)
RETURNS TABLE (ts TIMESTAMPTZ, operation_type operation_type, location VARCHAR, details JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT o.timestamp, o.operation_type, f.location, o.details
    FROM operations o
    LEFT JOIN files f ON f.id = o.file_id
    WHERE o.user_id = p_user_id
    ORDER BY o.timestamp DESC, o.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;
