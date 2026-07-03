import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
    new SlashCommandBuilder()
        .setName("matchmaking")
        .setDescription("Notify players you're looking for a game.")
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Optional message")
                .setRequired(false)
        )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

await rest.put(
    Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
    ),
    { body: commands }
);

console.log("Slash commands deployed.");