import * as repo from "../db/repository.js";

export async function auditFile(user, type, meta, details = null) {
  return repo.recordFileOperation(user.id, type, meta, details);
}

export async function auditFiles(user, type, metas, details = null) {
  for (const meta of metas) await auditFile(user, type, meta, details);
}

export async function getJournal(user, limit = 30) {
  return repo.getUserOperations(user.id, limit);
}

export async function getFiles(user) {
  return repo.getUserFiles(user.id);
}
