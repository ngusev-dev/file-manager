import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { SecurityError, AppError } from "../errors.js";

export const PersonSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    age: z.number().int().min(0).max(150),
    email: z.email().max(254).optional(),
  })
  .strict();

export const PeopleSchema = z.array(PersonSchema).max(10_000);

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? ` (поле ${issue.path.join(".")})` : "";
    throw new AppError(`Данные не прошли проверку${where}: ${issue.message}`);
  }
  return result.data;
}

function assertSize(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new SecurityError(`Документ больше допустимого размера (${maxBytes} байт)`);
  }
}

/**
 * Безопасная десериализация JSON: только JSON.parse
 */
export function parseJson(text, schema, { maxBytes }) {
  assertSize(text, maxBytes);
  let data;
  try {
    data = JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
  } catch {
    throw new AppError("Файл не является корректным JSON");
  }
  return validate(schema, data);
}

export function serializeJson(value, schema) {
  return JSON.stringify(validate(schema, value), null, 2) + "\n";
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // типы приводим сами по схеме, а не «угадываем»
  isArray: (_name, jpath) => jpath === "people.person",
});

const xmlBuilder = new XMLBuilder({ format: true, indentBy: "  ", suppressEmptyNode: true });

export function parsePeopleXml(text, { maxBytes }) {
  assertSize(text, maxBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new SecurityError("XML с DTD/сущностями запрещён (защита от XXE)");
  }
  if (XMLValidator.validate(text) !== true) throw new AppError("Файл не является корректным XML");

  let doc;
  try {
    doc = xmlParser.parse(text);
  } catch {
    throw new SecurityError("XML содержит недопустимые имена элементов");
  }
  if (typeof doc.people !== "object") throw new AppError("Ожидался корневой элемент <people>");

  const people = (doc.people.person ?? []).map((p) => {
    if (typeof p !== "object") throw new AppError("Некорректный элемент <person>");
    return { ...p, ...("age" in p && { age: /^\d{1,3}$/.test(p.age) ? Number(p.age) : NaN }) };
  });
  return validate(PeopleSchema, people);
}

export function serializePeopleXml(people) {
  const valid = validate(PeopleSchema, people);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlBuilder.build({ people: { person: valid } });
}
