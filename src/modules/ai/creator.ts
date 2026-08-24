export function asksAboutPrismaCreator(content: string): boolean {
  return /\b(?:seu|sua)\s+(?:dono|dona|criador|criadora|owner)\b|\b(?:dono|dona|criador|criadora|owner)\s+da\s+prisma\b|\bquem\s+(?:te|a)\s+criou\b|\bquem\s+(?:e|eh|Ã©)\s+(?:o|a)?\s*(?:dono|dona|criador|criadora|owner)\s+(?:da\s+prisma|seu|sua)\b/i.test(content);
}
