import { config } from "../config.js";
import { AppError } from "../errors.js";
import * as repo from "../db/repository.js";
import { hashPassword, verifyPassword } from "./password.js";

const USERNAME = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const INVALID_CREDENTIALS = "Неверный логин или пароль";

export function validateUsername(username) {
  if (!USERNAME.test(username)) {
    return "Логин: 3–32 символа, латинские буквы, цифры и _";
  }
  return true;
}

export function validatePassword(password) {
  if (password.length < MIN_PASSWORD) return `Пароль должен быть не короче ${MIN_PASSWORD} символов`;
  if (password.length > MAX_PASSWORD) return `Пароль должен быть не длиннее ${MAX_PASSWORD} символов`;
  if (!/[a-zA-Zа-яА-Я]/.test(password) || !/\d/.test(password))
    return "Пароль должен содержать буквы и цифры";
  return true;
}

export async function register(username, password) {
  for (const check of [validateUsername(username), validatePassword(password)]) {
    if (check !== true) throw new AppError(check);
  }
  const hash = await hashPassword(password);
  try {
    const id = await repo.registerUser(username, hash);
    return { id, username };
  } catch (err) {
    if (err.code === "23505") throw new AppError("Пользователь с таким логином уже существует");
    throw err;
  }
}

export async function login(username, password) {
  if (validateUsername(username) !== true || password.length > MAX_PASSWORD) {
    throw new AppError(INVALID_CREDENTIALS);
  }

  const user = await repo.getUserAuth(username);
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(
      "Учётная запись временно заблокирована из-за неудачных попыток входа. Повторите позже.",
    );
  }

  const ok = user && (await verifyPassword(password, user.password_hash));
  if (!ok) {
    await repo.registerLoginFailure(
      user?.id ?? null,
      username,
      config.auth.maxFailedAttempts,
      config.auth.lockMinutes,
    );
    throw new AppError(INVALID_CREDENTIALS);
  }

  await repo.registerLoginSuccess(user.id);
  return { id: user.id, username };
}
