# Prisma — bot de moderação para Discord

Monitora mensagens, remove conteúdo ofensivo, aplica avisos progressivos e registra ações da moderação. Ao atingir o limite de avisos, o membro fica de castigo temporariamente e seus avisos são zerados. A análise por IA é opcional, mas recomendada para entender contexto, preconceito velado e tentativas de burlar palavras-chave.

## Instalação

1. Instale Node.js 22 ou superior e rode `npm install`.
2. Copie `.env.example` para `.env` e preencha `DISCORD_TOKEN` e `DISCORD_CLIENT_ID`.
3. No [Discord Developer Portal](https://discord.com/developers/applications), ative **Message Content Intent** e **Server Members Intent** em Bot → Privileged Gateway Intents.
4. Convide o bot com os escopos `bot` e `applications.commands`. Dê as permissões **View Channels**, **Send Messages**, **Manage Messages** e **Moderate Members**.
5. Rode `npm run dev`.

## Deploy no Render

O arquivo `render.yaml` cria um Web Service pago com build `npm ci && npm run build`, start `npm start`, health check em `/ready` e disco persistente para os arquivos em `DATA_DIR`. Na criação do serviço, preencha as variáveis marcadas como secretas e copie as demais variáveis do `.env` para o painel do Render. Não envie o `.env` para o repositório.

Antes do primeiro deploy, execute `supabase/schema.sql` e todas as migrations pendentes no Supabase. O disco persistente protege os JSONs locais de reinícios, mas não substitui banco de dados para múltiplas instâncias.

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

Com `SUPABASE_URL` e `SUPABASE_SECRET_KEY`, preferências, relacionamento adaptativo, estado emocional/temperamento por pessoa, histórico temporário, métricas e interações espontâneas usam o Supabase. Em instalações novas, execute `supabase/schema.sql`; em bancos existentes, execute as migrations pendentes de `supabase/migrations/` no SQL Editor antes de publicar o novo código.

A personalidade-base da Prisma é fixa e fica versionada em `data/personality/prisma.json` (caminho substituível por `PRISMA_SOUL_PATH`). O arquivo reúne as regras de tom e a referência das regras executadas por `buildRuntimePrompt()` em formato JSON. Usuários não escolhem presets nem scores emocionais: familiaridade, calor, paciência, brincadeira, confiança e temperamento evoluem gradualmente a partir das conversas. O texto do histórico expira em 48 horas, enquanto o resumo da relação, até cinco marcos não sensíveis e o estilo preferido persistem sob validação rígida e cooldown de sete dias. O painel permite apagar o histórico, remover o apelido ou reiniciar a relação, inclusive depois de perder o acesso à IA.

`prisma_memories` é a fonte oficial das preferências e estilos aprendidos. `prisma_user_profiles` funciona somente como cache consolidado dessas memórias; configurações escolhidas pela própria pessoa continuam em `user_settings`, e `prisma_relationships` guarda apenas a evolução do vínculo e seus marcos.

Os campos `interests` e `known_preferences` não são persistidos no perfil: são derivados das memórias ativas durante a leitura. A migration converte valores legados em memórias antes de remover os arrays, evitando perda de dados.

Memórias possuem ciclo de vida: somente registros `active` entram no contexto; mudanças de opinião arquivam a versão anterior como `superseded`, ligam-na à nova por `superseded_by` e preservam quando ela foi confirmada. Registros com `valid_until` vencido passam para `forgotten` durante a limpeza automática.

A validade é renovada quando surge nova evidência: eventos duram 30 dias, projetos 180 dias, memórias sociais/relacionais 365 dias e preferências, interesses, estilos de comunicação e piadas internas 730 dias. Emoções não usam esse prazo porque possuem decaimento próprio.

As mensagens têm ciclos distintos: `conversation_history` retém somente 48 horas para contexto imediato e `prisma_messages` funciona como fila, apagada assim que o dia é resumido. Em `prisma_period_summaries`, os diários com mais de 7 dias viram semanais, os semanais com mais de 90 dias viram mensais e os mensais permanecem por 365 dias.

Para limitar o crescimento do banco, memórias `forgotten` são removidas 180 dias depois da mudança de status e versões `superseded` são removidas depois de 365 dias. Memórias `active` nunca são apagadas diretamente pela retenção: primeiro vencem e passam para `forgotten`.

No Supabase, `save_prisma_daily_summary` salva o resumo e remove as mensagens da fila na mesma transação. `enforce_prisma_retention` centraliza a limpeza periódica das tabelas; o código mantém um fallback compatível enquanto as migrations ainda não tiverem sido aplicadas.

Sem as duas variáveis do Supabase, o módulo usa `data/ai-module.json` em modo local explícito. Com Supabase configurado, uma falha remota não recorre a cópias locais antigas: histórico, preferências e limites falham de forma conservadora. O arquivo local contém dados de usuários, usa permissão restrita e nunca deve ser versionado. O contexto enviado é limitado por 48 horas, quantidade de mensagens e caracteres. Custos são estimados com os preços e cotação definidos no `.env`, e novas chamadas são bloqueadas ao atingir `AI_MONTHLY_BUDGET_BRL`.

## LFG

O painel LFG é publicado como uma mensagem no chat , sem uso de fórum. Use `LFG_PANEL_CHANNEL_ID` apenas se precisar substituir esse canal. As calls temporárias são sempre criadas na categoria configurada pela especificação. O nome segue `🕹️・call-<criador>`, por exemplo `🕹️・call-dscjoaquim`. O módulo persiste sessões em `data/lfg-module.json`; configure opcionalmente `LFG_STAFF_ROLE_ID`, `LFG_MAX_OPEN_PER_USER`, `LFG_CREATE_COOLDOWN_SECONDS`, `LFG_NOW_EXPIRY_MINUTES` e `LFG_VOICE_EMPTY_GRACE_MINUTES`.
