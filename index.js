import { Client, Events, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDocs, collection, increment } from 'firebase/firestore';
import 'dotenv/config';

// --- DATABASE SETUP ---
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG || '{}');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Using your specific Firebase Project ID as the appId in the path
const appId = 'cliffbot-f45b0'; 

let dbReady = false;

// Authenticate anonymously
signInAnonymously(auth)
    .then(() => {
        console.log("Database Authenticated and Ready.");
        dbReady = true;
    })
    .catch(err => {
        console.error("Database Auth Failed:", err);
    });

// --- BOT CONFIG ---
const BLACKLISTED_USER_IDS = ['718505488202989678', '787804741924159488'];
const WORD_TO_TRACK = 'nigger';
const TARGET_EMOJI_NAME = 'emoji_9'; // Specifically tracking this one

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

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !dbReady) return;

    const content = message.content.toLowerCase();

    // 1. Word Tracking (Nigger)
    if (content.includes(WORD_TO_TRACK)) {
        const userDoc = doc(db, 'artifacts', appId, 'public', 'data', 'wordCounts', message.author.id);
        try {
            await setDoc(userDoc, { 
                count: increment(1), 
                username: message.author.username 
            }, { merge: true });
        } catch (e) {
            console.error("Error saving word count:", e);
        }
    }

    // 2. Specific Emoji Tracking (Text-based usage)
    if (message.content.includes(TARGET_EMOJI_NAME)) {
        const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', message.author.id);
        try {
            await setDoc(userEmojiDoc, {
                count: increment(1),
                username: message.author.username
            }, { merge: true });
        } catch (e) {
            console.error("Error saving emoji usage:", e);
        }
    }

    // 3. Blacklist check
    if (content.startsWith('!') && BLACKLISTED_USER_IDS.includes(message.author.id)) {
        return message.reply('🤡');
    }

    // --- COMMANDS ---

    // !nigger - Nigger rankings
    if (content === '!scoreboard') {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'wordCounts'));
            const scores = [];
            querySnapshot.forEach(doc => scores.push(doc.data()));
            
            scores.sort((a, b) => b.count - a.count);
            
            let sb = `**"${WORD_TO_TRACK}" Rankings:**\n`;
            if (scores.length === 0) {
                sb += "Nobody is nigging yet.";
            } else {
                scores.slice(0, 10).forEach((s, i) => {
                    sb += `${i + 1}. **${s.username}**: ${s.count}\n`;
                });
            }
            return message.channel.send(sb);
        } catch (e) {
            return message.reply("Failed to fetch scoreboard.");
        }
    }

    // !emoji9 - Dedicated Emoji 9 Leaderboard
    if (content === '!emoji9') {
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
                embed.setDescription("No one has used this emoji enough to be ranked.");
            } else {
                const list = scores.slice(0, 10).map((s, i) => `**${i + 1}. ${s.username}**: ${s.count}`).join('\n');
                embed.setDescription(list);
            }
            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            return message.reply("Failed to fetch emoji leaderboard.");
        }
    }

    // !emojistats - Global stats
    if (content === '!emojistats') {
        try {
            const querySnapshot = await getDocs(collection(db, 'artifacts', appId, 'public', 'data', 'emojiUsage'));
            const emojis = [];
            querySnapshot.forEach(doc => emojis.push({ id: doc.id, ...doc.data() }));

            emojis.sort((a, b) => b.count - a.count);

            const embed = new EmbedBuilder()
                .setTitle('Global Emoji Popularity')
                .setColor(0x2B2D31)
                .setTimestamp();

            if (emojis.length === 0) {
                embed.setDescription("No reactions tracked yet.");
            } else {
                const list = emojis.slice(0, 10).map(e => `${e.id} \`${e.count}\``).join('\n');
                embed.setDescription(list);
            }
            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            return message.reply("Failed to fetch global emoji stats.");
        }
    }
});

// Reaction Tracking
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) try { await reaction.fetch(); } catch (e) { return; }
    
    const key = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const emojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emojiUsage', key);
    
    try {
        // Increment global usage
        await setDoc(emojiDoc, { count: increment(1) }, { merge: true });

        // Specific tracking for emoji_9
        if (reaction.emoji.name === TARGET_EMOJI_NAME) {
            const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
            await setDoc(userEmojiDoc, {
                count: increment(1),
                username: user.username
            }, { merge: true });
        }
    } catch (e) {
        console.error("Error tracking reaction:", e);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (!dbReady || user.bot) return;
    if (reaction.partial) try { await reaction.fetch(); } catch (e) { return; }
    
    const key = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    const emojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emojiUsage', key);
    
    try {
        await setDoc(emojiDoc, { count: increment(-1) }, { merge: true });

        // Decrement user specific count if they remove the reaction
        if (reaction.emoji.name === TARGET_EMOJI_NAME) {
            const userEmojiDoc = doc(db, 'artifacts', appId, 'public', 'data', 'emoji9Leaderboard', user.id);
            await setDoc(userEmojiDoc, {
                count: increment(-1)
            }, { merge: true });
        }
    } catch (e) {
        console.error("Error removing reaction:", e);
    }
});

client.login(process.env.DISCORD_TOKEN);