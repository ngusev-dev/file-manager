import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";
import { SecurityError, AppError } from "../errors.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertSize(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new SecurityError(`Документ больше допустимого размера (${maxBytes} байт)`);
  }
}

/**
 * Безопасная десериализация JSON: только JSON.parse
 */
export function parseJson(text, { maxBytes }) {
  assertSize(text, maxBytes);
  let data;
  try {
    data = JSON.parse(text, (key, value) => (FORBIDDEN_KEYS.has(key) ? undefined : value));
  } catch {
    throw new AppError("Файл не является корректным JSON");
  }
  return data;
}

export function serializeJson(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

const xmlOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata",
};

const xmlParser = new XMLParser(xmlOptions);
// Дополнительные отступы меняют текст в элементах со смешанным содержимым.
const xmlBuilder = new XMLBuilder({ ...xmlOptions, format: false, suppressEmptyNode: true });

export function parseXml(text, { maxBytes }) {
  assertSize(text, maxBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new SecurityError("XML с DTD/сущностями запрещён");
  }
  if (XMLValidator.validate(text) !== true) throw new AppError("Файл не является корректным XML");

  try {
    return xmlParser.parse(text);
  } catch {
    throw new AppError("XML содержит недопустимые имена элементов или слишком большую вложенность");
  }
}

export function serializeXml(value) {
  return xmlBuilder.build(value);
}
