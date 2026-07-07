import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Events,
    MessageFlags,
    AuditLogEvent
} from 'discord.js';
import express from "express";

import fs from "fs";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const banWatchHistory = new Map();

const BAN_LIMIT = 1;
const BAN_WINDOW = 10 * 60 * 1000; // 10 minutes
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const MOD_TEST_USER = "1524061718215655455";
const ADMIN_ALERT_CHANNEL_ID = process.env.ADMIN_ALERT_CHANNEL_ID;

function recordBanAndCheckLimit(moderatorId) {
    const now = Date.now();

    const recentBans = (banWatchHistory.get(moderatorId) ?? [])
        .filter(time => now - time < BAN_WINDOW);

    recentBans.push(now);
    banWatchHistory.set(moderatorId, recentBans);

    return recentBans.length === BAN_LIMIT;
}

const mentionCooldowns = new Map();
const MENTION_COOLDOWN = 2 * 60 * 1000; // 2 minutes

const activeGames = new Map();

const cooldowns = new Map();
const COOLDOWN = 30 * 60 * 1000;

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.GuildBanAdd, async (ban) => {
    try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const logs = await ban.guild.fetchAuditLogs({
            type: AuditLogEvent.MemberBanAdd,
            limit: 1
        });

        const entry = logs.entries.first();

        if (!entry?.executor) return;
        if (String(entry.target?.id) !== ban.user.id) return;

        const moderatorId = entry.executor.id;

        // Ignore Owner
        if (moderatorId === process.env.OWNER_USER_ID) return;

        // Ignore bot/self bans if needed
        if (entry.executor.bot) return;

        const moderatorMember = await ban.guild.members
            .fetch(moderatorId)
            .catch(() => null);

        if (!moderatorMember) return;

        // Only watch people with your Moderator role
        if (!moderatorMember.roles.cache.has(MOD_ROLE_ID)) return;

        const limitHit = recordBanAndCheckLimit(moderatorId);

        if (!limitHit) return;

        // Temporarily remove mod role
        // await moderatorMember.roles.remove(
        //     MOD_ROLE_ID,
        //     "Automatic safety lock: ban rate limit exceeded."
        // );

        const testMember = await ban.guild.members
            .fetch(MOD_TEST_USER)
            .catch(() => null);

        if (!testMember) {
            console.log("Could not find test moderator.");
            return;
        }

        await testMember.roles.remove(
            MOD_ROLE_ID,
            "Testing automatic moderator removal."
        );



        const alertChannel = await client.channels.fetch(ADMIN_ALERT_CHANNEL_ID)
            .catch(() => null);

        if (alertChannel?.isTextBased()) {
            await alertChannel.send(
`<@${process.env.OWNER_USER_ID}>

🚨 **Potential moderator compromise detected**

👮 Moderator: ${moderatorMember}
🆔 ${moderatorMember.id}

🔨 Recent ban count: ${banWatchHistory.get(moderatorId).length}

❌ Latest banned user: ${ban.user}

⛔ Moderator role has been removed automatically.

Please review the Audit Log.`
            );
        }

        console.log(
            `[SAFETY LOCK] Removed mod role from ${moderatorMember.user.tag} for excessive bans.`
        );
    } catch (error) {
        console.log("GuildBanAdd watchdog error:", error);
    }
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

client.on(Events.GuildMemberAdd, async (joinedMember) => {
    const roleId = process.env.MATCHMAKING_ROLE_ID;
    console.log(`New member joined! ${joinedMember.displayName}`);

     if (!joinedMember.roles.cache.has(roleId)
    ) {
        return;
    }

    const channel = await client.channels.fetch(
        process.env.MATCHMAKING_CHANNEL_ID
    );

    if (!channel?.isTextBased()) return;

    await sendMatchmakingWelcome(channel, joinedMember);
})

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (!client.user) return;
    if (!message.mentions.has(client.user)) return;
    if (message.channelId !== process.env.MATCHMAKING_CHANNEL_ID) return;

    const now = Date.now();
    const lastUse = mentionCooldowns.get(message.author.id);

    if (lastUse && now - lastUse < MENTION_COOLDOWN) {
        return;
    }

    mentionCooldowns.set(message.author.id, now);

