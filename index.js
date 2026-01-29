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

// --- DATABASE SETUP (CRASH-PROOF) ---
let db;
let dbReady = false;
let configError = null;

const initDatabase = () => {
    try {
        let rawConfig = process.env.FIREBASE_CONFIG || '{}';
        
        // Clean up accidental quotes from Render/env pasting
        if (rawConfig.startsWith("'") && rawConfig.endsWith("'")) {
            rawConfig = rawConfig.slice(1, -1);
        }

        const firebaseConfig = JSON.parse(rawConfig);
        
        if (firebaseConfig.apiKey) {
            const app = initializeApp(firebaseConfig);
            const auth = getAuth(app);
            db = getFirestore(app);

            signInAnonymously(auth)
                .then(() => {
                    console.log("Database Authenticated.");
                    dbReady = true;
                })
                .catch(err => {
                    console.error("Database Auth Failed:", err);
                    configError = "Auth Failed: Enable Anonymous Auth in Firebase.";
                });
        } else {
            configError = "FIREBASE_CONFIG is empty or invalid.";
        }
    } catch (e) {
        console.error("Firebase Init Error:", e);
        configError = `JSON Error: ${e.message}. Check for extra quotes in Render.`;
    }
};

initDatabase();

const appId = 'cliffbot-f45b0'; 

// --- BOT CONFIG ---
const BLACKLISTED_USER_IDS = ['718505488202989678', '787804741924159488'];
const WORD_TO_TRACK = 'nigger';
const TARGET_EMOJI_NAME = 'emoji_9'; 

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

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    const content = message.content.toLowerCase();

    // !debug Command
    if (content === '!debug') {
        const status = dbReady ? "✅ Connected" : `❌ Error: ${configError || "Connecting..."}`;
        return message.reply(`**Bot Debug Info:**\nDB Status: ${status}\nTarget Emoji: \`${TARGET_EMOJI_NAME}\``);
    }

    if (!dbReady) return; 

    // 1. Word Tracking
    if (content.includes(WORD_TO_TRACK)) {
        const userDoc = doc(db, 'artifacts', appId, 'public', 'data', 'wordCounts', message.author.id);
        await setDoc(userDoc, { count: increment(1), username: message.author.username }, { merge: true }).catch(() => null);
    }

    // 2. Blacklist check
    if (content.startsWith('!') && BLACKLISTED_USER_IDS.includes(message.author.id)) {
        return message.reply('🤡');
    }

    // --- COMMANDS ---

    // !emoji9 Command (Paginated Leaderboard)
    if (content.startsWith('!emoji9')) {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard'));
            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));
            scores.sort((a, b) => b.count - a.count);

            if (scores.length === 0) {
                return message.channel.send(`No data for :${TARGET_EMOJI_NAME}: yet.`);
            }

            // Slice into pages of 5, max 15 (3 pages)
            const totalToDisplay = Math.min(scores.length, 15);
            const pagedScores = [];
            for (let i = 0; i < totalToDisplay; i += 5) {
                pagedScores.push(scores.slice(i, i + 5));
            }

            let currentPage = 0;

            const createEmbed = (pageIndex) => {
                const medalEmojis = ['🥇', '🥈', '🥉'];
                const currentData = pagedScores[pageIndex];
                
                const list = currentData.map((s, i) => {
                    const globalIndex = (pageIndex * 5) + i;
                    const rankDisplay = globalIndex < 3 ? medalEmojis[globalIndex] : `\`${globalIndex + 1}.\``;
                    return `${rankDisplay} **${s.username}**: ${s.count} uses`;
                }).join('\n');

                return new EmbedBuilder()
                    .setTitle(`:${TARGET_EMOJI_NAME}: Top Users`)
                    .setDescription(list)
                    .setColor(0xFFA500)
                    .setFooter({ text: `Page ${pageIndex + 1} of ${pagedScores.length} • Top ${totalToDisplay} Users` })
                    .setTimestamp();
            };

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

            const response = await message.channel.send({
                embeds: [createEmbed(currentPage)],
                components: [createButtons(currentPage)]
            });

            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000 
            });

            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) {
                    return i.reply({ content: "Start your own session with !emoji9 to flip pages!", ephemeral: true });
                }
                if (i.customId === 'prev') currentPage--;
                else if (i.customId === 'next') currentPage++;

                await i.update({
                    embeds: [createEmbed(currentPage)],
                    components: [createButtons(currentPage)]
                });
            });

            collector.on('end', () => {
                response.edit({ components: [] }).catch(() => null);
            });

        } catch (e) {
            console.error(e);
            return message.reply("Error loading the leaderboard.");
        }
    }

    // !scoreboard Command
    if (content.startsWith('!scoreboard')) {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'wordCounts'));
            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));
            scores.sort((a, b) => b.count - a.count);
            let sb = `**"${WORD_TO_TRACK}" Rankings:**\n`;
            if (scores.length === 0) sb += "No data yet.";
            else sb += scores.slice(0, 10).map((s, i) => `${i + 1}. **${s.username}**: ${s.count}`).join('\n');
            return message.channel.send(sb);
        } catch (e) {
            return message.reply("Could not load word scoreboard.");
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    
    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TARGET_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
        await setDoc(userEmojiDoc, { count: increment(1), username: user.username }, { merge: true }).catch(() => null);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    
    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TARGET_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
        await setDoc(userEmojiDoc, { count: increment(-1), username: user.username }, { merge: true }).catch(() => null);
    }
});

client.login(process.env.DISCORD_TOKEN);