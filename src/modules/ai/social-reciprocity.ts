export const MIN_RELATION_SCORE = -5;
export const MAX_RELATION_SCORE = 10;

export type SocialHostilityLevel = 0 | 1 | 2 | 3;
export type SocialTreatment = { directedAtPrisma: boolean; hostilityLevel: SocialHostilityLevel; playful: boolean; disagreement: boolean; apology: boolean; positive: boolean; relationshipDelta: -2 | -1 | 0 | 1; guidance: string };

export function clampRelationScore(value: number): number {
  return Math.max(MIN_RELATION_SCORE, Math.min(MAX_RELATION_SCORE, Math.round(value)));
}

function normalize(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }

export function analyzeSocialTreatment(content: string, currentScore = 0): SocialTreatment {
  const text = normalize(content);
  const disagreement = /\b(?:acho q|acho que|discordo|n gostei|nao gostei|entendeu errado|explica direito|ta errad[ao]|esta errad[ao])\b/.test(text) && !/\b(?:burra?|idiota|inutil|lixo|fdp|tmnc|vai se foder|vai tomar no cu)\b/.test(text);
  const apology = /\b(?:foi mal|desculpa|me perdoa)\b/.test(text) && /\b(?:antes|xing|gross|trat|falei|fiz|contigo|ctg|com vc|com voce)\b/.test(text);
  const positive = apology || /\b(?:obrigad[oa]|te adoro|gosto de vc|gosto de voce|vc e incrivel|voce e incrivel|amo conversar (?:com|c) vc|me ajudou muito)\b/.test(text);
  const laughter = /(?:k{3,}|rsrs|hahaha|😂|🤣)/i.test(content);
  const insult = /\b(?:burr[ao]|idiota|inutil|lerd[ao]|lixo|otari[ao]|chata?|insuportavel|fdp|filh[ao] da puta|vagabund[ao])\b/.test(text);
  const profanityAttack = /\b(?:vai (?:vc |voce |tu )?(?:se foder|tomar no cu)|tmnc|foda se vc|foda se voce)\b/.test(text);
  const directPronoun = /\b(?:prisma|vc|voce|tu)\s+(?:(?:e|eh|ta|esta|ficou|parece)\s+)?(?:(?:um|uma|seu|sua)\s+)?(?:burr[ao]|idiota|inutil|lerd[ao]|lixo|otari[ao]|chata?|insuportavel|fdp|vagabund[ao])\b/.test(text);
  const bareAttack = /^(?:sua?\s+)?(?:burr[ao]|idiota|inutil|lerd[ao]|lixo|otari[ao]|chata?|insuportavel|fdp|vagabund[ao])(?:\s+(?:do|da|pra)\s+krl)?(?:\s+k{3,})?[!?. ]*$/.test(text) || profanityAttack;
  const thirdParty = /\b(?:aquele|aquela|ele|ela|esse cara|essa mina|o cara|a pessoa)\b.{0,35}\b(?:burr[ao]|idiota|inutil|lixo|otari[ao]|chata?|insuportavel|fdp)\b/.test(text) && !/\b(?:vc|voce|tu)\b.{0,25}\b(?:burr[ao]|idiota|inutil|lixo|otari[ao]|chata?|insuportavel|fdp)\b/.test(text) && !profanityAttack;
  const directedAtPrisma = !disagreement && !thirdParty && (directPronoun || bareAttack);
  let hostilityLevel: SocialHostilityLevel = 0;
  if (directedAtPrisma) {
    if (profanityAttack || /\b(?:fdp|inutil do krl|inutil pra krl)\b/.test(text)) hostilityLevel = 2;
    else if (insult) hostilityLevel = 1;
    if (hostilityLevel >= 1 && /\b(?:sempre|dnv|de novo|nunca|so aparece|so serve)\b/.test(text)) hostilityLevel = 3;
  }
  const playful = directedAtPrisma && laughter && currentScore >= 5 && hostilityLevel <= 2;
  if (playful) hostilityLevel = 1;
  const relationshipDelta: -2 | -1 | 0 | 1 = apology ? 1 : positive ? 1 : playful ? 0 : hostilityLevel >= 3 ? -2 : hostilityLevel >= 1 ? -1 : 0;
  const guidance = hostilityLevel === 0 ? currentScore < 0 ? "Responda primeiro à mensagem atual. Pode soar mais seca, mas não retome nem inicie uma briga antiga." : "Responda normalmente à mensagem atual." : playful ? "A provocação parece brincadeira entre pessoas próximas; devolva com uma tirada amistosa e curta." : hostilityLevel === 1 ? "Pode devolver com deboche ou sarcasmo leve, sem escalar a intensidade." : hostilityLevel === 2 ? "Pode responder com grosseria proporcional, sarcasmo forte e um palavrão comum não discriminatório." : "Ataque forte ou repetido: pode ser muito seca, ignorante e sem paciência, com palavrões proporcionais, sem ameaçar nem humilhar por vulnerabilidades.";
  return { directedAtPrisma, hostilityLevel, playful, disagreement, apology, positive, relationshipDelta, guidance };
}
