import { styleText } from "node:util";
import { select, input, confirm, number } from "@inquirer/prompts";
import { config } from "../config.js";
import { toUserMessage } from "../errors.js";
import { auditFile, auditFiles, getJournal, getFiles } from "../audit/audit.js";
import { getDrives, formatBytes } from "../modules/disks.js";
import {
  parseJson,
  serializeJson,
  parsePeopleXml,
  serializePeopleXml,
  PeopleSchema,
} from "../modules/jsonXml.js";
import { createZip, extractZip } from "../modules/archive.js";

const ok = (msg) => console.log(styleText("green", `✔ ${msg}`));
const title = (msg) => console.log("\n" + styleText(["bold", "cyan"], msg));
const fmtDate = (d) => (d ? new Date(d).toLocaleString("ru-RU") : "—");
const askPath = (message, def) => input({ message, default: def, required: true });

// ───────────────────────────── Диски ─────────────────────────────

async function showDrives() {
  title("Локальные накопители");
  const drives = await getDrives();
  console.table(
    drives.map((d) => ({
      Диск: d.name,
      ФС: d.fsType,
      Объём: formatBytes(d.total),
      Занято: formatBytes(d.used),
      Свободно: formatBytes(d.available),
      "Заполн., %": d.usePercent ?? "—",
    })),
  );
}

// ───────────────────────────── Файлы ─────────────────────────────

async function filesMenu({ fm, user }) {
  const action = await select({
    message: "Операции с файлами",
    choices: [
      { name: "Содержимое каталога", value: "list" },
      { name: "Прочитать файл", value: "read" },
      { name: "Создать файл", value: "create" },
      { name: "Перезаписать файл", value: "overwrite" },
      { name: "Удалить файл или пустой каталог", value: "delete" },
      { name: "← Назад", value: "back" },
    ],
  });

  if (action === "list") {
    const entries = await fm.list(await askPath("Каталог (относительно рабочего)", "."));
    if (entries.length === 0) return console.log("(пусто)");
    console.table(
      entries.map((e) => ({
        Имя: e.isDir ? `${e.name}/` : e.name,
        Размер: e.isDir ? "" : formatBytes(e.size),
        Изменён: fmtDate(e.modified),
      })),
    );
  } else if (action === "read") {
    const { content, meta } = await fm.readText(await askPath("Путь к файлу"));
    title(`${meta.location} (${formatBytes(meta.size)})`);
    console.log(content);
    await auditFile(user, "read", meta);
  } else if (action === "create" || action === "overwrite") {
    const target = await askPath("Путь к файлу");
    const content = await input({ message: "Содержимое файла" });
    if (action === "create") {
      const meta = await fm.create(target, content);
      await auditFile(user, "create", meta);
      ok(`Файл ${meta.location} создан`);
    } else {
      const meta = await fm.overwrite(target, content);
      await auditFile(user, "modify", meta);
      ok(`Файл ${meta.location} перезаписан`);
    }
  } else if (action === "delete") {
    const target = await askPath("Что удалить");
    if (!(await confirm({ message: `Удалить ${target}?`, default: false }))) return;
    const meta = await fm.remove(target);
    if (!meta.isDirectory) await auditFile(user, "delete", meta);
    ok(`${meta.location} удалён`);
  }
}

// ─────────────────────────── JSON / XML ───────────────────────────

async function askPeople() {
  const people = [];
  do {
    const name = await input({ message: "Имя", required: true });
    const age = await number({ message: "Возраст", min: 0, max: 150, required: true });
    const email = await input({ message: "E-mail (необязательно)" });
    people.push(email ? { name, age, email } : { name, age });
  } while (await confirm({ message: "Добавить ещё одного человека?", default: false }));
  return people;
}

