import argon2 from "argon2";
import { randomBytes } from "node:crypto";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password) {
  return argon2.hash(password.normalize("NFKC"), OPTIONS);
}

export async function verifyPassword(password, stored) {
  try {
    return await argon2.verify(stored, password.normalize("NFKC"));
  } catch {
    return false;
  }
}

// Хеш случайного пароля для выравнивания времени ответа, когда пользователь не найден:
// иначе по скорости отказа можно было бы перебором выяснять существующие логины.
let dummyHash;
export async function getDummyHash() {
  dummyHash ??= await hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}
