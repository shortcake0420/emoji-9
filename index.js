// Import the necessary classes from the discord.js library
import { Client, Events, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

// --- CONFIGURATION ---
const GEMINI_MODEL = "gemini-1.5-flash"; // Switched to stable 1.5 to fix the 429 error
const BLACKLISTED_USER_IDS = [
    '718505488202989678', 
    '787804741924159488',
];

const WORD_TO_TRACK = 'nigger';
const wordCounts = {};
const emojiUsage = {};

const cooldowns = new Map();
const COOLDOWN_SECONDS = 60;
const ELI5_COOLDOWN_SECONDS = 30;
const HYPO_COOLDOWN_SECONDS = 45;

const TARGET_USER_ID_FOR_GIF = '569277281046888488';
const MIN_REACTIONS_FOR_GIF = 3;
const GIF_URL = 'https://foulplayscom.wordpress.com/wp-content/uploads/2025/07/pmcookin.gif';
const triggeredGifMessages = new Set();

// Create a new Discord client instance with Partials for reactions
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
    console.log(`Using model: ${GEMINI_MODEL}`);
});

/**
 * Exponential Backoff helper for Gemini API calls.
 */
async function callGemini(payload) {
    const apiKey = process.env.GEMINI_API_KEY || "";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    
    const maxRetries = 5;
    const baseDelay = 1000;

    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json();

            if (response.ok) {
                return data;
            }

            if (response.status === 429 && i < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, i);
                console.log(`Rate limited. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            throw new Error(data.error?.message || response.statusText);
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = baseDelay * Math.pow(2, i);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

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

            const payload = {
                contents: [{ role: "user", parts: [{ text: getWittyPersonaPrompt(true) + `\n\n${conversation}` }] }],
                generationConfig: { temperature: 0.9, maxOutputTokens: 100 },
            };

            const result = await callGemini(payload);
            const summary = result.candidates?.[0]?.content?.parts?.[0]?.text || 'My circuits are malfunctioning.';
            await thinkingMessage.edit(`**TLDR of the last ${fetchedMessages.size} messages:**\n${summary.trim()}`);
        } catch (error) {
            await thinkingMessage.edit(`My humor circuits are on the fritz: ${error.message}`);
        }
    }

    else if (message.content.toLowerCase().startsWith('!eli5')) {
        if (await applyCooldown(message, 'eli5', ELI5_COOLDOWN_SECONDS)) return;
        const content = message.content.substring('!eli5'.length).trim();
        if (!content) return await message.reply('What am I explaining? Give me something to work with.');
        const thinkingMessage = await message.channel.send('Alright, buttercup, let\'s break this down...');
        try {
            const prompt = `${getWittyPersonaPrompt(false)} Explain "${content}" factually and clearly in 2-3 sentences.`;
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 100 },
            };
            const result = await callGemini(payload);
            const explanation = result.candidates?.[0]?.content?.parts?.[0]?.text || 'Brain too big, explain later.';
            const wikipediaLink = `https://en.wikipedia.org/wiki/${encodeURIComponent(content.replace(/ /g, '_'))}`;
            await thinkingMessage.edit(`**ELI5:** ${explanation.trim()}\n\nMore info: <${wikipediaLink}>`);
        } catch (error) {
            await thinkingMessage.edit(`My simple-explanation circuits are on the fritz: ${error.message}`);
        }
    }

    else if (message.content.toLowerCase().startsWith('!scoreboard')) {
        let scoreboardMessage = `**"${WORD_TO_TRACK}" Scoreboard:**\n`;
        const sortedUsers = Object.keys(wordCounts).sort((a, b) => wordCounts[b] - wordCounts[a]);
        if (sortedUsers.length === 0) {
            scoreboardMessage += 'No one has said the word yet.';
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

    else if (message.content.toLowerCase().startsWith('!emojistats')) {
        const sortedEmojis = Object.entries(emojiUsage).sort(([, a], [, b]) => b - a).slice(0, 10);
        
        const statsEmbed = new EmbedBuilder()
            .setTitle('Emoji Popularity Contest (The Overuse Report)')
            .setColor(0x2B2D31) // Sleek dark grey
            .setTimestamp();

        if (sortedEmojis.length === 0) {
            statsEmbed.setDescription("Nobody is reacting to anything. It's like a deserted AOL chatroom in here.");
        } else {
            const list = sortedEmojis.map(([emoji, count]) => `${emoji} \`${count}\``).join('\n');
            statsEmbed.setDescription(list);
            statsEmbed.setFooter({ text: 'Tracking all your questionable reactions...' });
        }
        
        await message.channel.send({ embeds: [statsEmbed] });
    }

    else if (message.content.toLowerCase() === '!hypo') {
        if (await applyCooldown(message, 'hypo', HYPO_COOLDOWN_SECONDS)) return;
        const thinkingMessage = await message.channel.send('Alright, let\'s dive into the abyss...');
        try {
            const prompt = `${getWittyPersonaPrompt(false)} Generate one extremely witty, adult, funny "Would you rather...?" question.`;
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.0, maxOutputTokens: 100 },
            };
            const result = await callGemini(payload);
            const hypothetical = result.candidates?.[0]?.content?.parts?.[0]?.text || 'No thoughts.';
            await thinkingMessage.edit(`**Hypothetical:** ${hypothetical.trim()}`);
        } catch (error) {
            await thinkingMessage.edit(`Generator is on the fritz: ${error.message}`);
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    if (reaction.partial) { try { await reaction.fetch(); } catch (error) { return; } }
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    emojiUsage[emojiKey] = (emojiUsage[emojiKey] || 0) + 1;
    if (reaction.message.author.id === TARGET_USER_ID_FOR_GIF && !triggeredGifMessages.has(reaction.message.id)) {
        const totalReactions = reaction.message.reactions.cache.reduce((acc, emoji) => acc + emoji.count, 0);
        if (totalReactions >= MIN_REACTIONS_FOR_GIF) {
            triggeredGifMessages.add(reaction.message.id);
            try { await reaction.message.channel.send(GIF_URL); } catch (e) {}
        }
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    if (reaction.partial) { try { await reaction.fetch(); } catch (error) { return; } }
    const emojiKey = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    if (emojiUsage[emojiKey] && emojiUsage[emojiKey] > 0) emojiUsage[emojiKey]--;
});

client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log('Bot successfully logged in to Discord.'))
    .catch(error => console.error('Failed to log in to Discord:', error));

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});