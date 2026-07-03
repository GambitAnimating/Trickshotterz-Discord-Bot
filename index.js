import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    MessageFlags
} from 'discord.js';
import express from "express";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const activeGames = new Map();

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

async function sendMatchActivityMessage(content) {
    const channel = await client.channels.fetch(
        process.env.MATCH_ACTIVITY_CHANNEL_ID
    );

    if (!channel?.isTextBased()) return;

    await channel.send({ content });
}

function getRoomOptions(body) {
    return body?.EnterRoomParams?.RoomOptions;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
    res.send("Trickshotterz Discord Bot is running!");
});

function isValidPhotonRequest(req) {
    const expectedSecret = process.env.PHOTON_WEBHOOK_SECRET;

    if (!expectedSecret) return true; // okay for local testing only

    return req.headers["x-secretkey"] === expectedSecret;
}

function getPhotonGameId(body) {
    return (
        body?.GameId ??
        body?.GameID ??
        body?.gameId ??
        body?.RoomName ??
        body?.roomName
    );
}

function isJoinableRoom(body) {
    const roomOptions = body?.EnterRoomParams?.RoomOptions;

    if (!roomOptions) {
        console.log("Ignoring room with no RoomOptions.");
        return false;
    }

    if (roomOptions.IsVisible !== true) {
        console.log("Ignoring invisible room.");
        return false;
    }

    if (roomOptions.IsOpen !== true) {
        console.log("Ignoring closed room.");
        return false;
    }

    const expectedUsers = body?.EnterRoomParams?.ExpectedUsers;

    if (Array.isArray(expectedUsers) && expectedUsers.length > 0) {
        console.log("Ignoring invite/private room.");
        return false;
    }

    return true;
}

let matchStatusMessageId = null;

async function updateMatchStatusMessage() {
    const channel = await client.channels.fetch(
        process.env.MATCH_ACTIVITY_CHANNEL_ID
    );

    if (!channel?.isTextBased()) return;

    const content = buildMatchStatusMessage();

    if (matchStatusMessageId) {
        try {
            const existing = await channel.messages.fetch(matchStatusMessageId);
            await existing.edit({ content });
            return;
        } catch {
            matchStatusMessageId = null;
        }
    }

    const message = await channel.send({ content });
    matchStatusMessageId = message.id;
}

function buildMatchStatusMessage() {
    if (activeGames.size === 0) {
        return `# :video_game: Trickshotterz Match Status (Live Updated)
        No public matches are currently open.`;
    }

    const games = [...activeGames.values()]
        .map((game, index) =>
`**${index + 1}. ${game.displayName}**
    🌎 Region: ${game.region}`)
        .join("\n");

    return `# :video_game: Trickshotterz Match Status (Live Updated)
    
    **Active Matches:** ${activeGames.size}
    
    ${games}`;
}


app.post("/photon/game/create", async (req, res) => {
    res.status(200).json({});

    try {
        if (!isValidPhotonRequest(req)) {
            console.log("Rejected invalid CreateGame webhook.");
            return;
        }

        if (!isJoinableRoom(req.body)) return;

        const gameId = getPhotonGameId(req.body);

        if (!gameId) {
            console.log("CreateGame missing game id:", req.body);
            return;
        }

        const roomOptions = getRoomOptions(req.body);
        const props = roomOptions?.CustomRoomProperties ?? {};

        const region = req.body?.Region ?? "unknown";
        const displayName = props.displayName ?? "Unnamed Room";

        activeGames.set(gameId, {
            createdAt: Date.now(),
            region,
            displayName,
            data: req.body
        });

        await updateMatchStatusMessage();

        console.log(`Game created: ${gameId}. Active games: ${activeGames.size}`);
        console.dir(req.body, { depth: null });
    } catch (error) {
        console.log("CreateGame webhook error:", error);
    }
});

app.post("/photon/game/close", async (req, res) => {
    res.status(200).json({});

    try {
        if (!isValidPhotonRequest(req)) {
            console.log("Rejected invalid CloseGame webhook.");
            return;
        }

        const gameId = getPhotonGameId(req.body);

        if (!gameId) {
            console.log("CloseGame missing game id:", req.body);
            return;
        }

        const existed = activeGames.delete(gameId);

        await updateMatchStatusMessage();

        console.log(
            `Game closed: ${gameId}. Existed: ${existed}. Active games: ${activeGames.size}`
        );
    } catch (error) {
        console.log("CloseGame webhook error:", error);
    }
});

app.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.TOKEN);