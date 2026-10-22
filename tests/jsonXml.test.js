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

test("JSON: prototype pollution через __proto__ не срабатывает", () => {
  const evil = '[{"name":"x","age":1,"__proto__":{"isAdmin":true}}]';
  const result = parseJson(evil, PeopleSchema, opts);
  assert.equal({}.isAdmin, undefined);
  assert.equal(result[0].isAdmin, undefined);
  assert.equal(Object.getPrototypeOf(result[0]), Object.prototype);
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

test("XML: XXE (внешняя сущность) отклоняется", () => {
  const xxe = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE people [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
    "<people><person><name>&xxe;</name><age>1</age></person></people>",
  ].join("\n");
  assert.throws(() => parsePeopleXml(xxe, opts), SecurityError);
});

test("XML: billion laughs отклоняется", () => {
  const bomb = [
    '<?xml version="1.0"?>',
    '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>',
    "<people><person><name>&lol2;</name><age>1</age></person></people>",
  ].join("\n");
  assert.throws(() => parsePeopleXml(bomb, opts), SecurityError);
});

test("XML: необъявленная сущность без DTD не раскрывается, остаётся текстом", () => {
  const xml = "<people><person><name>&foo;</name><age>1</age></person></people>";
  assert.deepEqual(parsePeopleXml(xml, opts), [{ name: "&foo;", age: 1 }]);
});

test("XML: элемент __proto__ не загрязняет прототип и отклоняется схемой", () => {
  const xml =
    "<people><person><name>x</name><age>1</age><__proto__><isAdmin>1</isAdmin></__proto__></person></people>";
  assert.throws(() => parsePeopleXml(xml, opts), AppError);
  assert.equal({}.isAdmin, undefined);
});

test("XML: неожиданные элементы, неверный возраст и битый документ отклоняются", () => {
  const extra = "<people><person><name>x</name><age>1</age><role>admin</role></person></people>";
  assert.throws(() => parsePeopleXml(extra, opts), AppError);
  assert.throws(
    () => parsePeopleXml("<people><person><name>x</name><age>1e3</age></person></people>", opts),
    AppError,
  );
  assert.throws(() => parsePeopleXml("<people><person>", opts), AppError);
});
