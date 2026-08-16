import assert from "node:assert/strict";
import test from "node:test";
import { panelComponents } from "../src/modules/ai/panel.js";

test("painel adaptativo remove personalidade e humor manuais", () => {
  const ids = panelComponents().flatMap((row) => row.components.map((component) => "custom_id" in component.data ? component.data.custom_id : undefined));

  assert.ok(ids.includes("prisma-ai:nickname"));
  assert.ok(ids.includes("prisma-ai:memory"));
  assert.ok(ids.includes("prisma-ai:mentions"));
  assert.ok(ids.includes("prisma-ai:spontaneous"));
  assert.ok(ids.includes("prisma-ai:clear-history"));
  assert.ok(ids.includes("prisma-ai:reset-relationship"));
  const reset = panelComponents().flatMap((row) => row.components)
    .find((button) => "custom_id" in button.data && button.data.custom_id === "prisma-ai:reset-relationship");
  assert.ok(reset && "emoji" in reset.data && reset.data.emoji, "botão de reiniciar relação deve ter ícone");
  const removeNickname = panelComponents().flatMap((row) => row.components)
    .find((button) => "custom_id" in button.data && button.data.custom_id === "prisma-ai:nickname-remove");
  assert.ok(removeNickname && "emoji" in removeNickname.data && removeNickname.data.emoji, "botão de remover apelido deve ter ícone");
  assert.ok(!ids.includes("prisma-ai:humor"));
  assert.ok(!ids.includes("prisma-ai:personality"));
});
