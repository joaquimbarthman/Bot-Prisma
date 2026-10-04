const PANEL_NAME_LIMIT = 12;

export function panelDisplayFirstName(value: string, fallback = "usuário"): string {
  const cleaned = value.replace(/[\r\n]/g, " ").trim() || fallback;
  const firstName = cleaned.split(/\s+/u)[0] || fallback;
  const characters = Array.from(firstName);
  return characters.slice(0, PANEL_NAME_LIMIT).join("");
}