async function structuredMenu({ fm, user }, format) {
  const FORMAT = format.toUpperCase();
  const action = await select({
    message: `Работа с ${FORMAT}`,
    choices: [
      { name: `Создать ${FORMAT}-файл со списком людей`, value: "write" },
      { name: `Прочитать ${FORMAT}-файл`, value: "read" },
      { name: "← Назад", value: "back" },
    ],
  });

  if (action === "write") {
    const people = await askPeople();
    const text = format === "json" ? serializeJson(people, PeopleSchema) : serializePeopleXml(people);
    const meta = await fm.create(await askPath("Имя файла", `people.${format}`), text);
    await auditFile(user, "create", meta, { format });
    ok(`Сохранено записей: ${people.length} → ${meta.location}`);
  } else if (action === "read") {
    const { content, meta } = await fm.readText(await askPath("Путь к файлу", `people.${format}`));
    const opts = { maxBytes: fm.maxFileSize };
    const people = format === "json" ? parseJson(content, PeopleSchema, opts) : parsePeopleXml(content, opts);
    await auditFile(user, "read", meta, { format, records: people.length });
    title(`${meta.location}: записей ${people.length}`);
    console.table(people);
  }
}

// ───────────────────────────── ZIP ─────────────────────────────

async function zipMenu({ fm, user }) {
  const action = await select({
    message: "ZIP-архивы",
    choices: [
      { name: "Создать архив", value: "create" },
      { name: "Распаковать архив", value: "extract" },
      { name: "← Назад", value: "back" },
    ],
  });

  if (action === "create") {
    const answer = await input({ message: "Файлы через запятую", required: true });
    const sources = answer
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const { archive, files } = await createZip(
      fm,
      sources,
      await askPath("Имя архива", "archive.zip"),
      config.zip,
    );
    await auditFile(user, "archive", archive, { files });
    ok(`Архив ${archive.location} создан: файлов ${files.length}, ${formatBytes(archive.size)}`);
  } else if (action === "extract") {
    const zipPath = await askPath("Путь к архиву");
    const dest = await askPath("Новый каталог для распаковки", zipPath.replace(/\.zip$/i, ""));
    const { destination, files } = await extractZip(fm, zipPath, dest, config.zip);
    await auditFiles(user, "extract", files, { archive: zipPath });
    ok(`Распаковано файлов: ${files.length} → ${destination}/`);
  }
}

// ─────────────────────────── База данных ───────────────────────────

async function showMyFiles({ user }) {
  title("Мои файлы (по данным БД)");
  const rows = await getFiles(user);
  if (rows.length === 0) return console.log("(нет записей)");
  console.table(
    rows.map((r) => ({
      ID: r.id,
      Путь: r.location,
      Размер: formatBytes(Number(r.size)),
      Создан: fmtDate(r.created_at),
      Изменён: fmtDate(r.updated_at),
    })),
  );
}

async function showJournal({ user }) {
  const limit = await number({
    message: "Сколько последних записей показать",
    default: 20,
    min: 1,
    max: 500,
  });
  title("Журнал операций");
  const rows = await getJournal(user, limit);
  console.table(
    rows.map((r) => ({
      Время: fmtDate(r.ts),
      Операция: r.operation_type,
      Файл: r.location ?? "",
      Детали: r.details ? JSON.stringify(r.details).slice(0, 60) : "",
    })),
  );
}

// ─────────────────────────── Главное меню ───────────────────────────

const MAIN_ACTIONS = {
  drives: showDrives,
  files: filesMenu,
  json: (ctx) => structuredMenu(ctx, "json"),
  xml: (ctx) => structuredMenu(ctx, "xml"),
  zip: zipMenu,
  dbFiles: showMyFiles,
  journal: showJournal,
};

export async function mainMenu(ctx) {
  for (;;) {
    const action = await select({
      message: `[${ctx.user.username}] Главное меню`,
      pageSize: 10,
      choices: [
        { name: "Диски и файловая система", value: "drives" },
        { name: "Операции с файлами", value: "files" },
        { name: "JSON", value: "json" },
        { name: "XML", value: "xml" },
        { name: "ZIP-архивы", value: "zip" },
        { name: "Мои файлы (БД)", value: "dbFiles" },
        { name: "Журнал операций", value: "journal" },
        { name: "Выход", value: "exit" },
      ],
    });
    if (action === "exit") return;
    await runSafely(() => MAIN_ACTIONS[action](ctx));
  }
}

// Ошибка операции не роняет приложение: пользователь видит понятное сообщение,
// подробности (стек) выводятся только в режиме DEBUG.
export async function runSafely(fn) {
  try {
    await fn();
  } catch (err) {
    if (err?.name === "ExitPromptError") throw err;
    console.log(styleText("red", `✖ ${toUserMessage(err)}`));
    if (process.env.DEBUG) console.error(err);
  }
}
