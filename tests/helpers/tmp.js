import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { FileManager } from "../../src/modules/fileManager.js";

export async function makeSandbox(t, { maxFileSize = 1024 * 1024 } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fm-test-"));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const outside = path.join(base, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "secret.txt"), "top secret");
  const fm = await FileManager.open(path.join(base, "sandbox"), { maxFileSize });
  return { base, outside, fm };
}
