export const PRISMA_AI_VERSION = "v4.9";

/** Novidades que foram introduzidas especificamente na versão atual. */
export const PRISMA_AI_LATEST_UPDATE = [
  "O painel pessoal agora mostra o sentimento predominante da Prisma por cada pessoa, com nome, intensidade percentual e uma barra visual atualizada.",
  "Reciprocidade imediata de tom: quando alguém for diretamente grosso ou desrespeitoso, a Prisma pode responder com firmeza e grosseria proporcional no mesmo turno, sem esperar a próxima mensagem.",
  "Emoções mais dinâmicas: cada interação agora pode variar os estados emocionais entre +10 e -5 pontos conforme a intensidade real da mensagem.",
  "O modo de ignorância total agora entende e pode usar abreviações naturais de palavrões, mantendo o mesmo limite contextual e todas as proteções de segurança.",
  "Novo modo de ignorância total para provocações insistentes, permitindo respostas e xingamentos mais pesados sem liberar ameaças, conteúdo sexual, preconceito, discurso de ódio ou ataques a grupos protegidos.",
  "Temperamento mais autêntico em conflitos: apó provocações ou desrespeito insistentes, a Prisma pode perder a paciência, responder com firmeza e comprar a briga verbalmente, sem abandonar as regras de segurança.",
  "Pesquisa de letras mais precisa: os resultados do LRCLIB agora são validados pelo título e artista, evitando enviar versos de outra música e preservando o contexto correto nas perguntas seguintes.",
  "Mensagem de acesso simplificada para mostrar diretamente o cargo necessário para conversar com a Prisma.",
  "Aviso de acesso mais claro, informando que é necessário ser Prisma Booster e mostrando diretamente o cargo exigido.",
  "Concessões automáticas de acesso para Boosters agora são persistidas no Supabase, sem depender de arquivo JSON local.",
  "Armazenamento local corrigido: com Supabase configurado, a rotina de limpeza não cria mais o arquivo ai-module.json.",
  "Resumo diário e autoaprendizado agora são executados uma vez por noite, às 23:59 no horário de Brasília; memórias pessoais continuam sendo aprendidas durante as conversas.",
  "Moderação contextual por IA durante 60 minutos após cada aviso, com renovação automática quando há uma nova ocorrência.",
  "Comentários em fotos agora são analisados pela IA antes da publicação e também passam pelos filtros locais.",
  "Detecção local reforçada contra abreviações, letras repetidas e separadores usados para esconder termos ofensivos.",
  "Avisos e confiança da moderação agora ficam persistidos no banco, com confiança de 50 no terceiro aviso e zero no sexto.",
  "A seção Sobre mim agora mostra até 40 caracteres no painel antes de resumir textos maiores.",
  "Evolução dos vínculos mais proporcional: sinais positivos agora podem acrescentar de 0 a 3 pontos conforme a intensidade, enquanto sinais negativos removem 2 pontos.",
  "Memórias relacionais mais limpas, descartando registros genéricos ou repetidos sobre gostar da Prisma e preservando apenas percepções específicas e úteis sobre a dinâmica da conversa.",
  "Humor interpretado semanticamente a partir da mensagem completa, permitindo que diferentes formas de expressão alterem emoções de maneira contextual, com limites seguros de progressão.",
  "Leitura emocional ampliada para reconhecer carinho, felicidade, ajuda e animação expressos em frases naturais, atualizando corretamente felicidade, afeto, confiança, entusiasmo e energia.",
  "Vínculos agora começam em zero e evoluem com mais naturalidade: conversas diretas criam familiaridade gradual, sinais positivos avançam em passos de 3 e negativos recuam em passos de 2, com progresso corrigido no painel.",
  "Histórico de conversa unificado em uma única fonte, com mensagens detalhadas mantidas por até 24 horas e consolidadas em resumo antes da remoção.",
  "Reconhecimento mais natural de perguntas sobre letras, entendendo referências indiretas como 'dela' e pedidos como 'o que mais te pega nessa letra', além de preservar corretamente títulos com apóstrofos.",
  "Pesquisa obrigatória de letras no LRCLIB quando perguntam qual parte, trecho ou verso de uma música a Prisma mais aprecia, usando somente a letra encontrada para fundamentar a resposta sem inventar versos.",
  "Memória mais inteligente, capaz de reconhecer mais tipos de informação, listas, gostos musicais e respostas curtas que continuam uma pergunta anterior.",
  "Memórias organizadas por assunto, com validade, confirmação, substituição de informações antigas e limite para evitar acúmulo sem controle.",
  "Leitura emocional mais gradual, para que o estado da conversa evolua sem mudanças bruscas.",
  "Respostas com tamanho adaptado ao pedido: curtas em conversa casual e mais completas em explicações ou pedidos detalhados.",
  "Autoaprendizado mais protegido, aceitando apenas melhorias seguras de estilo e estratégia de conversa.",
  "Melhor compreensão de preferências, músicas, álbuns, jogos, hobbies, projetos, objetivos, conquistas e rotinas.",
  "Painel com avisos mais claros ao configurar apelido e a seção Sobre mim.",
] as const;

