import type { Message } from "discord.js";

export const PRISMA_SERVER_INVITE = "https://discord.gg/Sa3BpbbRW4";

export const directMessageTemplates = [
  "Oii 👀 por aqui eu não respondo não kkk\nSe quiser conversar comigo, cola no meu servidor: **[Link]** 💜",
  "ué 👀 veio parar no meu privado como? kkkkk\nvem falar comigo lá no servidor: **[Link]**",
  "oii oii 🫧\nmeu pv é praticamente decoração kkk, me chama lá: **[Link]**",
  "quase respondi aqui 👀\nmas eu só converso no servidor kkkkk **[Link]**",
  "me achou no privado foi? 😭\ncola lá no servidor que eu converso com vc: **[Link]**",
  "eita, uma mensagem no meu pv 👀\nvem falar comigo lá no servidor: **[Link]** 💜",
  "aqui eu finjo que nem vi 🤭\nme chama no servidor que eu respondo: **[Link]**",
  "sai do meu pv KKKKK 😭\nvem conversar comigo aqui: **[Link]**",
  "meu deus vc veio até aqui falar comigo 😭\ncola no servidor que é mais fácil: **[Link]**",
  "psiiu 👀\neu só respondo mensagem lá no servidor: **[Link]**",
  "oii criatura 😭\nvem falar comigo no servidor, aqui eu fico quietinha: **[Link]**",
  "não adianta tentar amizade pelo pv não viu KKKK\ncola aqui: **[Link]**",
  "achei fofo vc vindo falar comigo no privado 🥹\nmas vem pro servidor: **[Link]**",
  "opa 👀 quem é vivo sempre aparece\nme chama lá no servidor: **[Link]**",
  "vc realmente entrou no meu pv pra mandar isso? KKKKK\nvem falar comigo lá: **[Link]**",
  "hmmm mensagem suspeita no meu privado 👀\nvou fingir que não vi até vc aparecer aqui: **[Link]**",
  "aqui nãooo 😭\nvem conversar comigo no servidor: **[Link]**",
  "eu até responderia…\nmas meu contrato imaginário não deixa 😔 KKKK\n**[Link]**",
  "mensagem recebida 🫡\nresposta disponível somente no servidor KKKK: **[Link]**",
  "alô alô 👀\na Prisma atende somente em outro estabelecimento KKKK\n**[Link]**",
  "meu pv está fechado para visitação 😭\nme encontra aqui: **[Link]**",
  "toc toc 👀\nninguém em casa kkk, tô lá no servidor: **[Link]**",
  "hiii 💜\nse quiser conversar comigo de verdade vem aqui: **[Link]**",
  "eu vi sua mensagem viu 👀\nsó não vou responder aqui KKKK\n**[Link]**",
  "tentativa de contato detectada 🤖\nbrincadeira KKKK vem falar comigo aqui: **[Link]**",
  "olha quem apareceu no meu privado 👀\nvem pro servidor antes que eu te expulse daqui kkkkk\n**[Link]**",
  "amor, lugar errado 😭\nminha casa é aqui: **[Link]**",
  "a fofoca não acontece no privado não 👀\nvem pro servidor: **[Link]**",
  "vc quer conversar comigo? 🥹\nentão cola aqui que eu te respondo: **[Link]**",
  "não seja tímido não kkk\naparece lá no servidor e fala comigo: **[Link]**",
  "atenção 🚨 usuário perdido no privado da Prisma\nredirecionando pra: **[Link]**",
  "achei vc 👀\nagora vem me achar lá no servidor também: **[Link]**",
  "eu moro no servidor, não no pv 😭\nvem aqui: **[Link]**",
  "ó… entre nós 👀\naqui eu não respondo, mas lá eu respondo kkkkk\n**[Link]**",
  "vc tem 5 segundos pra sair do meu pv 😡\nbrincadeira KKKKK, só vem falar comigo aqui: **[Link]**",
  "oii best 👀\nquer conversar? então vem lá pro servidor: **[Link]**",
  "meu privado: 🪦\neu no servidor: 🗣️🗣️🗣️\n**[Link]**",
  "não me deixa falando sozinha lá no servidor 😭\nvem pra cá: **[Link]**",
  "eu apareço bastante, só não aqui KKKK\nvem conversar comigo: **[Link]**",
  "hmm 👀 vc parece querer minha atenção\nconsegue ela aqui: **[Link]** 💜",
] as const;

export class DirectMessageRotation {
  private readonly remaining = new Map<string, number[]>();
  private readonly previous = new Map<string, number>();

  constructor(private readonly random: () => number = Math.random) {}

  next(userId: string): string {
    let choices = this.remaining.get(userId);
    if (!choices?.length) {
      choices = directMessageTemplates.map((_, index) => index);
      for (let index = choices.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(this.random() * (index + 1));
        [choices[index], choices[swapIndex]] = [choices[swapIndex], choices[index]];
      }
      const previous = this.previous.get(userId);
      if (previous !== undefined && choices.at(-1) === previous && choices.length > 1) {
        [choices[0], choices[choices.length - 1]] = [choices[choices.length - 1], choices[0]];
      }
      this.remaining.set(userId, choices);
    }
    const selected = choices.pop()!;
    this.previous.set(userId, selected);
    return directMessageTemplates[selected].replaceAll("[Link]", PRISMA_SERVER_INVITE);
  }
}

const rotation = new DirectMessageRotation();

export async function handleDirectMessage(message: Message): Promise<boolean> {
  if (!message.channel.isDMBased() || message.author.bot) return false;
  await message.reply({ content: rotation.next(message.author.id), allowedMentions: { parse: [] } });
  return true;
}
