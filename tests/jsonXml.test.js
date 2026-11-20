import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, SecurityError } from "../src/errors.js";
import { parseJson, serializeJson, parseXml, serializeXml } from "../src/modules/jsonXml.js";

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

test("XML: произвольная структура сохраняется при сериализации и чтении", () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><catalog xmlns="urn:files">'
    + '<item id="01"><name>Анна &lt;Admin&gt; &amp; &quot;Co&quot;</name>'
    + '<tags><tag>a</tag><tag>b</tag></tags></item><note>До <b>текст</b> после</note>'
    + '<item id="02"/><!--комментарий--><raw><![CDATA[<text> & data]]></raw></catalog>';
  const data = parseXml(xml, opts);
  const text = serializeXml(data);
  assert.equal(text, xml);
  assert.deepEqual(parseXml(text, opts), data);
});

test("XML: некорректный документ, DTD и превышение размера отклоняются", () => {
  assert.throws(() => parseXml("<root><item></root>", opts), AppError);
  assert.throws(() => parseXml('<!DOCTYPE root [<!ENTITY x "value">]><root>&x;</root>', opts), SecurityError);
  assert.throws(() => parseXml("<root/>", { maxBytes: 6 }), SecurityError);
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
