import { getPool } from "./pool.js";


async function query(name, text, values) {
  const { rows } = await getPool().query({ name, text, values });
  return rows;
}

export async function registerUser(username, passwordHash) {
  const rows = await query("register_user", "SELECT register_user($1, $2) AS id", [username, passwordHash]);
  return rows[0].id;
}

export async function getUserAuth(username) {
  const rows = await query("get_user_auth", "SELECT * FROM get_user_auth($1)", [username]);
  return rows[0] ?? null;
}

export async function registerLoginFailure(userId, username, maxAttempts, lockMinutes) {
  await query("register_login_failure", "SELECT register_login_failure($1, $2, $3, $4)", [
    userId,
    username,
    maxAttempts,
    lockMinutes,
  ]);
}

export async function registerLoginSuccess(userId) {
  await query("register_login_success", "SELECT register_login_success($1)", [userId]);
}

export async function recordFileOperation(userId, type, { location, filename, size = null }, details = null) {
  const rows = await query(
    "record_file_operation",
    "SELECT record_file_operation($1, $2, $3, $4, $5, $6) AS file_id",
    [userId, type, location, filename, size, details === null ? null : JSON.stringify(details)],
  );
  return rows[0].file_id;
}

export async function getUserFiles(userId) {
  return query("get_user_files", "SELECT * FROM get_user_files($1)", [userId]);
}

export async function getUserOperations(userId, limit) {
  return query("get_user_operations", "SELECT * FROM get_user_operations($1, $2)", [userId, limit]);
}
