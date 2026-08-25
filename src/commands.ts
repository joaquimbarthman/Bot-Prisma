import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("rank").setDescription("Mostra a evolucao de um membro")
    .addUserOption((option) => option.setName("membro").setDescription("Membro consultado")),
  new SlashCommandBuilder().setName("avisos").setDescription("Mostra os avisos de um membro")
    .addUserOption((option) => option.setName("membro").setDescription("Membro consultado").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("limpar-avisos").setDescription("Remove todos os avisos de um membro")
    .addUserOption((option) => option.setName("membro").setDescription("Membro perdoado").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("configurar-prisma").setDescription("Publica o painel único de configuração da IA")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("teste-ai").setDescription("Ativa o modo de testes da Prisma IA")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("fim-teste-ai").setDescription("Desativa o modo de testes da Prisma IA")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName("set-pensamento").setDescription("Define o pensamento atual da Prisma")
    .addStringOption((option) => option.setName("texto").setDescription("Pensamento exibido no status da Prisma").setMinLength(1).setMaxLength(128).setRequired(true)),
  new SlashCommandBuilder().setName("clear-pensamento").setDescription("Apaga o pensamento atual da Prisma"),
].map((command) => command.toJSON());
