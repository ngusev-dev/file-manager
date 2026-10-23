import argon2 from "argon2";

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
