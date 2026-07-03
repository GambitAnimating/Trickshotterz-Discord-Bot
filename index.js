import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    MessageFlags
} from 'discord.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const cooldowns = new Map();
const COOLDOWN = 30 * 60 * 1000;

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

async function sendMatchmakingWelcome(channel, member) {
    const message = await channel.send(
`👋 Welcome ${member}!

Whenever you want to play, use:
\`\`\`
/matchmaking
\`\`\`
*(This message will disappear in 1 minute.)*`
    );

    setTimeout(() => {
        message.delete().catch(() => {});
    }, 60 * 1000);
}


// client.on(Events.GuildMemberAdd, async (joinedMember) => {
//     const roleId = process.env.MATCHMAKING_ROLE_ID;
//     console.log(`New member joined! ${joinedMember.displayName}`);

//      if (!joinedMember.roles.cache.has(roleId)
//     ) {
//         return;
//     }

//     const channel = await client.channels.fetch(
//         process.env.MATCHMAKING_CHANNEL_ID
//     );

//     if (!channel?.isTextBased()) return;

//     await sendMatchmakingWelcome(channel, joinedMember);
// })

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const roleId = process.env.MATCHMAKING_ROLE_ID;
    if (
        oldMember.roles.cache.has(roleId) ||
        !newMember.roles.cache.has(roleId)
    ) {
        return;
    }

    const channel = await client.channels.fetch(
        process.env.MATCHMAKING_CHANNEL_ID
    );

    if (!channel?.isTextBased()) return;

   await sendMatchmakingWelcome(channel, newMember);
});

client.on(Events.InteractionCreate, async interaction => {

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName !== "matchmaking") return;

    if (interaction.channelId !== process.env.MATCHMAKING_CHANNEL_ID) {
        return interaction.reply({
            content: "Please use this command in the matchmaking channel.",
            flags: MessageFlags.Ephemeral
        });
    }

    const now = Date.now();

    const lastUse = cooldowns.get(interaction.user.id);

    if (lastUse && now - lastUse < COOLDOWN) {

        const remaining =
            Math.ceil((COOLDOWN - (now - lastUse)) / 60000);

        return interaction.reply({
            content: `You can notify matchmaking again in ${remaining} minute(s).`,
            flags: MessageFlags.Ephemeral
        });
    }

    cooldowns.set(interaction.user.id, now);

    const message =
        interaction.options.getString("message");

    const roleMention =
        `<@&${process.env.MATCHMAKING_ROLE_ID}>`;

    const sent = await interaction.channel.send({

        content:
`${roleMention}

🎮 **${interaction.user.displayName}** is looking for people to play Trickshotterz!

${message ?? ""}`
    });

    setTimeout(() => {
        sent.delete().catch(() => {});
    }, COOLDOWN);

    await interaction.reply({
        content: "Matchmaking notification sent!",
        flags: MessageFlags.Ephemeral
    });
});

client.login(process.env.TOKEN);