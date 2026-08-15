import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder().setName("avisos").setDescription("Mostra os avisos de um membro")
    .addUserOption((option) => option.setName("membro").setDescription("Membro consultado").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("limpar-avisos").setDescription("Remove todos os avisos de um membro")
    .addUserOption((option) => option.setName("membro").setDescription("Membro perdoado").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
  new SlashCommandBuilder().setName("configurar-prisma").setDescription("Publica o painel único de configuração da IA")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((command) => command.toJSON());
