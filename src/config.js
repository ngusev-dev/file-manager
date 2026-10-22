import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

function str(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  }
  return value;
}

function positiveInt(name, fallback) {
  const raw = process.env[name] ?? String(fallback);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Переменная ${name} должна быть положительным целым числом, получено: ${raw}`);
  }
  return value;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function roleName(name, fallback) {
  const value = str(name, fallback);
  if (!ROLE_NAME.test(value)) throw new Error(`Недопустимое имя роли БД в ${name}`);
  return value;
}

export const config = Object.freeze({
  projectRoot,
  db: Object.freeze({
    host: str("PGHOST", "127.0.0.1"),
    port: positiveInt("PGPORT", 5432),
    database: str("PGDATABASE", "file_manager"),
    adminUser: roleName("DB_ADMIN_USER", "fm_admin"),
    appUser: roleName("DB_APP_USER", "fm_app"),
  }),
  sandboxDir: path.resolve(projectRoot, str("SANDBOX_DIR", "./sandbox")),
  maxFileSize: positiveInt("MAX_FILE_SIZE", 10 * 1024 * 1024),
  zip: Object.freeze({
    maxEntries: positiveInt("ZIP_MAX_ENTRIES", 1000),
    maxTotalSize: positiveInt("ZIP_MAX_TOTAL_SIZE", 100 * 1024 * 1024),
    maxRatio: positiveInt("ZIP_MAX_RATIO", 100),
  }),
  auth: Object.freeze({
    maxFailedAttempts: positiveInt("AUTH_MAX_FAILED_ATTEMPTS", 5),
    lockMinutes: positiveInt("AUTH_LOCK_MINUTES", 15),
  }),
});

export function dbPassword(kind) {
  return kind === "admin" ? str("DB_ADMIN_PASSWORD") : str("DB_APP_PASSWORD");
}
