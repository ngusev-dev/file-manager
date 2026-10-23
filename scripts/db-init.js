// Инициализация БД: схема, хранимые функции, роль приложения с минимальными правами.
// Выполняется под администратором БД; приложение затем работает под ролью DB_APP_USER.
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config, dbPassword } from "../src/config.js";

const sqlFile = (name) => fs.readFile(path.join(config.projectRoot, "db", name), "utf8");

const client = new pg.Client({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.adminUser,
  password: dbPassword("admin"),
});

await client.connect();
try {
  await client.query("BEGIN");
  await client.query(await sqlFile("schema.sql"));
  await client.query(await sqlFile("procedures.sql"));

  const role = client.escapeIdentifier(config.db.appUser);
  const secret = client.escapeLiteral(dbPassword("app"));
  const { rowCount } = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [config.db.appUser]);
  await client.query(`${rowCount ? "ALTER" : "CREATE"} ROLE ${role} LOGIN PASSWORD ${secret}`);
  await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(config.db.database)} TO ${role}`);
  await client.query((await sqlFile("roles.sql")).replaceAll(":app_role", role));

  await client.query("COMMIT");
  console.log(`База данных «${config.db.database}» готова, роль приложения: ${config.db.appUser}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Ошибка инициализации БД:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
