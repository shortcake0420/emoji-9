// Import the necessary classes from the discord.js library
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import 'dotenv/config';

// Define constants for the Gemini API
// CHANGED: Switched from gemini-2.0-flash to gemini-1.5-flash for better quota stability
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || ""}`;

// --- CONFIGURATION ---
const BLACKLISTED_USER_IDS = [
    '718505488202989678', 
    '787804741924159488',
];

const WORD_TO_TRACK = 'whining';
const wordCounts = {};

// --- EMOJI TRACKER CONFIGURATION ---
// Object to store emoji usage counts (emoji name/id -> count)
const emojiUsage = {};
// --- END EMOJI TRACKER CONFIGURATION ---

const cooldowns = new Map();
const COOLDOWN_SECONDS = 60;
const ELI5_COOLDOWN_SECONDS = 30;
const HYPO_COOLDOWN_SECONDS = 45;

// --- REACTION GIF CONFIGURATION ---
const TARGET_USER_ID_FOR_GIF = '569277281046888488';
const MIN_REACTIONS_FOR_GIF = 3;
const GIF_URL = 'https://foulplayscom.wordpress.com/wp-content/uploads/2025/07/pmcookin.gif';
const triggeredGifMessages = new Set();
// --- END REACTION GIF CONFIGURATION ---

// Create a new Discord client instance with Partials for reactions
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions,
    ],
    // Partials allow the bot to see reactions on messages sent before it was online
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Helper function for cooldown check
async function applyCooldown(message, commandName, cooldownTimeSeconds) {
    const userId = message.author.id;
    const now = Date.now();
    let userCooldowns;

    if (message.guild) {
        const guildId = message.guild.id;
        if (!cooldowns.has(guildId)) {
            cooldowns.set(guildId, new Map());
        }
        userCooldowns = cooldowns.get(guildId);
    } else {
        userCooldowns = cooldowns;
    }

    const lastUsed = userCooldowns.get(userId);

    if (lastUsed && (now - lastUsed < cooldownTimeSeconds * 1000)) {
        const timeLeft = Math.ceil((cooldownTimeSeconds * 1000 - (now - lastUsed)) / 1000);
        await message.reply(`bro chill :emoji_51: (Cooldown: ${timeLeft}s for !${commandName})`);
        return true;
    }

    userCooldowns.set(userId, now);
    return false;
}

// Unified, Witty 90s/00s Persona Prompt Generator
function getWittyPersonaPrompt(isTldr = true) {
    const basePersona = `Act as a witty, sarcastic, and chill internet observer who lived through the 90s and 2000s. Refer to pop culture, tech history, and events from those decades (like dial-up, Napster, early social media, 90s fashion, music, or Y2K anxieties) to make observations. Maintain a snarky, devil's advocate attitude.`;

    if (isTldr) {
        return `${basePersona} Summarize the following Discord conversation in 1-2 extremely concise sentences. For each key participant, provide one very short, funny, and sarcastic comment about their contribution. Also, include 1-2 general snarky observations about the conversation as a whole. Do not use bullet points. Ensure all sentences are complete. Refer to participants by their Discord username.`;
    } else {
        return `${basePersona} Generate a response that is witty, fun, and uses subtle sarcasm and relevant 90s/00s references to deliver the content.`;
    }
}

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (message.content.toLowerCase().includes(WORD_TO_TRACK.toLowerCase())) {
        const userId = message.author.id;
        wordCounts[userId] = (wordCounts[userId] || 0) + 1;
    }

    if (message.content.toLowerCase().startsWith('!')) {
        if (BLACKLISTED_USER_IDS.includes(message.author.id)) {
            try { await message.reply('🤡'); } catch (e) {}
            return;
        }
    }

    // !tldr Command
    if (message.content.toLowerCase().startsWith('!tldr')) {
        if (await applyCooldown(message, 'tldr', COOLDOWN_SECONDS)) return;

        const thinkingMessage = await message.channel.send('Thinking... distilling the essence of chaos into digestible nuggets.');

        try {
            const args = message.content.split(' ');
            let messageCount = 50;
            if (args.length > 1 && !isNaN(parseInt(args[1]))) {
                messageCount = Math.min(parseInt(args[1]), 100);
            }

            const fetchedMessages = await message.channel.messages.fetch({ limit: messageCount, before: message.id });
            const conversation = fetchedMessages
                .filter(msg => !msg.author.bot)
                .map(msg => `${msg.author.username}: ${msg.content}`)
                .reverse()
                .join('\n');

            if (!conversation) {
                await thinkingMessage.edit(`Looks like everyone's been quiet. Nothing to summarize here!`);
                return;
            }

            const prompt = getWittyPersonaPrompt(true);
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt + `\n\n${conversation}` }] }],
                generationConfig: { temperature: 0.9, maxOutputTokens: 100 },
            };

            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            const summary = result.candidates?.[0]?.content?.parts?.[0]?.text || 'My circuits are malfunctioning. Try again later!';

            await thinkingMessage.edit(`**TLDR of the last ${fetchedMessages.size} messages:**\n${summary.trim()}`);
        } catch (error) {
            await thinkingMessage.edit(`My humor circuits are on the fritz: ${error.message}`);
        }
    }

    // !eli5 Command
    else if (message.content.toLowerCase().startsWith('!eli5')) {
        if (await applyCooldown(message, 'eli5', ELI5_COOLDOWN_SECONDS)) return;

        const content = message.content.substring('!eli5'.length).trim();
        if (!content) {
            await message.reply('What do you want me to explain like you\'re 5? Give me something to work with, buttercup.');
            return;
        }

        const thinkingMessage = await message.channel.send('Alright, buttercup, let\'s break this down without melting my circuits...');

        try {
            const basePrompt = getWittyPersonaPrompt(false);
            const prompt = `${basePrompt} Explain "${content}" factually and clearly, as if you're explaining it to someone who probably won't get it anyway. Keep the explanation concise, aiming for 2-3 sentences.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 100 },
            };

            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            const explanation = result.candidates?.[0]?.content?.parts?.[0]?.text || 'Brain too big, explain later.';
            const wikipediaLink = `https://en.wikipedia.org/wiki/${encodeURIComponent(content.replace(/ /g, '_'))}`;

            await thinkingMessage.edit(`**ELI5:** ${explanation.trim()}\n\nWant to know more? Check out: <${wikipediaLink}>`);
        } catch (error) {
            await thinkingMessage.edit(`My simple-explanation circuits are on the fritz: ${error.message}`);
        }
    }

    // !scoreboard Command
    else if (message.content.toLowerCase().startsWith('!scoreboard')) {
        let scoreboardMessage = `**"${WORD_TO_TRACK}" Scoreboard:**\n`;
        const sortedUsers = Object.keys(wordCounts).sort((a, b) => wordCounts[b] - wordCounts[a]);

        if (sortedUsers.length === 0) {
            scoreboardMessage += 'No one has said the word yet. Get to it, losers!';
        } else {
            for (const userId of sortedUsers) {
                try {
                    const user = await client.users.fetch(userId);
                    scoreboardMessage += `${user.username}: ${wordCounts[userId]}\n`;
                } catch (e) {
                    scoreboardMessage += `Unknown User (${userId}): ${wordCounts[userId]}\n`;
                }
            }
        }
        await message.channel.send(scoreboardMessage);
    }

    // !emojistats Command
    else if (message.content.toLowerCase().startsWith('!emojistats')) {
        let statsMessage = `**Emoji Popularity Contest (The Overuse Report):**\n`;
        const sortedEmojis = Object.entries(emojiUsage).sort(([, a], [, b]) => b - a).slice(0, 10);

        if (sortedEmojis.length === 0) {
            statsMessage += "Nobody is reacting to anything. It's like a deserted AOL chatroom in here.";
        } else {
            for (const [emoji, count] of sortedEmojis) {
                statsMessage += `${emoji}: ${count}\n`;
            }
            statsMessage += `\n*Slower than a 28.8k modem, but we got there.*`;
        }
        await message.channel.send(statsMessage);
    }

    // !hypo Command
    else if (message.content.toLowerCase() === '!hypo') {
        if (await applyCooldown(message, 'hypo', HYPO_COOLDOWN_SECONDS)) return;
        const thinkingMessage = await message.channel.send('Alright, let\'s dive into the abyss of "what if"...');

        try {
            const basePrompt = getWittyPersonaPrompt(false);
            const prompt = `${basePrompt} Generate one extremely witty, adult, funny, and thought-provoking hypothetical "Would you rather...?" or "What if...?" question. Make it sarcastic and fun.`;

            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.0, maxOutputTokens: 100 },
            };

            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            const hypothetical = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No thoughts, head empty.';

            await thinkingMessage.edit(`**Hypothetical:** ${hypothetical.trim()}`);
        } catch (error) {
            await thinkingMessage.edit(`Hypothetical generator is on the fritz: ${error.message}`);
        }
    }
});

// EMOJI TRACKER LOGIC
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (error) { return; }
    }

    // Increment global emoji usage count
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    emojiUsage[emojiKey] = (emojiUsage[emojiKey] || 0) + 1;

    // Reaction-Triggered GIF Logic
    if (reaction.message.author.id === TARGET_USER_ID_FOR_GIF && !triggeredGifMessages.has(reaction.message.id)) {
        const totalReactions = reaction.message.reactions.cache.reduce((acc, emoji) => acc + emoji.count, 0);
        if (totalReactions >= MIN_REACTIONS_FOR_GIF) {
            triggeredGifMessages.add(reaction.message.id);
            try { await reaction.message.channel.send(GIF_URL); } catch (e) {}
        }
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (reaction.partial) {
        try { await reaction.fetch(); } catch (error) { return; }
    }
    // Decrement global emoji usage count when a reaction is removed
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    if (emojiUsage[emojiKey] && emojiUsage[emojiKey] > 0) {
        emojiUsage[emojiKey]--;
    }
});

client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log('Bot successfully logged in to Discord.'))
    .catch(error => console.error('Failed to log in to Discord:', error));

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});