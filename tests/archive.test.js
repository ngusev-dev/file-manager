import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { SecurityError } from "../src/errors.js";
import { createZip, extractZip } from "../src/modules/archive.js";
import { makeSandbox } from "./helpers/tmp.js";
import { buildRawZip } from "./helpers/rawZip.js";

const limits = { maxEntries: 100, maxTotalSize: 1024 * 1024, maxRatio: 100 };

async function exists(p) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

test("ZIP: создание и распаковка", async (t) => {
  const { fm } = await makeSandbox(t);
  await fs.mkdir(path.join(fm.root, "docs"));
  await fm.create("docs/a.txt", "A");
  await fm.create("b.txt", "B".repeat(1000));

  const { archive, files } = await createZip(fm, ["docs/a.txt", "b.txt"], "all.zip", limits);
  assert.equal(archive.location, "all.zip");
  assert.ok(archive.size > 0);
  assert.deepEqual(files, ["docs/a.txt", "b.txt"]);

  const result = await extractZip(fm, "all.zip", "out", limits);
  assert.equal(result.files.length, 2);
  assert.equal((await fm.readText("out/docs/a.txt")).content, "A");
  assert.equal((await fm.readText("out/b.txt")).content, "B".repeat(1000));
});

test("ZIP: каталоги и ссылки в архив не добавляются", async (t) => {
  const { fm } = await makeSandbox(t);
  await fs.mkdir(path.join(fm.root, "docs"));
  await assert.rejects(createZip(fm, ["docs"], "a.zip", limits), /только файлы/);
});

test("ZIP: создание не перезаписывает существующий архив, распаковка — существующий каталог", async (t) => {
  const { fm } = await makeSandbox(t);
  await fm.create("a.txt", "A");
  await fm.create("a.zip", "old");
  await assert.rejects(createZip(fm, ["a.txt"], "a.zip", limits), { code: "EEXIST" });
  assert.equal((await fm.readText("a.zip")).content, "old");

  await createZip(fm, ["a.txt"], "b.zip", limits);
  await fs.mkdir(path.join(fm.root, "existing"));
  await assert.rejects(extractZip(fm, "b.zip", "existing", limits), { code: "EEXIST" });
});

test("Zip Slip: запись ../evil.txt не выходит за каталог назначения", async (t) => {
  const { fm, base } = await makeSandbox(t);
  await fs.writeFile(
    path.join(fm.root, "slip.zip"),
    buildRawZip([{ name: "../../evil.txt", data: Buffer.from("pwned") }]),
  );
  await assert.rejects(extractZip(fm, "slip.zip", "out", limits), SecurityError);
  assert.equal(await exists(path.join(base, "evil.txt")), false);
  assert.equal(await exists(path.join(fm.root, "out")), false, "частично распакованный каталог удалён");
});

test("Zip Slip: абсолютный путь в архиве отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  await fs.writeFile(
    path.join(fm.root, "abs.zip"),
    buildRawZip([{ name: "/tmp/evil.txt", data: Buffer.from("x") }]),
  );
  await assert.rejects(extractZip(fm, "abs.zip", "out", limits), SecurityError);
});

test("Zip bomb: высокий коэффициент сжатия отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  const zeros = Buffer.alloc(5 * 1024 * 1024);
  await fs.writeFile(
    path.join(fm.root, "bomb.zip"),
    buildRawZip([{ name: "zeros.bin", data: zeros, deflate: true }]),
  );
  await assert.rejects(
    extractZip(fm, "bomb.zip", "out", { ...limits, maxTotalSize: 100 * 1024 * 1024 }),
    SecurityError,
  );
  assert.equal(await exists(path.join(fm.root, "out")), false);
});

test("Zip bomb: превышение суммарного размера отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  const entries = Array.from({ length: 5 }, (_, i) => ({
    name: `f${i}.bin`,
    data: Buffer.alloc(400 * 1024, i),
  }));
  await fs.writeFile(path.join(fm.root, "many.zip"), buildRawZip(entries));
  await assert.rejects(extractZip(fm, "many.zip", "out", limits), SecurityError);
  assert.equal(await exists(path.join(fm.root, "out")), false);
});

test("Zip bomb: заголовок с заниженным размером не обманывает проверку", async (t) => {
  const { fm } = await makeSandbox(t);
  const data = Buffer.alloc(2 * 1024 * 1024, 1);
  await fs.writeFile(
    path.join(fm.root, "liar.zip"),
    buildRawZip([{ name: "liar.bin", data, deflate: true, declaredSize: 10 }]),
  );
  await assert.rejects(extractZip(fm, "liar.zip", "out", { ...limits, maxRatio: 1_000_000 }));
  assert.equal(await exists(path.join(fm.root, "out")), false);
});

test("Zip bomb: слишком много записей отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  const entries = Array.from({ length: 101 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from("x") }));
  await fs.writeFile(path.join(fm.root, "flood.zip"), buildRawZip(entries));
  await assert.rejects(extractZip(fm, "flood.zip", "out", limits), SecurityError);
});

test("ZIP: символическая ссылка внутри архива отклоняется", async (t) => {
  const { fm } = await makeSandbox(t);
  await fs.writeFile(
    path.join(fm.root, "link.zip"),
    buildRawZip([{ name: "link", data: Buffer.from("/etc/passwd"), mode: 0o120777 }]),
  );
  await assert.rejects(extractZip(fm, "link.zip", "out", limits), SecurityError);
});
