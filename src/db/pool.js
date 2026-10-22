import pg from "pg";
import { config, dbPassword } from "../config.js";

let pool;

// Приложение подключается под ролью с минимальными правами (только EXECUTE на функции).
export function getPool() {
  pool ??= new pg.Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.appUser,
    password: dbPassword("app"),
    max: 5,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = undefined;
}