setTimeout(() => {
    mentionCooldowns.delete(message.author.id);
}, MENTION_COOLDOWN);

    const reply = await message.reply(
`**:wave: Looking for people to play?**

Use:
\`\`\`
/matchmaking
\`\`\`
You can optionally include a short message like:
> "Need 1 more for 2v2!"

*(This tip will disappear in 1 minute.)*`
    );

    setTimeout(() => {
        reply.delete().catch(() => {});
    }, 60 * 1000);
});

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "matchmaking") return;

    try {
        if (interaction.channelId !== process.env.MATCHMAKING_CHANNEL_ID) {
            return interaction.reply({
                content: "Please use this command in the matchmaking channel.",
                flags: MessageFlags.Ephemeral
            });
        }

        const now = Date.now();
        const lastUse = cooldowns.get(interaction.user.id);

        if (lastUse && now - lastUse < COOLDOWN) {
            const remaining = Math.ceil((COOLDOWN - (now - lastUse)) / 60000);

            return interaction.reply({
                content: `You can notify matchmaking again in ${remaining} minute(s).`,
                flags: MessageFlags.Ephemeral
            });
        }

        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        cooldowns.set(interaction.user.id, now);

setTimeout(() => {
    cooldowns.delete(interaction.user.id);
}, COOLDOWN);

        const message = interaction.options.getString("message");
        const roleMention = `<@&${process.env.MATCHMAKING_ROLE_ID}>`;
        const displayName = interaction.member?.displayName ?? interaction.user.username;

        const sent = await interaction.channel.send({
            content:
`${roleMention}

🎮 **${displayName}** is looking for people to play Trickshotterz!

${message ?? ""}`
        });

        setTimeout(() => {
            sent.delete().catch(() => {});
        }, COOLDOWN);

        await interaction.editReply({
            content: "Matchmaking notification sent!"
        });
    } catch (error) {
        console.log("Matchmaking command error:", error);

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
                content: "Something went wrong sending the matchmaking notification."
            }).catch(() => {});
        }
    }
});

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

const STATUS_FILE = "./match-status.json";

function loadMatchStatusMessageId() {
    try {
        if (!fs.existsSync(STATUS_FILE)) return null;

        const data = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
        return data.matchStatusMessageId ?? null;
    } catch {
        return null;
    }
}

function saveMatchStatusMessageId(messageId) {
    fs.writeFileSync(
        STATUS_FILE,
        JSON.stringify({ matchStatusMessageId: messageId }, null, 2)
    );
}

let matchStatusMessageId = loadMatchStatusMessageId();

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
    saveMatchStatusMessageId(message.id);
}

function buildMatchStatusMessage() {
    if (activeGames.size === 0) {
        return `🎮 **Trickshotterz Match Status** *(Live Updated)*

No public matches are currently open.`;
    }

    const games = [...activeGames.values()]
        .map((game, index) =>
`**${index + 1}. ${game.displayName}**
> 🌎 Region: **${game.region}**
> 👥 Players: **${game.players?.size ?? 0}**`
        )
        .join("\n\n");

    return `🎮 **Trickshotterz Match Status** *(Live Updated)*

**Active Matches:** ${activeGames.size}
${games}`;
}

function getPhotonPlayerKey(body) {
    return String(
        body?.UserId ?? "unknown"
    );
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
            players: new Set(),
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

        if (!existed) {
            console.log(`CloseGame for untracked game: ${gameId}`);
            return;
        }

        await updateMatchStatusMessage();

        console.log(
            `Game closed: ${gameId}. Active games: ${activeGames.size}`
        );
    } catch (error) {
        console.log("CloseGame webhook error:", error);
    }
});

app.post("/photon/player/added", async (req, res) => {
    res.status(200).json({});

    try {
        if (!isValidPhotonRequest(req)) {
            console.log("Rejected invalid PlayerAdded webhook.");
            return;
        }

        const gameId = getPhotonGameId(req.body);

        if (!gameId) {
            console.log("PlayerAdded missing game id:", req.body);
            return;
        }

        const game = activeGames.get(gameId);

        if (!game) {
            console.log(`PlayerAdded for unknown game: ${gameId}`);
            return;
        }

        const playerKey = getPhotonPlayerKey(req.body);
        const before = game.players.size;
        game.players.add(playerKey);

        if (game.players.size !== before) {
            await updateMatchStatusMessage();
        }

        console.log(
            `Player added to ${gameId}. Players: ${game.players.size}`
        );
    } catch (error) {
        console.log("PlayerAdded webhook error:", error);
    }
});

app.post("/photon/player/removed", async (req, res) => {
    res.status(200).json({});

    try {
        if (!isValidPhotonRequest(req)) {
            console.log("Rejected invalid PlayerRemoved webhook.");
            return;
        }

        const gameId = getPhotonGameId(req.body);

        if (!gameId) {
            console.log("PlayerRemoved missing game id:", req.body);
            return;
        }

        const game = activeGames.get(gameId);

        if (!game) {
            console.log(`PlayerRemoved for unknown game: ${gameId}`);
            return;
        }

        const playerKey = getPhotonPlayerKey(req.body);
        const before = game.players.size;
        game.players.delete(playerKey);

        if (game.players.size !== before) {
            await updateMatchStatusMessage();
        }

        console.log(
            `Player removed from ${gameId}. Players: ${game.players.size}`
        );
    } catch (error) {
        console.log("PlayerRemoved webhook error:", error);
    }
});

app.listen(PORT, () => {
    console.log(`Health server listening on port ${PORT}`);
});

client.login(process.env.TOKEN);