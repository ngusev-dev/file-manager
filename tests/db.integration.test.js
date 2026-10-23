
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AppError } from "../src/errors.js";
import { config } from "../src/config.js";
import { getPool, closePool } from "../src/db/pool.js";
import { register, login } from "../src/auth/auth.js";
import * as repo from "../src/db/repository.js";

const dbAvailable = await getPool()
  .query("SELECT 1")
  .then(
    () => true,
    () => false,
  );
const skip = dbAvailable ? false : "PostgreSQL недоступна";
after(closePool);

const uniqueName = () => `t_${randomBytes(6).toString("hex")}`;

test("SQL-инъекция в логине не даёт войти и не ломает запрос", { skip }, async () => {
  for (const evil of ["' OR '1'='1", "admin'--", "x'; DROP TABLE users; --"]) {
    await assert.rejects(login(evil, "whatever1"), AppError);
  }

  assert.equal(await repo.getUserAuth("' OR '1'='1"), null);
  const { rows } = await getPool().query({ text: "SELECT count(*) FROM get_user_files($1)", values: [1] });
  assert.ok(rows.length === 1, "таблицы на месте");
});

test("регистрация, вход, неверный пароль, повторный логин", { skip }, async () => {
  const name = uniqueName();
  const user = await register(name, "Passw0rd1");
  assert.ok(user.id > 0);
  await assert.rejects(register(name, "Passw0rd1"), /уже существует/);
  assert.equal((await login(name, "Passw0rd1")).id, user.id);
  await assert.rejects(login(name, "WrongPass1"), /Неверный логин или пароль/);
  await assert.rejects(login(uniqueName(), "Passw0rd1"), /Неверный логин или пароль/);
});

test("блокировка после серии неудачных попыток, в т.ч. параллельных", { skip }, async () => {
  const name = uniqueName();
  await register(name, "Passw0rd1");
  const attempts = config.auth.maxFailedAttempts;
  await Promise.allSettled(Array.from({ length: attempts }, () => login(name, "WrongPass1")));
  await assert.rejects(login(name, "Passw0rd1"), /заблокирована/);
});

test("операции с файлами и журнал аудита пишутся в БД", { skip }, async () => {
  const user = await register(uniqueName(), "Passw0rd1");
  const meta = { location: "docs/a.txt", filename: "a.txt", size: 5 };
  const fileId = await repo.recordFileOperation(user.id, "create", meta);
  assert.equal(await repo.recordFileOperation(user.id, "modify", { ...meta, size: 7 }), fileId);

  let files = await repo.getUserFiles(user.id);
  assert.equal(files.length, 1);
  assert.equal(Number(files[0].size), 7);

  await repo.recordFileOperation(user.id, "delete", meta);
  files = await repo.getUserFiles(user.id);
  assert.equal(files.length, 0);

  const journal = await repo.getUserOperations(user.id, 10);
  assert.deepEqual(
    journal.map((r) => r.operation_type),
    ["delete", "modify", "create", "register"],
  );
});

test("роль приложения не имеет прямого доступа к таблицам", { skip }, async () => {
  await assert.rejects(getPool().query("SELECT * FROM users"), { code: "42501" });
  await assert.rejects(getPool().query("DELETE FROM operations"), { code: "42501" });
  await assert.rejects(getPool().query("DROP TABLE files"), { code: "42501" });
});
