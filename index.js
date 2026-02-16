import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDocs, collection, increment } from 'firebase/firestore';
import 'dotenv/config';

// ==========================================
// DATABASE SETUP (CRASH-PROOF)
// ==========================================
let db;
let dbReady = false;
let configError = null;

const initDatabase = () => {
    try {
        // Parse Firebase config from environment variable
        let rawConfig = process.env.FIREBASE_CONFIG || '{}';

        // Remove extra quotes that some hosting platforms add
        if (rawConfig.startsWith("'") && rawConfig.endsWith("'")) {
            rawConfig = rawConfig.slice(1, -1);
        }

        const firebaseConfig = JSON.parse(rawConfig);

        if (firebaseConfig.apiKey) {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            db = getFirestore(app);

            // Authenticate anonymously with Firebase
            signInAnonymously(auth)
                .then(() => {
                    console.log("✅ Database Authenticated.");
                    dbReady = true;
                })
                .catch(err => {
                    console.error("❌ Database Auth Failed:", err);
                    configError = "Auth Failed: Enable Anonymous Auth in Firebase.";
                });
        } else {
            configError = "FIREBASE_CONFIG is empty or invalid.";
        }
    } catch (e) {
        console.error("❌ Firebase Init Error:", e);
        configError = `JSON Error: ${e.message}. Check for extra quotes in Render.`;
    }
};

initDatabase();

const FIREBASE_APP_ID = 'cliffbot-f45b0';

// ==========================================
// BOT CONFIGURATION
// ==========================================
const BLACKLISTED_USER_IDS = ['718505488202989678', '787804741924159488'];
const TRACKED_WORD = 'nigger'; // Word to track for scoreboard
const TRACKED_EMOJI_NAME = 'emoji_9'; // Custom emoji to track for leaderboard

// Special GIF trigger - sends GIF when a specific user's message gets 3 reactions
const SPECIAL_GIF_TARGET_USER_ID = '569277281046888488';
const COOKING_GIF_URL = 'https://foulplayscom.wordpress.com/wp-content/uploads/2025/07/pmcookin.gif';

// Track which messages have already triggered the special GIF (to prevent spam)
const gifTriggeredMessages = new Set();

// ==========================================
// DISCORD CLIENT INITIALIZATION
// ==========================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

// ==========================================
// EVENT: MESSAGE CREATE
// ==========================================
client.on(Events.MessageCreate, async message => {
    // Ignore messages from bots
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    // --- DEBUG COMMAND ---
    if (content === '!debug') {
        const status = dbReady
            ? "✅ Connected"
            : `❌ Error: ${configError || "Connecting..."}`;

        return message.reply(
            `**Bot Debug Info:**\n` +
            `DB Status: ${status}\n` +
            `Target Emoji: \`${TRACKED_EMOJI_NAME}\``
        );
    }

    // Don't process other commands if database isn't ready
    if (!dbReady) return;

    // --- TRACKED WORD DETECTION & REACTION ---
    // When someone says the tracked word, react with the custom emoji and increment their count
    if (content.includes(TRACKED_WORD)) {
        // Update word count in database
        const userWordCountDoc = doc(
            db,
            'artifacts', FIREBASE_APP_ID, 'public', 'data', 'wordCounts',
            message.author.id
        );

        await setDoc(
            userWordCountDoc,
            { count: increment(1), username: message.author.username },
            { merge: true }
        ).catch(() => null);

        // React with the custom emoji (or fallback to sad face if not found)
        try {
            const customEmoji = message.guild?.emojis.cache.find(
                emoji => emoji.name === TRACKED_EMOJI_NAME
            );

            if (customEmoji) {
                await message.react(customEmoji);
            } else {
                await message.react('😢');
            }
        } catch (error) {
            console.error("Could not react to message:", error);
        }
    }

    // --- BLACKLIST CHECK ---
    // Blacklisted users get clowned when they try to use commands
    if (content.startsWith('!') && BLACKLISTED_USER_IDS.includes(message.author.id)) {
        return message.reply('🤡');
    }

    // ==========================================
    // COMMAND: !emoji9 (Paginated Leaderboard)
    // ==========================================
    if (content.startsWith('!emoji9')) {
        try {
            // Fetch all emoji usage data from database
            const querySnapshot = await getDocs(
                collection(db, 'artifacts', FIREBASE_APP_ID, 'public', 'data', 'emoji9Leaderboard')
            );

            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));

            // Sort by count (highest first)
            scores.sort((a, b) => b.count - a.count);

            if (scores.length === 0) {
                return message.channel.send(`No data for :${TRACKED_EMOJI_NAME}: yet.`);
            }

            // Display top 15, split into pages of 5
            const totalToDisplay = Math.min(scores.length, 15);
            const pagedScores = [];

            for (let i = 0; i < totalToDisplay; i += 5) {
                pagedScores.push(scores.slice(i, i + 5));
            }

            let currentPage = 0;

            // Create embed for a specific page
            const createEmbed = (pageIndex) => {
                const medalEmojis = ['🥇', '🥈', '🥉'];
                const currentData = pagedScores[pageIndex];

                const leaderboardList = currentData.map((score, indexInPage) => {
                    const globalIndex = (pageIndex * 5) + indexInPage;
                    const rankDisplay = globalIndex < 3
                        ? medalEmojis[globalIndex]
                        : `\`${globalIndex + 1}.\``;

                    return `${rankDisplay} **${score.username}**: ${score.count} uses`;
                }).join('\n');

                return new EmbedBuilder()
                    .setTitle(`:${TRACKED_EMOJI_NAME}: Top Users`)
                    .setDescription(leaderboardList)
                    .setColor(0xFFA500)
                    .setFooter({
                        text: `Page ${pageIndex + 1} of ${pagedScores.length} • Top ${totalToDisplay} Users`
                    })
                    .setTimestamp();
            };

            // Create navigation buttons for a specific page
            const createButtons = (pageIndex) => {
                return new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('prev')
                        .setLabel('Previous')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(pageIndex === 0),
                    new ButtonBuilder()
                        .setCustomId('next')
                        .setLabel('Next')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(pageIndex === pagedScores.length - 1)
                );
            };

            // Send initial message with embed and buttons
            const response = await message.channel.send({
                embeds: [createEmbed(currentPage)],
                components: [createButtons(currentPage)]
            });

            // Create button interaction collector (1 minute timeout)
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000
            });

            // Handle button clicks
            collector.on('collect', async interaction => {
                // Only the person who ran the command can use the buttons
                if (interaction.user.id !== message.author.id) {
                    return interaction.reply({
                        content: "Start your own session with !emoji9 to flip pages!",
                        ephemeral: true
                    });
                }

                // Update current page based on button clicked
                if (interaction.customId === 'prev') {
                    currentPage--;
                } else if (interaction.customId === 'next') {
                    currentPage++;
                }

                // Update the message with new page
                await interaction.update({
                    embeds: [createEmbed(currentPage)],
                    components: [createButtons(currentPage)]
                });
            });

            // Remove buttons after timeout
            collector.on('end', () => {
                response.edit({ components: [] }).catch(() => null);
            });

        } catch (error) {
            console.error("Error loading emoji9 leaderboard:", error);
            return message.reply("Error loading the leaderboard.");
        }
    }

    // ==========================================
    // COMMAND: !scoreboard (Tracked Word Rankings)
    // ==========================================
    if (content.startsWith('!scoreboard')) {
        try {
            // Fetch all word count data from database
            const querySnapshot = await getDocs(
                collection(db, 'artifacts', FIREBASE_APP_ID, 'public', 'data', 'wordCounts')
            );

            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));

            // Sort by count (highest first)
            scores.sort((a, b) => b.count - a.count);

            // Build scoreboard message
            let scoreboard = `**"${TRACKED_WORD}" Rankings:**\n`;

            if (scores.length === 0) {
                scoreboard += "No data yet.";
            } else {
                scoreboard += scores
                    .slice(0, 10)
                    .map((score, index) => `${index + 1}. **${score.username}**: ${score.count}`)
                    .join('\n');
            }

            return message.channel.send(scoreboard);
        } catch (error) {
            console.error("Error loading word scoreboard:", error);
            return message.reply("Could not load word scoreboard.");
        }
    }
});

