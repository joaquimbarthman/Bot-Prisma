export type ChannelContextMessage = {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: number;
  replyToId?: string | null;
};

type Topic = { id: number; tokens: Set<string>; messages: ChannelContextMessage[]; updatedAt: number };

const stopWords = new Set("a o os as um uma de do da dos das e ou que q oq pra para por com sem em no na nos nas eu vc voce vocês voces ele ela eles elas isso esse essa meu minha teu tua seu sua aqui ali agora hoje ontem amanha sim nao não ta tá to tô foi vai tem tipo msm mesmo muito mto mais menos so só ne né ah ai aí mds kkk kkkkk prisma".split(" "));

export function topicTokens(content: string): Set<string> {
  const normalized = content.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  return new Set((normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !stopWords.has(token)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const token of left) if (right.has(token)) count += 1;
  return count;
}

function topicLabel(topic: Topic): string {
  const frequency = new Map<string, number>();
  for (const message of topic.messages) for (const token of topicTokens(message.content)) frequency.set(token, (frequency.get(token) ?? 0) + 1);
  return [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([token]) => token).join(", ") || "conversa geral";
}

/** Agrupa conversas paralelas e devolve primeiro o assunto da mensagem atual. */
export function selectTopicContext(messages: ChannelContextMessage[], currentContent: string, replyToId?: string | null, maximumCharacters = 14_000): string {
  const topics: Topic[] = [];
  const ordered = [...messages].filter((message) => message.content.trim()).sort((a, b) => a.createdAt - b.createdAt);
  for (const message of ordered) {
    const tokens = topicTokens(message.content);
    const repliedTopic = message.replyToId ? topics.find((topic) => topic.messages.some((item) => item.id === message.replyToId)) : undefined;
    const candidates = topics.filter((topic) => message.createdAt - topic.updatedAt <= 45 * 60_000);
    const nearest = candidates.map((topic) => ({ topic, score: overlap(tokens, topic.tokens) })).sort((a, b) => b.score - a.score)[0];
    const best = repliedTopic ?? (nearest?.score > 0 ? nearest.topic : undefined);
    const topic = best ?? { id: topics.length + 1, tokens: new Set<string>(), messages: [], updatedAt: message.createdAt };
    if (!best) topics.push(topic);
    topic.messages.push(message);
    for (const token of tokens) topic.tokens.add(token);
    topic.updatedAt = message.createdAt;
  }

  const currentTokens = topicTokens(currentContent);
  const repliedTopic = replyToId ? topics.find((topic) => topic.messages.some((message) => message.id === replyToId)) : undefined;
  const ranked = topics.map((topic) => ({
    topic,
    score: (topic === repliedTopic ? 1_000 : 0) + overlap(currentTokens, topic.tokens) * 100 + topic.updatedAt / 1e13,
  })).sort((a, b) => b.score - a.score).slice(0, 3);

  const sections = ranked.map(({ topic }, index) => {
    const lines = topic.messages.slice(-12).map((message) => `[autor_id=${message.authorId}] ${message.authorName}: ${message.content.replace(/\s+/g, " ").slice(0, 350)}`);
    return `ASSUNTO ${index + 1}${topic === repliedTopic ? " (mensagem respondida)" : ""}: ${topicLabel(topic)}\n${lines.join("\n")}`;
  });
  while (sections.join("\n\n").length > maximumCharacters && sections.length > 1) sections.pop();
  return sections.join("\n\n").slice(-maximumCharacters);
}
