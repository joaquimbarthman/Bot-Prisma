import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePublicError } from "../src/public-error-reporter.js";

test("remove tokens de interação dos relatórios públicos", () => {
  const error = new Error("POST https://discord.com/api/v10/interactions/123/token-secreto/callback?token=abc");
  const sanitized = sanitizePublicError(error);
  assert.doesNotMatch(sanitized, /token-secreto|token=abc/);
  assert.match(sanitized, /TOKEN_REMOVIDO/);
  assert.doesNotMatch(sanitized, /at TestContext|Error: Error:/);
});
