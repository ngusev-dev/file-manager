import path from "node:path";
import fs from "node:fs/promises";
import { SecurityError } from "../errors.js";

function assertInside(root, candidate, { allowRoot }) {
  const rel = path.relative(root, candidate);
  if (rel === "") {
    if (allowRoot) return;
    throw new SecurityError("Нельзя выполнить операцию над корнем рабочего каталога");
  }
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new SecurityError("Доступ за пределы рабочего каталога запрещён");
  }
}

// realpath для пути, хвост которого может ещё не существовать (например, создаваемый файл):
// разрешаем ближайшего существующего предка и дописываем к нему оставшиеся сегменты.
async function realpathLoose(p) {
  try {
    return await fs.realpath(p);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    const parent = path.dirname(p);
    if (parent === p) throw err;
    return path.join(await realpathLoose(parent), path.basename(p));
  }
}

/**
 * Проверяет пользовательский путь и возвращает абсолютный путь внутри root.
 */
export async function resolveInside(root, userPath, { allowRoot = false } = {}) {
  if (typeof userPath !== "string" || userPath.trim() === "") {
    throw new SecurityError("Путь не указан");
  }
  if (userPath.includes("\0")) throw new SecurityError("Недопустимый символ в пути");
  if (path.isAbsolute(userPath) || path.win32.isAbsolute(userPath) || /^[a-zA-Z]:/.test(userPath)) {
    throw new SecurityError("Абсолютные пути запрещены, укажите путь относительно рабочего каталога");
  }

  const rootReal = await fs.realpath(root);
  const lexical = path.resolve(rootReal, userPath);
  assertInside(rootReal, lexical, { allowRoot });

  const real = await realpathLoose(lexical);
  assertInside(rootReal, real, { allowRoot });
  return real;
}

// Путь для хранения в БД и показа пользователю: относительный, с прямыми слешами.
export function toLocation(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join("/");
}
