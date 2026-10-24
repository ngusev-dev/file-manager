import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import yazl from "yazl";
import { AppError, SecurityError } from "../errors.js";
import { resolveInside } from "../security/safePath.js";

/**
 * Создаёт ZIP из перечисленных файлов песочницы.
 */
export async function createZip(fm, sourcePaths, zipPath, { maxEntries, maxTotalSize }) {
  const target = await fm.resolve(zipPath);
  if (path.extname(target).toLowerCase() !== ".zip") {
    throw new AppError("Имя архива должно оканчиваться на .zip");
  }
  if (sourcePaths.length > maxEntries) throw new AppError(`Слишком много файлов (лимит ${maxEntries})`);

  const zip = new yazl.ZipFile();
  const files = [];
  let total = 0;
  for (const source of sourcePaths) {
    const abs = await fm.resolve(source);
    const stat = await fs.lstat(abs);
    if (!stat.isFile()) throw new AppError(`Архивировать можно только файлы: ${source}`);
    total += stat.size;
    files.push(fm.location(abs));
    zip.addFile(abs, fm.location(abs));
  }
  if (total > maxTotalSize) throw new AppError(`Суммарный размер превышает лимит ${maxTotalSize} байт`);
  zip.end();

  try {
    await pipeline(zip.outputStream, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } catch (err) {
    if (err.code !== "EEXIST") await fs.rm(target, { force: true });
    throw err;
  }
  const { size } = await fs.stat(target);
  return { archive: { location: fm.location(target), filename: path.basename(target), size }, files };
}

/**
 * Распаковка с защитой от:
 *  - Zip Slip: имя каждой записи проверяется resolveInside относительно каталога назначения;
 *  - zip bomb: лимит числа записей и суммарного размера (считается по фактически распакованным байтам).
 */
export async function extractZip(fm, zipPath, destPath, { maxEntries, maxTotalSize }) {
  const zipAbs = await fm.resolve(zipPath);
  const destAbs = await fm.resolve(destPath);
  await fs.mkdir(destAbs, { mode: 0o700 });

  const extracted = [];
  let zipfile;
  try {
    zipfile = await yauzl.openPromise(zipAbs, { strictFileNames: true, validateEntrySizes: true });
    if (zipfile.entryCount > maxEntries) {
      throw new SecurityError(`В архиве слишком много записей: ${zipfile.entryCount} (лимит ${maxEntries})`);
    }

    let totalWritten = 0;
    for await (const entry of zipfile.eachEntry()) {
      const outPath = await resolveInside(destAbs, entry.fileName);
      if (entry.fileName.endsWith("/")) {
        await fs.mkdir(outPath, { recursive: true, mode: 0o700 });
        continue;
      }
      let entryWritten = 0;
      const limiter = new Transform({
        transform(chunk, _enc, cb) {
          entryWritten += chunk.length;
          totalWritten += chunk.length;
          if (totalWritten > maxTotalSize) {
            cb(new SecurityError(`Распакованный размер превысил лимит ${maxTotalSize} байт`));
          } else {
            cb(null, chunk);
          }
        },
      });
      await fs.mkdir(path.dirname(outPath), { recursive: true, mode: 0o700 });
      const readStream = await zipfile.openReadStreamPromise(entry);
      await pipeline(readStream, limiter, createWriteStream(outPath, { flags: "wx", mode: 0o600 }));
      extracted.push({
        location: fm.location(outPath),
        filename: path.basename(outPath),
        size: entryWritten,
      });
    }
  } catch (err) {
    zipfile?.close();
    await fs.rm(destAbs, { recursive: true, force: true });
    if (err instanceof AppError || err.code) throw err;
    throw new SecurityError(`Архив отклонён: ${err.message}`);
  }
  return { destination: fm.location(destAbs), files: extracted };
}
