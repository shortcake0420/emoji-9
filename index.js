// Import the necessary classes from the discord.js library
// Client: The main class for interacting with the Discord API
// Events: An enum containing all the events emitted by the Discord client
// GatewayIntentBits: Used to specify which events your bot wants to receive from Discord
import { Client, Events, GatewayIntentBits } from 'discord.js';

// Load environment variables from a .env file
// This is crucial for keeping sensitive information like your bot token and API key secure.
// Make sure you have 'dotenv' installed: npm install dotenv
import 'dotenv/config';

// Define constants for the Gemini API
// The GEMINI_API_KEY must be set in your local .env file when running the bot locally.
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY || ""}`;

// --- BLACKLIST CONFIGURATION ---
// To blacklist a user, add their Discord User ID to this array.
// You can get a user's ID by enabling Developer Mode in Discord settings (User Settings > Advanced > Developer Mode),
// then right-clicking on their username and selecting "Copy ID".
const BLACKLISTED_USER_IDS = [
    '718505488202989678', // Existing ID
    '787804741924159488', // New ID added to blacklist
];
// --- END BLACKLIST CONFIGURATION ---

// --- WORD TRACKER CONFIGURATION ---
// Define the word you want to track (case-insensitive)
const WORD_TO_TRACK = 'whining'; // Example word, change this to your desired word

// Object to store word counts for each user (user ID -> count)
// Note: This data will reset if the bot restarts. For persistent storage, a database would be needed.
const wordCounts = {};
// --- END WORD TRACKER CONFIGURATION ---

// --- COOLDOWN CONFIGURATION ---
// Map to store cooldowns: guildId -> (userId -> last_command_timestamp)
const cooldowns = new Map(); // Changed to store cooldowns per guild
const COOLDOWN_SECONDS = 60; // Cooldown period in seconds
// --- END COOLDOWN CONFIGURATION ---


// Create a new Discord client instance
// We specify the intents our bot needs. Intents tell Discord which events your bot wants to receive.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,           // Required for general guild (server) operations.
        GatewayIntentBits.GuildMessages,    // Required to receive messages from guilds.
        GatewayIntentBits.MessageContent,   // CRUCIAL for reading message content.
                                            // Make sure this is enabled in your bot's settings on the Discord Developer Portal.
        GatewayIntentBits.DirectMessages,   // Required to receive direct messages.
    ],
});

// Event listener for when the client is ready (bot has logged in)
// The 'once' property means this event will only fire once when the bot starts
client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

// Event listener for when a message is created
client.on(Events.MessageCreate, async message => {
    // Ignore messages from other bots to prevent infinite loops
    if (message.author.bot) return;

    // Log the message content to the console for debugging (commented out for less console spam)
    // console.log(`Received message: "${message.content}" from ${message.author.tag}`);

    // --- WORD TRACKER LOGIC ---
    // Check if the message contains the word to track
    if (message.content.toLowerCase().includes(WORD_TO_TRACK.toLowerCase())) {
        const userId = message.author.id;
        if (!wordCounts[userId]) {
            wordCounts[userId] = 0;
        }
        wordCounts[userId]++;
        console.log(`${message.author.tag} said "${WORD_TO_TRACK}". Count: ${wordCounts[userId]}`);
    }
    // --- END WORD TRACKER LOGIC ---

    // --- Command for Summarization ---
    // We'll use a simple prefix command for now (e.g., "!tldr")
    // You could also implement slash commands for a more modern Discord experience.
    if (message.content.toLowerCase().startsWith('!tldr')) {
        // --- BLACKLIST CHECK (MOVED INSIDE COMMAND BLOCK) ---
        if (BLACKLISTED_USER_IDS.includes(message.author.id)) {
            // If the user is blacklisted AND used the command, reply with a clown emoji and stop processing
            try {
                await message.reply('🤡'); // Reply with a clown emoji
                console.log(`Blacklisted user ${message.author.tag} attempted to use the bot command.`);
            } catch (error) {
                console.error(`Error replying to blacklisted user:`, error);
            }
            return; // Stop further processing for blacklisted users
        }
        // --- END BLACKLIST CHECK ---

        // --- COOLDOWN CHECK (PER USER, PER SERVER) ---
        if (!message.guild) { // If it's a DM, apply global cooldown
            const userId = message.author.id;
            const now = Date.now();
            const lastUsed = cooldowns.get(userId); // Using the main cooldowns map for DMs

            if (lastUsed && (now - lastUsed < COOLDOWN_SECONDS * 1000)) {
                await message.reply(`bro chill :emoji_51:`); // Cooldown message for DMs
                console.log(`User ${message.author.tag} is on cooldown for !tldr in DM.`);
                return;
            }
            cooldowns.set(userId, now); // Set cooldown for DM
        } else { // If it's in a guild (server)
            const guildId = message.guild.id;
            const userId = message.author.id;
            const now = Date.now();

            if (!cooldowns.has(guildId)) {
                cooldowns.set(guildId, new Map());
            }
            const userCooldownsInGuild = cooldowns.get(guildId);
            const lastUsed = userCooldownsInGuild.get(userId);

            if (lastUsed && (now - lastUsed < COOLDOWN_SECONDS * 1000)) {
                await message.reply(`bro chill :emoji_51:`); // Cooldown message for guilds
                console.log(`User ${message.author.tag} is on cooldown for !tldr in guild ${message.guild.name}.`);
                return;
            }
            userCooldownsInGuild.set(userId, now); // Set cooldown for guild
        }
        // --- END COOLDOWN CHECK ---

        // Acknowledge the command immediately to let the user know the bot is working
        const thinkingMessage = await message.channel.send('Thinking... distilling the essence of chaos into digestible nuggets.'); // Updated thinking message

        try {
            // Determine how many messages to fetch (default to 50 if not specified)
            const args = message.content.split(' ');
            let messageCount = 50; // Default number of messages to summarize
            if (args.length > 1 && !isNaN(parseInt(args[1]))) {
                messageCount = Math.min(parseInt(args[1]), 100); // Limit to a maximum of 100 messages to avoid very long prompts
            }

            // Fetch recent messages from the channel
            // The `before` option ensures we don't include the command itself in the summary
            const fetchedMessages = await message.channel.messages.fetch({ limit: messageCount, before: message.id });

            // Filter out messages from bots and format them for the LLM prompt
            const conversation = fetchedMessages
                .filter(msg => !msg.author.bot) // Exclude bot messages from the conversation
                .map(msg => `${msg.author.username}: ${msg.content}`)
                .reverse() // Reverse to get chronological order for the LLM
                .join('\n');

            if (!conversation) {
                // Corrected syntax for the string literal
                await thinkingMessage.edit(`Looks like everyone's been quiet. Nothing to summarize here!`); // Fix: Using backticks for string
                return;
            }

            // --- Dynamic Prompt Selection for Humor ---
            let prompt = '';
            // New probabilities: 10% Disney-flavored witty, 45% /pol/ humor, 45% Reddit humor
            const humorRoll = Math.random();

            if (humorRoll < 0.1) { // Disney-flavored witty (10%) - Less frequent, more subtle
                prompt = `Please summarize the following Discord conversation in 2-3 concise bullet points (TLDR style), with a witty, chill, and slightly mischievous tone. Occasionally weave in subtle, clever references to classic animated films or their underlying themes, but keep it sharp and to the point. Ensure you refer to participants by their Discord username. Imagine a clever observer who just happens to enjoy animated classics.`;
            } else if (humorRoll < 0.55) { // Edgy/4chan /pol/ humor (45%)
                prompt = `Please summarize the following Discord conversation in 2-3 concise bullet points (TLDR style), with a dry, cynical, and provocatively centrist tone. Act as a devil's advocate, dissecting arguments from all sides, highlighting logical fallacies, perceived absurdities, and inconvenient truths, without favoring any particular political extreme. Ensure you refer to participants by their Discord username. Keep it witty, a bit rude, and troll-y, but remain chill. Avoid explicit slurs or hate speech.`;
            } else { // Reddit-type humor (45%)
                prompt = `Please summarize the following Discord conversation in 2-3 concise bullet points (TLDR style), with a self-aware, ironic, and dry tone, like a top-tier Reddit comment. Use subtle internet culture references and inside jokes. Ensure you refer to participants by their Discord username. Be witty, a little rude, and troll-y, but ultimately chill. Maybe even drop an unpopular opinion or two, just for the lulz.`;
            }
            // The actual conversation to summarize is appended after the prompt.

            // Make the API call to the Gemini LLM
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt + `\n\n${conversation}` }] }], // Append conversation here
                generationConfig: {
                    temperature: 0.9, // Increased temperature for more creative/humorous output
                    maxOutputTokens: 150, // Increased to allow for 2-3 brief bullet points
                },
            };

            const response = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error('Gemini API error response:', errorData);
                throw new Error(`Gemini API request failed with status ${response.status}: ${errorData.error?.message || response.statusText}`);
            }

            // FIX: Await the response.json() call
            const result = await response.json(); // Changed this line

            let summary = 'My circuits are currently experiencing a comedic malfunction. Try again later!'; // Updated error message
            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0) {
                summary = result.candidates[0].content.parts[0].text;
            } else {
                console.warn('Unexpected Gemini API response structure:', result);
            }

            // Edit the "thinking-" message with the summary
            // Removed extra newline characters to make bullets start immediately
            await thinkingMessage.edit(`**TLDR of the last ${fetchedMessages.size} messages:**\n${summary}`); // Changed from \n\n to \n
            console.log(`Successfully summarized conversation for ${message.channel.name}`);

        } catch (error) {
            console.error('Error during summarization:', error);
            await thinkingMessage.edit(`My humor circuits are on the fritz: ${error.message}`); // Updated error message
        }
    }
    // --- NEW COMMAND: Display Word Scoreboard ---
    else if (message.content.toLowerCase() === '!scoreboard') {
        let scoreboardMessage = `**"${WORD_TO_TRACK}" Scoreboard:**\n`;
        const sortedUsers = Object.keys(wordCounts).sort((a, b) => wordCounts[b] - wordCounts[a]);

        if (sortedUsers.length === 0) {
            scoreboardMessage += 'No one has said the word yet. Get to it, losers!';
        } else {
            for (const userId of sortedUsers) {
                // Fetch the user object to get their username
                try {
                    const user = await client.users.fetch(userId);
                    scoreboardMessage += `${user.username}: ${wordCounts[userId]}\n`;
                } catch (error) {
                    console.error(`Could not fetch user ${userId}:`, error);
                    scoreboardMessage += `Unknown User (${userId}): ${wordCounts[userId]}\n`;
                }
            }
        }
        await message.channel.send(scoreboardMessage);
    }
    // --- END NEW COMMAND ---
});

// Log in to Discord with your bot's token
// The token should be stored in a .env file for security
// Make sure you have a .env file in the same directory as your bot.js file
// and it contains a line like: DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
client.login(process.env.DISCORD_TOKEN)
    .then(() => console.log('Bot successfully logged in to Discord.'))
    .catch(error => console.error('Failed to log in to Discord:', error));

// Add this for more robust error handling during startup
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});
