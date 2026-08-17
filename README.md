# Prisma — bot de moderação para Discord

Monitora mensagens, remove conteúdo ofensivo, aplica avisos progressivos e registra ações da moderação. Ao atingir o limite de avisos, o membro fica de castigo temporariamente e seus avisos são zerados. A análise por IA é opcional, mas recomendada para entender contexto, preconceito velado e tentativas de burlar palavras-chave.

## Instalação

1. Instale Node.js 22 ou superior e rode `npm install`.
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
- `LOG_MONITORED_MESSAGES=true` exibe no terminal cada mensagem verificada e o resultado. O texto fica oculto por padrão; mantenha `LOG_MESSAGE_CONTENT=false` em produção.
- Avisos ficam em `data/warnings.json`. Para vários servidores ou alta escala, migre para SQLite/PostgreSQL.

## Prisma IA

O módulo isolado fica em `src/modules/ai/`. Somente membros com o cargo definido em `AI_ACCESS_ROLE_ID` podem gerar chamadas. Boosters recebem esse cargo automaticamente; o bot precisa de **Gerenciar cargos** e seu cargo deve ficar acima do cargo de acesso na hierarquia. Configure `AI_GENERAL_CHANNEL_ID` e `AI_PANEL_CHANNEL_ID`, reinicie o bot e use `/configurar-prisma` para publicar o painel único.

Com `SUPABASE_URL` e `SUPABASE_SECRET_KEY`, preferências, relacionamento adaptativo, temperamento, histórico temporário, métricas e interações espontâneas usam o Supabase. Em instalações novas, execute `supabase/schema.sql`; em bancos existentes, execute as migrations pendentes de `supabase/migrations/` no SQL Editor antes de publicar o novo código.

A personalidade-base da Prisma é fixa e fica versionada em `personality/soul.md` (caminho substituível por `PRISMA_SOUL_PATH`). Usuários não escolhem presets nem scores emocionais: familiaridade, calor, paciência, brincadeira, confiança e temperamento evoluem gradualmente a partir das conversas. O texto do histórico expira em 48 horas, enquanto o resumo da relação, até cinco marcos não sensíveis e o estilo preferido persistem sob validação rígida e cooldown de sete dias. As regras executadas por `buildRuntimePrompt()` estão documentadas em `personality/OPERATIONS.md`. O painel permite apagar o histórico, remover o apelido ou reiniciar a relação, inclusive depois de perder o acesso à IA.

Sem as duas variáveis do Supabase, o módulo usa `data/ai-module.json` em modo local explícito. Com Supabase configurado, uma falha remota não recorre a cópias locais antigas: histórico, preferências e limites falham de forma conservadora. O arquivo local contém dados de usuários, usa permissão restrita e nunca deve ser versionado. O contexto enviado é limitado por 48 horas, quantidade de mensagens e caracteres. Custos são estimados com os preços e cotação definidos no `.env`, e novas chamadas são bloqueadas ao atingir `AI_MONTHLY_BUDGET_BRL`.

## LFG

O painel LFG é publicado como uma mensagem no chat `1538659348631519303`, sem uso de fórum. Use `LFG_PANEL_CHANNEL_ID` apenas se precisar substituir esse canal. As calls temporárias são sempre criadas na categoria configurada pela especificação. O nome segue `🕹️・call-<criador>`, por exemplo `🕹️・call-dscjoaquim`. O módulo persiste sessões em `data/lfg-module.json`; configure opcionalmente `LFG_STAFF_ROLE_ID`, `LFG_MAX_OPEN_PER_USER`, `LFG_CREATE_COOLDOWN_SECONDS`, `LFG_NOW_EXPIRY_MINUTES` e `LFG_VOICE_EMPTY_GRACE_MINUTES`.
