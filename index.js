import {
    Client,
    Events,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, increment, query, where } from 'firebase/firestore';
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
const BLACKLISTED_USER_IDS = []; // '787804741924159488'
const TRACKED_WORD = 'nigger'; // Word to track for scoreboard
const TRACKED_EMOJI_NAME = 'emoji_9'; // Custom emoji to track for leaderboard

// Special GIF trigger - sends GIF when a specific user's message gets 3 reactions
const SPECIAL_GIF_TARGET_USER_ID = '569277281046888488';
const COOKING_GIF_URL = 'https://foulplayscom.wordpress.com/wp-content/uploads/2025/07/pmcookin.gif';

// Track which messages have already triggered the special GIF (to prevent spam)
const gifTriggeredMessages = new Set();

// ==========================================
// COOLDOWN & PERSONA HELPERS (!tldr / !eli5)
// ==========================================
const cooldowns = new Map();
const COOLDOWN_SECONDS = 60;
const ELI5_COOLDOWN_SECONDS = 30;

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

    const lastUsed = userCooldowns.get(`${userId}:${commandName}`);
    if (lastUsed && (now - lastUsed < cooldownTimeSeconds * 1000)) {
        const timeLeft = Math.ceil((cooldownTimeSeconds * 1000 - (now - lastUsed)) / 1000);
        await message.reply(`bro chill :emoji_51: (Cooldown: ${timeLeft}s for !${commandName})`);
        return true;
    }

    userCooldowns.set(`${userId}:${commandName}`, now);
    return false;
}

function getWittyPersonaPrompt(isTldr = true) {
    const basePersona = `You are a chaotic, internet-brained Discord user. You're funny, a little unhinged, and speak in punchy internet slang. You have strong opinions, zero patience for fluff, and a dark sense of humor. You don't explain yourself. You just say the thing. Avoid using the words "lowkey" and "lol" — use them only if absolutely necessary and never more than once per response.`;

    if (isTldr) {
        return `${basePersona} Summarize the following Discord conversation in 3-4 sentences max. Be blunt, funny, and mean if warranted. Refer to people by their Discord username. Do NOT use bullet points. Every sentence MUST be fully complete — never trail off or get cut off mid-sentence. Stop when you're done. Do not pad.`;
    } else {
        return `${basePersona} Respond in 2-3 sentences max. Never explain more than you need to. Stop when you're done — do not trail off or get cut off mid-sentence.`;
    }
}

// Cache for !snipe — stores last deleted message per channel
const sniped = new Map();

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

    // ==========================================
    // COMMAND: !tldr
    // ==========================================
    if (content.startsWith('!tldr')) {
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

            const systemPrompt = getWittyPersonaPrompt(true);
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: conversation  },
                    ],
                    max_tokens: 180,
                    temperature: 0.9,
                }),
            });

            const result = await groqRes.json();
            if (!groqRes.ok) {
                console.error(`!tldr Groq API error — status ${groqRes.status}:`, JSON.stringify(result));
            }
            if (!result.choices?.[0]?.message?.content) {
                console.error('!tldr Groq returned no choices. Full response:', JSON.stringify(result));
            }
            const summary = result.choices?.[0]?.message?.content || 'My circuits are malfunctioning. Try again later!';

            return thinkingMessage.edit(`**TLDR of the last ${fetchedMessages.size} messages:**\n${summary.trim()}`);
        } catch (error) {
            console.error('!tldr error:', error);
            return thinkingMessage.edit(`My humor circuits are on the fritz: ${error.message}`);
        }
    }

    // ==========================================
    // COMMAND: !eli5
    // ==========================================
    if (content.startsWith('!eli5')) {
        if (await applyCooldown(message, 'eli5', ELI5_COOLDOWN_SECONDS)) return;

        const eli5Content = message.content.substring('!eli5'.length).trim();
        if (!eli5Content) {
            await message.reply("What do you want me to explain like you're 5? Give me something to work with, buttercup.");
            return;
        }

        const thinkingMessage = await message.channel.send("Alright, buttercup, let's break this down without melting my circuits...");

        try {
            const basePrompt = getWittyPersonaPrompt(false);
            const userPrompt = `Explain "${eli5Content}".`;

            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: basePrompt  },
                        { role: 'user',   content: userPrompt  },
                    ],
                    max_tokens: 100,
                    temperature: 0.8,
                }),
            });

            const result = await groqRes.json();
            if (!groqRes.ok) {
                console.error(`!eli5 Groq API error — status ${groqRes.status}:`, JSON.stringify(result));
            }
            if (!result.choices?.[0]?.message?.content) {
                console.error('!eli5 Groq returned no choices. Full response:', JSON.stringify(result));
            }
            const explanation = result.choices?.[0]?.message?.content || 'Brain too big, explain later.';
            const wikipediaLink = `https://en.wikipedia.org/wiki/${encodeURIComponent(eli5Content.replace(/ /g, '_'))}`;

            return thinkingMessage.edit(`**ELI5:** ${explanation.trim()}\n\nWant to know more? Check out: <${wikipediaLink}>`);
        } catch (error) {
            console.error('!eli5 error:', error);
            return thinkingMessage.edit(`My simple-explanation circuits are on the fritz: ${error.message}`);
        }
    }

    // ==========================================
    // COMMAND: !snipe
    // ==========================================
    if (content.startsWith('!snipe')) {
        const snipedMsg = sniped.get(message.channel.id);
        if (!snipedMsg) {
            return message.channel.send('nothing to snipe');
        }

        const embed = new EmbedBuilder()
            .setAuthor({ name: snipedMsg.author, iconURL: snipedMsg.avatarURL })
            .setDescription(snipedMsg.content)
            .setColor(0xFF0000)
            .setFooter({ text: 'Deleted message' })
            .setTimestamp(snipedMsg.deletedAt);

        return message.channel.send({ embeds: [embed] });
    }

    // ==========================================