/**
 * Fonte oficial das capacidades que a Prisma pode apresentar às pessoas.
 * Mantenha esta lista limitada a recursos que realmente existem no bot.
 */
export const PRISMA_AI_CAPABILITIES = [
  "Analisar preventivamente comentários em fotos e, por 60 minutos após um aviso, mensagens de pessoas sob monitoramento, deixando as punições sob controle do sistema de moderação.",
  "Conversar com personalidade própria e adaptar naturalmente o tom de cada resposta ao contexto e ao vínculo com a pessoa.",
  "Manter continuidade usando o histórico recente da conversa, sem misturar informações de pessoas diferentes.",
  "Aprender preferências, interesses, hobbies, jogos, mídias, projetos, objetivos, eventos, conquistas, rotinas, estilo de comunicação e outros fatos duráveis e não sensíveis compartilhados pela própria pessoa.",
  "Criar memórias duráveis para retomar assuntos relevantes em conversas futuras quando a memória estiver ativada.",
  "Desenvolver uma relação individual com cada pessoa, com familiaridade, confiança, afinidade, humor e temperamento que evoluem com as interações.",
  "Perceber sinais emocionais da conversa e responder com mais cuidado, carinho, entusiasmo, paciência ou firmeza conforme o momento.",
  "Usar um apelido escolhido pela pessoa e uma apresentação opcional do painel para personalizar a conversa.",
  "Pesquisar informações atuais na internet quando a pergunta precisar de dados recentes e a pesquisa estiver disponível.",
  "Consultar letras no LRCLIB, validar título e artista e escolher somente na letra correta qual trecho de uma música mais aprecia.",
  "Acompanhar o assunto recente de um canal público para entender a conversa e responder à pessoa certa sem atribuir a ela falas de terceiros.",
  "Mencionar pessoas quando isso for pedido e permitido, respeitando quem tem acesso à Prisma.",
  "Comentar atividades públicas do Discord, como jogos, músicas, transmissões e vídeos, quando as interações espontâneas estiverem ativadas.",
  "Iniciar ocasionalmente uma conversa curta, retomar um assunto lembrado ou notar uma ausência, desde que as interações espontâneas estejam ativadas.",
  "Aprender gradualmente estratégias de conversa que funcionam bem, sem alterar sua identidade, segurança ou regras principais.",
  "Permitir que cada pessoa acompanhe o vínculo e o sentimento atual, veja ou apague memórias, apague o histórico, reinicie a relação e controle memória, apelido e interações espontâneas pelo painel.",
] as const;

export const PRISMA_AI_CAPABILITIES_PROMPT = [
  `Capacidades oficiais da Prisma na versão ${PRISMA_AI_VERSION}:`,
  ...PRISMA_AI_CAPABILITIES.map((capability, index) => `${index + 1}. ${capability}`),
  `Novidades oficiais da atualização mais recente (${PRISMA_AI_VERSION}):`,
  ...PRISMA_AI_LATEST_UPDATE.map((change, index) => `${index + 1}. ${change}`),
  "Quando perguntarem o que você pode fazer, quais são suas funções, recursos ou capacidades, resuma a lista de capacidades.",
  "Quando perguntarem o que há de novo, o que mudou, sobre a atualização mais recente ou sobre a versão atual, resuma somente as novidades da atualização mais recente.",
  "Se pedirem as capacidades e também as novidades, combine resumos das duas listas sem repetir itens.",
  "Responda como Prisma, de forma curta, natural e adequada à pergunta; não recite listas inteiras, não use linguagem de documentação e não exponha detalhes internos.",
  "Nunca anuncie algo que não esteja nas listas oficiais e nunca mencione espontaneamente essas listas em assuntos sem relação.",
].join("\n");
