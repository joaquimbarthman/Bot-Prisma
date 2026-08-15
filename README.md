# Prisma — bot de moderação para Discord

Monitora mensagens, remove conteúdo ofensivo, aplica avisos progressivos e registra ações da moderação. Ao atingir o limite de avisos, o membro fica de castigo temporariamente e seus avisos são zerados. A análise por IA é opcional, mas recomendada para entender contexto, preconceito velado e tentativas de burlar palavras-chave.

## Instalação

1. Rode `npm install`.
2. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN` e `DISCORD_CLIENT_ID`.
3. No [Discord Developer Portal](https://discord.com/developers/applications), ative **Message Content Intent** e **Server Members Intent** em Bot → Privileged Gateway Intents.
4. Convide o bot com os escopos `bot` e `applications.commands`. Dê as permissões **View Channels**, **Send Messages**, **Manage Messages** e **Moderate Members**.
5. Rode `npm run dev`.

Durante testes, preencha `DISCORD_GUILD_ID` para os comandos aparecerem imediatamente. Sem ele, os comandos são globais e podem demorar para aparecer.

## IA opcional

Preencha `OPENAI_API_KEY` para ativar a análise de assédio, ameaças e discurso de ódio. O bot usa o endpoint dedicado `omni-moderation-latest`, gratuito para usuários da API e que não consome o crédito mensal. Resultados repetidos ficam em cache por 6 horas e `AI_MAX_DAILY_REQUESTS` evita abuso (padrão: 1000 por dia). A mensagem é enviada à API configurada; informe isso nas regras/privacidade do servidor. Falhas ou limite atingido deixam a mensagem passar e são registrados no console.

## Segurança e ajustes

- Administradores são monitorados por padrão para facilitar testes. Use `IGNORE_ADMINISTRATORS=true` se quiser ignorá-los em produção.
- Cada ciclo completo de 3 avisos reduz a reputação em 25%: 100%, 75%, 50%, 25% e 0%. Ao completar 3 avisos, o membro recebe um castigo temporário e os avisos voltam a zero. Ao chegar a 0%, recebe o cargo `Mutado`, perde a visibilidade dos canais e ganha um canal privado de recurso. `/limpar-avisos` ou `Confiar` restaura 100%, remove o cargo e apaga o canal privado.
- `PUNISHMENT_CATEGORY_ID` define a categoria onde os canais privados de castigo serão criados.
- `FILTER_JSON_PATH` permite carregar frases externas. Apenas `bloqueio_imediato` remove mensagens diretamente; `revisao_contextual` não pune por palavra isolada.
- A galeria usa os ícones personalizados de `assets/` (`coracao`, `linha` e `lixo`) em botões sem texto. O bot precisa da permissão **Criar expressões** no servidor; se não tiver, usa símbolos Unicode.
- Defina `MOD_LOG_CHANNEL_ID` para manter revisão humana das decisões.
- Defina `MONITORED_CHANNEL_IDS` para limitar o monitoramento a canais específicos.
- `LOG_MONITORED_MESSAGES=true` exibe no terminal cada mensagem verificada e o resultado. Use `LOG_MESSAGE_CONTENT=false` para ocultar o texto e manter apenas servidor, canal e usuário.
- Avisos ficam em `data/warnings.json`. Para vários servidores ou alta escala, migre para SQLite/PostgreSQL.

## Prisma IA

O módulo isolado fica em `src/modules/ai/`. Somente Boosters e membros com o cargo configurado em `AI_FRIENDS_ROLE_ID` podem gerar chamadas. Configure `AI_GENERAL_CHANNEL_ID` e `AI_PANEL_CHANNEL_ID`, reinicie o bot e use `/configurar-prisma` para publicar o painel único.

Com `SUPABASE_URL` e `SUPABASE_SECRET_KEY`, preferências, histórico temporário, métricas e interações espontâneas usam o Supabase. Execute `supabase/schema.sql` uma vez no SQL Editor. Se o banco estiver indisponível, o módulo usa `data/ai-module.json` como fallback sem derrubar o bot. O contexto enviado é limitado por quantidade de mensagens e caracteres. Custos são estimados com os preços e cotação definidos no `.env`, e novas chamadas são bloqueadas ao atingir `AI_MONTHLY_BUDGET_BRL`.