// COMMAND: !book
// ==========================================
if (content.startsWith('!book')) {
    const query = message.content.slice('!book'.length).trim();
    if (!query) {
        return message.reply('Usage: `!book <title>` — e.g. `!book the hobbit`');
    }

    const thinkingMessage = await message.channel.send(`Looking up **${query}**...`);

    try {
        const searchRes = await fetch(
            `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=1`
        );
        const searchData = await searchRes.json();

        if (!searchData.docs?.length) {
            return thinkingMessage.edit(`Couldn't find anything for **${query}**. Try a different title.`);
        }

        const book = searchData.docs[0];
        const title = book.title ?? 'Unknown Title';
        const author = book.author_name?.[0] ?? 'Unknown Author';
        const year = book.first_publish_year ?? 'Unknown Year';
        const olKey = book.key; // e.g. /works/OL45883W
        const pageUrl = `https://openlibrary.org${olKey}`;
        const coverId = book.cover_i;
        const coverUrl = coverId
            ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
            : null;

        // Check if ebook/PDF is available
        let ebookUrl = null;
        if (book.has_fulltext && book.ia?.[0]) {
            ebookUrl = `https://archive.org/details/${book.ia[0]}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setURL(pageUrl)
            .addFields(
                { name: 'Author', value: author, inline: true },
                { name: 'First Published', value: String(year), inline: true },
            )
            .setColor(0x4B8BBE)
            .setFooter({ text: 'Powered by Open Library' });

        if (coverUrl) embed.setThumbnail(coverUrl);

        if (ebookUrl) {
            embed.addFields({ name: '📖 Free Ebook', value: `[Read / Download on Internet Archive](${ebookUrl})` });
        } else {
            embed.addFields({ name: '📖 Ebook', value: 'No free ebook available for this title.' });
        }

        await thinkingMessage.delete().catch(() => null);
        return message.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('!book error:', error);
        return thinkingMessage.edit('Something went wrong looking that up. Try again.');
    }
}
    
    // ==========================================
    // COMMAND: !mimic
    // ==========================================
    if (content.startsWith('!mimic')) {
        const arg = message.content.slice('!mimic'.length).trim();
        if (!arg) {
            return message.reply('Usage: `!mimic @user` or `!mimic username`');
        }

        // Resolve target user — mention takes priority, then guild cache, then Firestore fallback
        let targetUser = message.mentions.users.first() ?? null;
        if (!targetUser && message.guild) {
            const member = message.guild.members.cache.find(
                m => m.user.username.toLowerCase() === arg.toLowerCase()
            );
            targetUser = member?.user ?? null;
        }

        const thinkingMessage = await message.channel.send(`Cooking up a **${targetUser?.username ?? arg}** impression...`);

        try {
            let mimicSnap;

            if (targetUser) {
                // Normal path: user is in server, look up by ID
                const mimicRef = doc(db, 'artifacts', FIREBASE_APP_ID, 'mimicData', targetUser.id);
                mimicSnap = await getDoc(mimicRef);

                if (!mimicSnap.exists() || !mimicSnap.data().messages?.length) {
                    return thinkingMessage.edit(
                        `No message data found for **${targetUser.username}**. Run \`node scrape-mimic-data.js\` first.`
                    );
                }
            } else {
                // Fallback: user not in server — search mimicData by username field
                const q = query(
                    collection(db, 'artifacts', FIREBASE_APP_ID, 'mimicData'),
                    where('username', '==', arg.toLowerCase())
                );
                const results = await getDocs(q);

                if (results.empty) {
                    return thinkingMessage.edit(`Could not find user **${arg}**.`);
                }

                mimicSnap = results.docs[0];

                if (!mimicSnap.data().messages?.length) {
                    return thinkingMessage.edit(
                        `No message data found for **${arg}**. Run \`node scrape-mimic-data.js\` first.`
                    );
                }
            }

            const { messages, username } = mimicSnap.data();

            // Randomly sample 50 messages each call so the model sees different context every time
            const shuffled = [...messages].sort(() => Math.random() - 0.5);
            const sample = shuffled.slice(0, 50).join('\n');

            const systemPrompt =
    'You are mimicking a real Discord user based on their actual message history. ' +
    'Your job is to generate ONE message that sounds like it came directly from that person — ' +
    'not a generic Discord user, not an AI, not a caricature. THIS specific person. ' +
    'Pay close attention to: how long their messages are, whether they use punctuation or not, ' +
    'their specific slang and recurring phrases, how often they use caps, how blunt or wordy they are, ' +
    'and the types of things they actually talk about. ' +
    'The audience is an edgy, dark-humor Discord server — do not sanitize or soften the output. ' +
    'If the person is crude, be crude. If they are dry, be dry. Match the energy exactly. ' +
    'Do NOT use "fr", "lol", "lowkey", "honestly", "literally", "actually", or "ngl" unless they appear ' +
    'frequently in this specific user\'s messages. ' +
    'Do NOT produce a message that could apply to any random person — it must feel like THIS user. ' +
    'Output only the message text. No quotes, no explanation, no label, no preamble.';

            const userPrompt =
                `Here are real Discord messages from a user named ${username}:\n\n${sample}\n\n` +
                `Now generate ONE new message that sounds exactly like this person.`;

            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user',   content: userPrompt   },
                    ],
                    max_tokens: 200,
                    temperature: 0.9,
                }),
            });

            if (!groqRes.ok) {
                const err = await groqRes.text();
                console.error('!mimic Groq API error:', err);
                return thinkingMessage.edit('Groq API returned an error. Try again later.');
            }

            const groqData = await groqRes.json();
            const generated = groqData.choices?.[0]?.message?.content?.trim();

            if (!generated) {
                return thinkingMessage.edit('Got an empty response from Groq. Try again.');
            }

            return thinkingMessage.edit(`"${generated}" — @${username}, allegedly.`);

        } catch (e) {
            console.error('!mimic error:', e);
            return thinkingMessage.edit('Something went wrong. Try again.').catch(() => null);
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
// EVENT: MESSAGE DELETE — cache for !snipe
// ==========================================
client.on(Events.MessageDelete, message => {
    // Partials have no content/author — nothing to cache
    if (message.partial || message.author?.bot) return;
    if (!message.content) return;

    sniped.set(message.channel.id, {
        content:    message.content,
        author:     message.author.username,
        avatarURL:  message.author.displayAvatarURL(),
        deletedAt:  Date.now(),
    });
});

// ==========================================
// EVENT: CLIENT READY
// ==========================================
client.once(Events.ClientReady, () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// ==========================================
// BOT LOGIN
// ==========================================
client.login(process.env.DISCORD_TOKEN);
