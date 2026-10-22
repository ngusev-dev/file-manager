import path from "node:path";
import fs from "node:fs/promises";
import { constants as FS } from "node:fs";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { resolveInside, toLocation } from "../security/safePath.js";

// O_NOFOLLOW есть только в POSIX-системах; в Windows флаг равен undefined.
const READ_FLAGS = FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0);

/**
 * Чтение, запись и удаление файлов внутри песочницы пользователя.
 * Каждый путь проходит через resolveInside; ни одна операция не делает
 * отдельной проверки «существует ли файл» перед действием — нет окна для гонки (TOCTOU).
 */
export class FileManager {
  #root;
  #maxFileSize;

  constructor(realRoot, { maxFileSize }) {
    this.#root = realRoot;
    this.#maxFileSize = maxFileSize;
  }

  static async open(root, options) {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return new FileManager(await fs.realpath(root), options);
  }

  get root() {
    return this.#root;
  }

  get maxFileSize() {
    return this.#maxFileSize;
  }

  resolve(userPath, options) {
    return resolveInside(this.#root, userPath, options);
  }

  location(absPath) {
    return toLocation(this.#root, absPath);
  }

  #meta(absPath, size) {
    return { location: this.location(absPath), filename: path.basename(absPath), size };
  }

  #toBuffer(content) {
    const buffer = Buffer.from(content, "utf8");
    if (buffer.length > this.#maxFileSize) {
      throw new AppError(`Размер данных превышает лимит ${this.#maxFileSize} байт`);
    }
    return buffer;
  }

  async list(userPath = ".") {
    const dir = await this.resolve(userPath, { allowRoot: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      const stat = await fs.lstat(path.join(dir, entry.name)).catch(() => null);
      if (!stat) continue;
      const isDir = stat.isDirectory();
      result.push({ name: entry.name, isDir, size: isDir ? null : stat.size, modified: stat.mtime });
    }
    return result.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name));
  }

  // Размер проверяется у уже открытого дескриптора и читается ровно столько байт:
  // файл нельзя подменить или «раздуть» между проверкой размера и чтением.
  async readText(userPath) {
    const abs = await this.resolve(userPath);
    const handle = await fs.open(abs, READ_FLAGS);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new AppError("Это не обычный файл");
      if (stat.size > this.#maxFileSize) {
        throw new AppError(`Файл больше допустимого размера (${this.#maxFileSize} байт)`);
      }
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
      return { content: buffer.toString("utf8", 0, bytesRead), meta: this.#meta(abs, bytesRead) };
    } finally {
      await handle.close();
    }
  }

  // Флаг 'wx' атомарно завершается ошибкой EEXIST, если файл уже есть.
  async create(userPath, content) {
    const abs = await this.resolve(userPath);
    const buffer = this.#toBuffer(content);
    await writeExclusive(abs, buffer);
    return this.#meta(abs, buffer.length);
  }

  // Атомарная замена: пишем во временный файл рядом и переименовываем.
  // Другие процессы видят либо старое, либо новое содержимое целиком, но не половину.
  async overwrite(userPath, content) {
    const abs = await this.resolve(userPath);
    const buffer = this.#toBuffer(content);
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomUUID()}.tmp`);
    try {
      await writeExclusive(tmp, buffer);
      await fs.rename(tmp, abs);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
    return this.#meta(abs, buffer.length);
  }

  // Удаляет файл или пустой каталог; рекурсивное удаление намеренно не поддерживается.
  async remove(userPath) {
    const abs = await this.resolve(userPath);
    const stat = await fs.lstat(abs);
    if (stat.isDirectory()) {
      await fs.rmdir(abs);
      return { ...this.#meta(abs, 0), isDirectory: true };
    }
    await fs.unlink(abs);
    return this.#meta(abs, stat.size);
  }
}

async function writeExclusive(abs, buffer) {
  const handle = await fs.open(abs, "wx", 0o600);
  try {
    await handle.writeFile(buffer);
  } catch (err) {
    await handle.close();
    await fs.rm(abs, { force: true });
    throw err;
  }
  await handle.close();
}
