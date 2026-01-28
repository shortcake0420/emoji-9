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

    // 1. Word Tracking (Nigger)
    if (content.includes(WORD_TO_TRACK)) {
        const userDoc = doc(db, 'artifacts', appId, 'public', 'data', 'wordCounts', message.author.id);
        await setDoc(userDoc, { count: increment(1), username: message.author.username }, { merge: true });
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
                return message.channel.send(`No one has used :${TARGET_EMOJI_NAME}: enough to be ranked yet.`);
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
                        .setDisabled(pageIndex ===