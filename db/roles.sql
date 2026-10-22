-- Принцип наименьших привилегий: роль приложения (:app_role подставляет scripts/db-init.js
-- через escapeIdentifier) не имеет прямого доступа к таблицам и может только вызывать функции.
-- Даже при компрометации приложения нельзя выполнить DROP/DELETE/SELECT * FROM users.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :app_role;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM :app_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM :app_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    register_user(TEXT, TEXT),
    get_user_auth(TEXT),
    register_login_failure(INT, TEXT, INT, INT),
    register_login_success(INT),
    record_file_operation(INT, operation_type, TEXT, TEXT, BIGINT, JSONB),
    get_user_files(INT),
    get_user_operations(INT, INT)
TO :app_role;
