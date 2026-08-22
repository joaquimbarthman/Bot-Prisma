# Instruções do repositório

## Alterações na IA da Prisma

Toda alteração funcional em `src/modules/ai/**` deve, obrigatoriamente, atualizar também `src/modules/ai/version.ts` no mesmo trabalho:

- incremente `PRISMA_AI_VERSION` para uma nova versão;
- descreva a mudança em `PRISMA_AI_LATEST_UPDATE`, em linguagem clara para as pessoas que usam a Prisma;
- atualize `PRISMA_AI_CAPABILITIES` quando a alteração criar ou modificar uma capacidade que a Prisma pode apresentar;
- não anuncie recursos que ainda não estejam implementados e validados;
- considere a alteração incompleta enquanto versão e novidades não tiverem sido atualizadas.

