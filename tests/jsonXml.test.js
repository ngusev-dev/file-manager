import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, SecurityError } from "../src/errors.js";
import {
  parseJson,
  serializeJson,
  parsePeopleXml,
  serializePeopleXml,
} from "../src/modules/jsonXml.js";

const opts = { maxBytes: 1024 * 1024 };
const people = [
  { name: 'Анна <Admin> & "Co"', age: 30, email: "anna@example.com" },
  { name: "Борис", age: 41 },
];

test("JSON: сериализация и обратное чтение", () => {
  assert.deepEqual(parseJson(serializeJson(people), opts), people);
});

test("JSON: произвольная структура и все типы корневого значения", () => {
  const values = [
    { project: "files", settings: { enabled: true, tags: ["a", 2, null, { nested: [] }] }, extra: {} },
    [1, "text", false, null, [2], { key: "value" }],
    {}, [], "строка", "", 42, -1.5, 0, true, false, null,
    { name: "x", age: "любой тип", role: "admin" },
  ];
  for (const value of values) {
    const text = serializeJson(value);
    assert.deepEqual(parseJson(text, opts), value);
    assert.deepEqual(JSON.parse(text), value);
  }
});

test("JSON: опасные ключи удаляются на всех уровнях", () => {
  const text = '{"__proto__":{"polluted":true},"nested":{"constructor":{},"prototype":1,"safe":2},"items":[{"__proto__":{},"value":3}]}';
  assert.deepEqual(parseJson(text, opts), { nested: { safe: 2 }, items: [{ value: 3 }] });
  assert.equal(Object.prototype.polluted, undefined);
});

test("XML: сериализация и обратное чтение со спецсимволами", () => {
  const xml = serializePeopleXml(people);
  assert.match(xml, /&lt;Admin&gt; &amp;/);
  assert.deepEqual(parsePeopleXml(xml, opts), people);
});


test("JSON: некорректный JSON отклоняется", () => {
  for (const text of ["{not json", "", "undefined", '{"a":1,}', "[1,]", "NaN"]) {
    assert.throws(() => parseJson(text, opts), AppError);
  }
});

test("JSON: чрезмерная вложенность обрабатывается как ошибка, размер ограничен в байтах UTF-8", () => {
  assert.throws(() => parseJson("[".repeat(100_000) + "]".repeat(100_000), opts), AppError);
  assert.throws(
    () => parseJson("[" + " ".repeat(2000) + "]", { maxBytes: 1000 }),
    SecurityError,
  );
  assert.equal(parseJson('"я"', { maxBytes: 4 }), "я");
  assert.throws(() => parseJson('"я"', { maxBytes: 3 }), SecurityError);
});
