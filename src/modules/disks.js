import si from "systeminformation";

// Служебные виртуальные ФС Linux — не накопители, в списке дисков они не нужны.
const SKIP_FS_TYPES = new Set(["tmpfs", "devtmpfs", "squashfs", "overlay", "proc", "sysfs", "efivarfs"]);

/**
 * Список локальных накопителей: имя, файловая система, общий объём, занятое и доступное место.
 * Аналог DriveInfo.GetDrives() из .NET.
 */
export async function getDrives() {
  const drives = await si.fsSize();
  return drives
    .filter((d) => d.size > 0 && !SKIP_FS_TYPES.has(d.type))
    .map((d) => ({
      name: d.mount || d.fs,
      fsType: d.type || "—",
      total: d.size,
      used: d.used,
      available: d.available,
      usePercent: d.use,
      readOnly: d.rw === false,
    }));
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
