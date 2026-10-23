import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { validatePassword, validateUsername } from "../src/auth/auth.js";

test("пароль хранится как argon2id-хеш с уникальной солью", async () => {
  const a = await hashPassword("Secret123");
  const b = await hashPassword("Secret123");
  assert.match(a, /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  assert.notEqual(a, b, "одинаковые пароли дают разные хеши");
  assert.ok(!a.includes("Secret123"));
});

test("проверка пароля", async () => {
  const hash = await hashPassword("Secret123");
  assert.equal(await verifyPassword("Secret123", hash), true);
  assert.equal(await verifyPassword("secret123", hash), false);
  assert.equal(await verifyPassword("Secret123", "garbage"), false);
});

test("валидация логина и пароля", () => {
  assert.notEqual(validateUsername("admin' OR 1=1 --"), true);
  assert.equal(validateUsername("student_01"), true);
  assert.notEqual(validatePassword("short1"), true);
  assert.notEqual(validatePassword("onlyletters"), true);
  assert.equal(validatePassword("Passw0rd!"), true);
});
