import { Client, Events, GatewayIntentBits, Partials, EmbedBuilder } from 'discord.js';
import 'dotenv/config';

// --- CONFIGURATION ---
const BLACKLISTED_USER_IDS = ['718505488202989678', '787804741924159488'];
const WORD_TO_TRACK = 'nigger';
const wordCounts = {};
const emojiUsage = {};

// Reaction GIF Config
const TARGET_USER_ID_FOR_GIF = '569277281046888488';
const MIN_REACTIONS_FOR_GIF = 3;
const GIF_URL = 'https://foulplayscom.wordpress.com/wp-content/uploads/2025/07/pmcookin.gif';
const triggeredGifMessages = new Set();

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
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    // Word Tracking (Slur Counter)
    if (content.includes(WORD_TO_TRACK)) {
        wordCounts[message.author.id] = (wordCounts[message.author.id] || 0) + 1;
    }

    // Blacklist check
    if (content.startsWith('!') && BLACKLISTED_USER_IDS.includes(message.author.id)) {
        return message.reply('🤡');
    }

    // --- UTILITY COMMANDS ---

    // 1. !urban <word> - Urban Dictionary
    if (content.startsWith('!urban')) {
        const term = message.content.slice(7).trim();
        if (!term) return message.reply("Give me a word to look up, I'm not psychic.");
        
        try {
            const response = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
            const data = await response.json();
            const entry = data.list[0];

            if (!entry) return message.reply("Not even the degenerates at Urban Dictionary have a definition for that.");

            const embed = new EmbedBuilder()
                .setTitle(`Urban Dictionary: ${term}`)
                .setURL(entry.permalink)
                .setColor(0xEFF000)
                .addFields(
                    { name: 'Definition', value: entry.definition.substring(0, 1000).replace(/[\[\]]/g, '') },
                    { name: 'Example', value: entry.example.substring(0, 1000).replace(/[\[\]]/g, '') || 'No example provided.' }
                )
                .setFooter({ text: `👍 ${entry.thumbs_up} | 👎 ${entry.thumbs_down}` });

            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            return message.reply("Slang fetch failed. Error 404: Coolness not found.");
        }
    }

    // 2. !price <crypto> - CoinGecko Prices
    if (content.startsWith('!price')) {
        const coin = message.content.slice(7).trim() || 'bitcoin';
        try {
            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true`);
            const data = await response.json();
            
            if (!data[coin]) return message.reply(`Never heard of "${coin}". Is that a real coin or a Ponzi scheme?`);

            const price = data[coin].usd;
            const change = data[coin].usd_24h_change.toFixed(2);
            const color = change >= 0 ? 0x00FF00 : 0xFF0000;

            const embed = new EmbedBuilder()
                .setTitle(`${coin.toUpperCase()} / USD`)
                .setColor(color)
                .addFields(
                    { name: 'Price', value: `$${price.toLocaleString()}`, inline: true },
                    { name: '24h Change', value: `${change}%`, inline: true }
                )
                .setTimestamp();

            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            return message.reply("Failed to check the ticker. Market is probably crashing anyway.");
        }
    }

    // 3. !odds <sport> - Live Betting Lines (The Odds API v4)
    if (content.startsWith('!odds')) {
        const apiKey = process.env.ODDS_API_KEY;
        if (!apiKey) return message.reply("I need the `ODDS_API_KEY` set in Render to do this.");

        const sport = message.content.slice(6).trim() || 'americanfootball_nfl';
        // v4 endpoint
        const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (!Array.isArray(data) || data.length === 0) {
                return message.reply("No live lines for that sport. Try `americanfootball_nfl` or `basketball_nba`.");
            }

            const game = data[0]; // Show the most immediate game
            const bookie = game.bookmakers[0];
            
            if (!bookie) return message.reply("Found a game, but no bookies are taking bets on it yet.");

            const market = bookie.markets.find(m => m.key === 'h2h');
            const odds = market.outcomes;

            const embed = new EmbedBuilder()
                .setTitle(`Live Odds: ${game.sport_title}`)
                .setDescription(`${game.home_team} vs ${game.away_team}`)
                .setColor(0x00AAFF)
                .addFields(
                    { name: 'Bookmaker', value: bookie.title, inline: false },
                    { name: odds[0].name, value: `Line: ${odds[0].price}`, inline: true },
                    { name: odds[1].name, value: `Line: ${odds[1].price}`, inline: true }
                )
                .setFooter({ text: 'Bet responsibly. Or don\'t, it\'s your money.' });

            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            console.error(e);
            return message.reply("The bookies blocked my call. Couldn't get the odds.");
        }
    }

    // 4. !emojistats - The Emoji Embed
    if (content === '!emojistats') {
        const sortedEmojis = Object.entries(emojiUsage).sort(([, a], [, b]) => b - a).slice(0, 10);
        const statsEmbed = new EmbedBuilder()
            .setTitle('Emoji Popularity Contest')
            .setColor(0x2B2D31)
            .setTimestamp();

        if (sortedEmojis.length === 0) {
            statsEmbed.setDescription("Nobody is reacting to anything. Ghost town.");
        } else {
            const list = sortedEmojis.map(([emoji, count]) => `${emoji} \`${count}\``).join('\n');
            statsEmbed.setDescription(list);
        }
        return message.channel.send({ embeds: [statsEmbed] });
    }

    // 5. !nigger - The Word Counter
    if (content === '!scoreboard') {
        let sb = `**"${WORD_TO_TRACK}" Ranking:**\n`;
        const sorted = Object.keys(wordCounts).sort((a, b) => wordCounts[b] - wordCounts[a]);
        if (sorted.length === 0) sb += "Nobody's nigging today. Boring.";
        else {
            for (const uid of sorted) {
                try {
                    const u = await client.users.fetch(uid);
                    sb += `**${u.username}**: ${wordCounts[uid]}\n`;
                } catch (e) { sb += `Unknown (${uid}): ${wordCounts[uid]}\n`; }
            }
        }
        return message.channel.send(sb);
    }
});

// Emoji Listeners
client.on(Events.MessageReactionAdd, async (reaction) => {
    if (reaction.partial) try { await reaction.fetch(); } catch (e) { return; }
    const key = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    emojiUsage[key] = (emojiUsage[key] || 0) + 1;

    // PM Cooking GIF Logic
    if (reaction.message.author.id === TARGET_USER_ID_FOR_GIF && !triggeredGifMessages.has(reaction.message.id)) {
        const total = reaction.message.reactions.cache.reduce((acc, e) => acc + e.count, 0);
        if (total >= MIN_REACTIONS_FOR_GIF) {
            triggeredGifMessages.add(reaction.message.id);
            reaction.message.channel.send(GIF_URL).catch(() => {});
        }
    }
});

client.on(Events.MessageReactionRemove, async (reaction) => {
    if (reaction.partial) try { await reaction.fetch(); } catch (e) { return; }
    const key = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;
    if (emojiUsage[key]) emojiUsage[key]--;
});

client.login(process.env.DISCORD_TOKEN).catch(console.error);