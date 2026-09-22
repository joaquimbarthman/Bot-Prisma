const months: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export function statedBirthday(message: string): string | null {
  const text = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const declaration = /\b(?:meu aniversario (?:e|eh|vai ser|cai)|faco aniversario|eu faco aniversario|nasci)\s+(?:no dia |dia |em |aos )?(\d{1,2})\s*(?:\/|de\s+)(\d{1,2}|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/;
  const match = declaration.exec(text);
  if (!match) return null;
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : months[match[2]];
  if (!month || month > 12 || day < 1 || day > new Date(2024, month, 0).getDate()) return null;
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}
