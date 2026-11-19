import { test } from "node:test";
import assert from "node:assert/strict";

test("Проверка падения CI", () => {
  assert.fail("Намеренный сбой для проверки CI");
});
