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

        // Acknowledge the command immediately to let the user know the bot is working
        const thinkingMessage = await message.channel.send('Thinking... let\'s see what magical (or cursed) summary awaits.'); // Updated thinking message

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
            // New probabilities: 20% Disney-flavored witty, 40% /pol/ humor, 40% Reddit humor
            const humorRoll = Math.random();

            if (humorRoll < 0.2) { // Disney-flavored witty (20%) - Refined for subtle references
                prompt = `Please summarize the following Discord conversation in 1-2 sentences (TLDR style), with a witty, chill, and slightly mischievous tone. Occasionally weave in subtle, clever references to classic animated films or their underlying themes, but keep it sharp and to the point. Ensure you refer to participants by their Discord username. Imagine a clever observer who just happens to enjoy animated classics.`;
            } else if (humorRoll < 0.6) { // Edgy/4chan /pol/ humor (40%) - Centrist & Devil's Advocate
                prompt = `Please summarize the following Discord conversation in 1-2 sentences (TLDR style), with a dry, cynical, and provocatively centrist tone. Act as a devil's advocate, dissecting arguments from all sides, highlighting logical fallacies, perceived absurdities, and inconvenient truths, without favoring any particular political extreme. Ensure you refer to participants by their Discord username. Keep it witty, a bit rude, and troll-y, but remain chill. Avoid explicit slurs or hate speech.`;
            } else { // Reddit-type humor (40%) - Witty, rude, troll-y, chill, unpopular opinions
                prompt = `Please summarize the following Discord conversation in 1-2 sentences (TLDR style), with a self-aware, ironic, and dry tone, like a top-tier Reddit comment. Use subtle internet culture references and inside jokes. Ensure you refer to participants by their Discord username. Be witty, a little rude, and troll-y, but ultimately chill. Maybe even drop an unpopular opinion or two, just for the lulz.`;
            }
            // The actual conversation to summarize is appended after the prompt.

            // Make the API call to the Gemini LLM
            const payload = {
                contents: [{ role: "user", parts: [{ text: prompt + `\n\n${conversation}` }] }], // Append conversation here
                generationConfig: {
                    temperature: 0.9, // Increased temperature for more creative/humorous output
                    maxOutputTokens: 50, // SIGNIFICANTLY DECREASED maxOutputTokens for ultra-short summaries
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

            // Edit the "thinking..." message with the summary
            await thinkingMessage.edit(`**TLDR of the last ${fetchedMessages.size} messages:**\n\n${summary}`); // Updated response prefix
            console.log(`Successfully summarized conversation for ${message.channel.name}`);

        } catch (error) {
            console.error('Error during summarization:', error);
            await thinkingMessage.edit(`My humor circuits are on the fritz: ${error.message}`); // Updated error message
        }
    }
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
