export function getXpRequiredForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError("O nivel deve ser um inteiro positivo.");
  const n = level - 1;
  return Math.round(32 + 5 * n + 0.5 * n * n);
}

export function getTotalXpRequired(level: number): number {
  if (!Number.isInteger(level) || level < 0) throw new RangeError("O nivel deve ser um inteiro nao negativo.");
  let total = 0;
  for (let current = 1; current <= level; current += 1) total += getXpRequiredForLevel(current);
  return total;
}

export function calculateLevel(totalXp: number, maxLevel = 100): number {
  if (!Number.isFinite(totalXp) || totalXp < 0) throw new RangeError("XP deve ser nao negativo.");
  for (let level = 1; level <= maxLevel; level += 1) {
    if (totalXp < getTotalXpRequired(level)) return level - 1;
  }
  return maxLevel;
}

export function calculateXpAward(globalXp: number, sourceXp: number, boosterXp = 0): number {
  if (![globalXp, sourceXp, boosterXp].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError("Os valores de XP devem ser nao negativos.");
  }
  return Math.round(globalXp + sourceXp + boosterXp);
}
