import { Client, Events, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDocs, collection, increment } from 'firebase/firestore';
import 'dotenv/config';

// --- DATABASE SETUP ---
let db;
let dbReady = false;
let configError = null;

try {
    const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
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
                configError = "Auth Failed: Check if Anonymous Auth is enabled in Firebase.";
            });
    } else {
        configError = "FIREBASE_CONFIG is empty or invalid.";
    }
} catch (e) {
    console.error("Firebase Init Error:", e);
    configError = "JSON Parse Error: Your FIREBASE_CONFIG environment variable is malformed.";
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

    // !emoji9 Command
    if (content.startsWith('!emoji9')) {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard'));
            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));
            scores.sort((a, b) => b.count - a.count);

            const embed = new EmbedBuilder()
                .setTitle(`:${TARGET_EMOJI_NAME}: Top Users`)
                .setDescription("Rankings based on reacts and message usage.")
                .setColor(0xFFA500)
                .setTimestamp();

            if (scores.length === 0) {
                embed.setDescription("No usage data found yet. Get to reactin'!");
            } else {
                const list = scores.slice(0, 10).map((s, i) => `**${i + 1}. ${s.username}**: ${s.count}`).join('\n');
                embed.setDescription(list);
            }
            return message.channel.send({ embeds: [embed] });
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
    
    // Track emoji usage globally
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const globalEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emojiUsage', emojiKey);
    await setDoc(globalEmojiDoc, { count: increment(1) }, { merge: true });

    // Track user-specific emoji_9 usage
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