// ==========================================
// EVENT: REACTION ADD
// ==========================================
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    // Ignore bot reactions and wait for database
    if (!dbReady || user.bot) return;

    // Fetch full reaction/message data if it's partial
    if (reaction.partial) {
        await reaction.fetch().catch(() => null);
    }
    if (reaction.message.partial) {
        await reaction.message.fetch().catch(() => null);
    }

    // --- SPECIAL GIF TRIGGER (FIXED) ---
    // Send GIF when a specific user's message reaches exactly 3 reactions (only once)
    if (reaction.message.author.id === SPECIAL_GIF_TARGET_USER_ID) {
        const messageId = reaction.message.id;

        // Calculate total reactions on the message
        const totalReactionCount = reaction.message.reactions.cache.reduce(
            (total, currentReaction) => total + currentReaction.count,
            0
        );

        // Only trigger if count is exactly 3 AND we haven't sent the GIF for this message yet
        if (totalReactionCount === 3 && !gifTriggeredMessages.has(messageId)) {
            gifTriggeredMessages.add(messageId); // Mark this message as triggered

            try {
                await reaction.message.reply(COOKING_GIF_URL);
                console.log(`🎯 Special GIF sent for message ${messageId}`);
            } catch (error) {
                console.error("Could not send special GIF:", error);
            }
        }
    }

    // --- EMOJI LEADERBOARD TRACKING ---
    // Increment user's count when they use the tracked emoji
    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TRACKED_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(
            db,
            'artifacts', FIREBASE_APP_ID, 'public', 'data', 'emoji9Leaderboard',
            user.id
        );

        await setDoc(
            userEmojiDoc,
            { count: increment(1), username: user.username },
            { merge: true }
        ).catch(() => null);
    }
});

// ==========================================
// EVENT: REACTION REMOVE
// ==========================================
client.on(Events.MessageReactionRemove, async (reaction, user) => {
    // Ignore bot reactions and wait for database
    if (!dbReady || user.bot) return;

    // Fetch full reaction data if partial
    if (reaction.partial) {
        await reaction.fetch().catch(() => null);
    }

    // --- EMOJI LEADERBOARD TRACKING ---
    // Decrement user's count when they remove the tracked emoji
    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TRACKED_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(
            db,
            'artifacts', FIREBASE_APP_ID, 'public', 'data', 'emoji9Leaderboard',
            user.id
        );

        await setDoc(
            userEmojiDoc,
            { count: increment(-1), username: user.username },
            { merge: true }
        ).catch(() => null);
    }
});

// ==========================================
// BOT LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
