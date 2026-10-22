import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { SecurityError, AppError } from "../src/errors.js";
import { makeSandbox } from "./helpers/tmp.js";

test("path traversal: выход через ../ отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  for (const evil of [
    "../outside/secret.txt",
    "..\\outside\\secret.txt",
    "a/../../outside/secret.txt",
    "..",
  ]) {
    await assert.rejects(fm.readText(evil), SecurityError, evil);
  }
});

test("path traversal: абсолютные пути, NUL-байт и имена устройств отклоняются", async (t) => {
  const { fm, outside } = await makeSandbox(t);
  const evil = [
    path.join(outside, "secret.txt"),
    "C:\\Windows\\win.ini",
    "/etc/passwd",
    "a\0.txt",
    "CON",
    "nul.txt",
    "x/aux",
  ];
  for (const p of evil) {
    await assert.rejects(fm.readText(p), SecurityError, JSON.stringify(p));
  }
});

test("path traversal: символическая ссылка (junction) наружу отклоняется", async (t) => {
  const { fm, outside } = await makeSandbox(t);
  try {
    await fs.symlink(outside, path.join(fm.root, "link"), "junction");
  } catch {
    t.skip("нет прав на создание ссылок");
    return;
  }
  await assert.rejects(fm.readText("link/secret.txt"), SecurityError);
  await assert.rejects(fm.create("link/new.txt", "x"), SecurityError);
});

test("CRUD: создание, чтение, перезапись, удаление, список", async (t) => {
  const { fm } = await makeSandbox(t);
  const created = await fm.create("a.txt", "hello");
  assert.deepEqual(created, { location: "a.txt", filename: "a.txt", size: 5 });
  assert.equal((await fm.readText("a.txt")).content, "hello");

  await fm.overwrite("a.txt", "new");
  assert.equal((await fm.readText("a.txt")).content, "new");

  await fs.mkdir(path.join(fm.root, "dir"));
  await fm.create("b.txt", "b");
  await fm.remove("b.txt");
  await assert.rejects(fm.readText("b.txt"), { code: "ENOENT" });

  const names = (await fm.list(".")).map((e) => e.name);
  assert.deepEqual(names, ["dir", "a.txt"], "сначала каталоги, потом файлы");
  await fm.remove("dir");
});

test("create не перезаписывает существующий файл", async (t) => {
  const { fm } = await makeSandbox(t);
  await fm.create("a.txt", "1");
  await assert.rejects(fm.create("a.txt", "x"), { code: "EEXIST" });
  assert.equal((await fm.readText("a.txt")).content, "1");
});

test("race condition: 20 параллельных create одного файла — ровно один успех", async (t) => {
  const { fm } = await makeSandbox(t);
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => fm.create("race.txt", `writer ${i}`)),
  );
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  assert.equal(fulfilled.length, 1);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "EEXIST"));
  assert.equal((await fm.readText("race.txt")).content, `writer ${results.indexOf(fulfilled[0])}`);
});

test("race condition: параллельная перезапись не оставляет «смешанное» содержимое", async (t) => {
  const { fm } = await makeSandbox(t);
  await fm.create("data.txt", "");
  const payloads = Array.from({ length: 10 }, (_, i) => String(i).repeat(50_000));
  await Promise.allSettled(payloads.map((p) => fm.overwrite("data.txt", p)));
  const { content } = await fm.readText("data.txt");
  assert.ok(payloads.includes(content), "файл должен содержать ровно одну из записей целиком");
  const leftovers = (await fm.list(".")).filter((e) => e.name.endsWith(".tmp"));
  assert.equal(leftovers.length, 0);
});

test("лимит размера при записи и чтении", async (t) => {
  const { fm } = await makeSandbox(t, { maxFileSize: 100 });
  await assert.rejects(fm.create("big.txt", "x".repeat(101)), AppError);
  await assert.rejects(fm.overwrite("big.txt", "x".repeat(101)), AppError);
  await fs.writeFile(path.join(fm.root, "external.txt"), "z".repeat(500));
  await assert.rejects(fm.readText("external.txt"), AppError);
});
