import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, SecurityError } from "../src/errors.js";
import {
  parseJson,
  serializeJson,
  parsePeopleXml,
  serializePeopleXml,
  PeopleSchema,
} from "../src/modules/jsonXml.js";

const opts = { maxBytes: 1024 * 1024 };
const people = [
  { name: 'Анна <Admin> & "Co"', age: 30, email: "anna@example.com" },
  { name: "Борис", age: 41 },
];

test("JSON: сериализация и обратное чтение", () => {
  assert.deepEqual(parseJson(serializeJson(people, PeopleSchema), PeopleSchema, opts), people);
});

test("XML: сериализация и обратное чтение со спецсимволами", () => {
  const xml = serializePeopleXml(people);
  assert.match(xml, /&lt;Admin&gt; &amp;/);
  assert.deepEqual(parsePeopleXml(xml, opts), people);
});


test("JSON: лишние поля, неверные типы и некорректный JSON отклоняются", () => {
  assert.throws(() => parseJson('[{"name":"x","age":1,"role":"admin"}]', PeopleSchema, opts), AppError);
  assert.throws(() => parseJson('[{"name":"x","age":"1"}]', PeopleSchema, opts), AppError);
  assert.throws(() => parseJson('[{"name":"x","age":999}]', PeopleSchema, opts), AppError);
  assert.throws(() => parseJson("{not json", PeopleSchema, opts), AppError);
});

test("JSON: глубокая вложенность отклоняется схемой, превышение размера — до парсинга", () => {
  assert.throws(() => parseJson("[".repeat(100_000) + "]".repeat(100_000), PeopleSchema, opts), AppError);
  assert.throws(
    () => parseJson("[" + " ".repeat(2000) + "]", PeopleSchema, { maxBytes: 1000 }),
    SecurityError,
  );
});
