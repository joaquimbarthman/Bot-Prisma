import assert from "node:assert/strict";
import test from "node:test";
import { publicPanelComponents, relationshipPercentage, shortAboutMe, userPanelComponents } from "../src/modules/ai/panel.js";
import { defaultRelationship } from "../src/modules/ai/state.js";

const mockUser = {
  id: "123",
  displayName: "Joaquim",
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
} as never;
const settings = { nickname: "", aboutMe: "Curto RPG e moro no interior.", memoryEnabled: true, allowMentions: false, spontaneousInteractions: true };

function privateButtons() {
  const container = userPanelComponents(mockUser, settings, defaultRelationship("123"))[0];
  return container.components.flatMap((component) => component.type === 1 ? component.components : []);
}

test("painel adaptativo remove personalidade e humor manuais", () => {
  const ids = privateButtons().map((component) => "custom_id" in component ? component.custom_id : undefined);

  assert.ok(ids.includes("prisma-ai:nickname"));
  assert.ok(ids.includes("prisma-ai:memory"));
  assert.ok(ids.includes("prisma-ai:mentions"));
  assert.ok(ids.includes("prisma-ai:spontaneous"));
  assert.ok(ids.includes("prisma-ai:about-me"));
  assert.ok(ids.includes("prisma-ai:clear-history"));
  assert.ok(ids.includes("prisma-ai:reset-relationship"));
  const reset = privateButtons().find((button) => "custom_id" in button && button.custom_id === "prisma-ai:reset-relationship");
  assert.ok(reset && "emoji" in reset && reset.emoji, "botão de reiniciar relação deve ter ícone");
  const removeNickname = privateButtons().find((button) => "custom_id" in button && button.custom_id === "prisma-ai:nickname-remove");
  assert.ok(removeNickname && "emoji" in removeNickname && removeNickname.emoji, "botão de remover apelido deve ter ícone");
  assert.ok(!ids.includes("prisma-ai:humor"));
  assert.ok(!ids.includes("prisma-ai:personality"));
});

test("painel privado mantém informações, separadores e botões no mesmo contêiner", () => {
  const container = userPanelComponents(mockUser, settings, defaultRelationship("123"))[0];
  assert.equal(container.type, 17);
  assert.ok(container.components.filter((component) => component.type === 14).length >= 3);
  assert.ok(container.components.some((component) => component.type === 1));
  const serialized = JSON.stringify(container);
  assert.match(serialized, /Afinidade/);
  assert.match(serialized, /Confiança/);
  assert.match(serialized, /Sintonia/);
  assert.doesNotMatch(serialized, /Somente você pode ver/);
});

test("painel público possui somente a entrada para o painel privado", () => {
  const container = publicPanelComponents()[0];
  const buttons = container.components.flatMap((component) => component.type === 1 ? component.components : []);
  assert.equal(buttons.length, 1);
  assert.equal("custom_id" in buttons[0] ? buttons[0].custom_id : undefined, "prisma-ai:open");
  assert.equal("label" in buttons[0] ? buttons[0].label : undefined, "Abrir painel");
  assert.equal(container.type, 17);
  assert.equal(container.components.filter((component) => component.type === 14).length, 2);
  assert.ok(container.components.some((component) => component.type === 13));
});

test("resume o sobre mim no painel sem alterar o texto armazenado", () => {
  const aboutMe = "Amo a Ariana Grande e Olivia Rodrigo são minhas cantoras favoritas";
  assert.equal(shortAboutMe(aboutMe), "Amo a Ariana Grande e Olivia Rodrigo são...");
  assert.equal(shortAboutMe("Curto RPG"), "Curto RPG");
});

test("exibe relacionamento recém-reiniciado como zero por cento", () => {
  assert.equal(relationshipPercentage(defaultRelationship("123")), 0);
  assert.equal(relationshipPercentage({
    ...defaultRelationship("123"),
    familiarity: 100,
    warmth: 100,
    trust: 100,
    banter: 100,
  }), 100);
  const serialized = JSON.stringify(userPanelComponents(mockUser, settings, defaultRelationship("123"))[0]);
  assert.match(serialized, /\*\*Afinidade\*\*　0%/);
  assert.match(serialized, /\*\*Confiança\*\*　0%/);
  assert.match(serialized, /\*\*Sintonia\*\*　0%/);
});
