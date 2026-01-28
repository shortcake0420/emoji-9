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

// --- DATABASE SETUP ---
let db;
let dbReady = false;
let configError = null;

try {
    let rawConfig = process.env.FIREBASE_CONFIG || '{}';
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
                configError = "Auth Failed: Check Anonymous Auth in Firebase.";
            });
    } else {
        configError = "FIREBASE_CONFIG is empty or invalid.";
    }
} catch (e) {
    console.error("Firebase Init Error:", e);
    configError = `JSON Parse Error: ${e.message}.`;
}

const appId = 'cliffbot-f45b0'; 

// --- CONFIG ---
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

    // !debug - Checks if the bot is healthy
    if (content === '!debug') {
        const status = dbReady ? "✅ Connected" : `❌ Error: ${configError || "Connecting..."}`;
        return message.reply(`**Bot Debug Stats:**\nDatabase Status: ${status}\nTracking Emoji: \`${TARGET_EMOJI_NAME}\``);
    }

    if (!dbReady) return; 

    // Tracking word usage
    if (content.includes(WORD_TO_TRACK)) {
        const userDoc = doc(db, 'artifacts', appId, 'public', 'data', 'wordCounts', message.author.id);
        await setDoc(userDoc, { count: increment(1), username: message.author.username }, { merge: true });
    }

    // Tracking emoji name mentioned in text
    if (content.includes(TARGET_EMOJI_NAME.toLowerCase())) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', message.author.id);
        await setDoc(userEmojiDoc, { count: increment(1), username: message.author.username }, { merge: true });
    }

    // !emoji9 Command with Pagination and Medals
    if (content.startsWith('!emoji9')) {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard'));
            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));
            scores.sort((a, b) => b.count - a.count);

            if (scores.length === 0) {
                return message.channel.send("No usage data found yet. Get to reactin'!");
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
                    .setTitle(`:${TARGET_EMOJI_NAME}: Elite Leaderboard`)
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

            // Collector to handle button clicks
            const collector = response.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 60000 // Buttons expire after 60 seconds
            });

            collector.on('collect', async i => {
                if (i.user.id !== message.author.id) {
                    return i.reply({ content: "Run the command yourself to flip pages!", ephemeral: true });
                }

                if (i.customId === 'prev') currentPage--;
                else if (i.customId === 'next') currentPage++;

                await i.update({
                    embeds: [createEmbed(currentPage)],
                    components: [createButtons(currentPage)]
                });
            });

            collector.on('end', () => {
                response.edit({ components: [] }).catch(() => null); // Remove buttons when expired
            });

        } catch (e) {
            console.error(e);
            return message.reply("Database error fetching leaderboard.");
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
            else scores.slice(0, 10).forEach((s, i) => sb += `${i + 1}. **${s.username}**: ${s.count}\n`);
            return message.channel.send(sb);
        } catch (e) {
            return message.reply("Could not load scoreboard.");
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    
    // Global emoji tracking
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const globalEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emojiUsage', emojiKey);
    await setDoc(globalEmojiDoc, { count: increment(1) }, { merge: true });

    // Specific emoji_9 tracking
    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TARGET_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
        await setDoc(userEmojiDoc, { count: increment(1), username: user.username }, { merge: true });
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => null);
    
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const globalEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emojiUsage', emojiKey);
    await setDoc(globalEmojiDoc, { count: increment(-1) }, { merge: true });

    if (reaction.emoji.name && reaction.emoji.name.toLowerCase() === TARGET_EMOJI_NAME.toLowerCase()) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
        await setDoc(userEmojiDoc, { count: increment(-1), username: user.username }, { merge: true });
    }
});

client.login(process.env.DISCORD_TOKEN);