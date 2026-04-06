/**
 * backfill-emoji9.js
 *
 * One-time script to backfill the emoji9Leaderboard in Firestore from the last
 * 30 days of messages in a specific Discord channel.
 *
 * Run with: node backfill-emoji9.js
 *
 * Requires DISCORD_TOKEN and FIREBASE_CONFIG in your .env file.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc, increment } from 'firebase/firestore';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────

const CHANNEL_ID       = '891400893524758619';
const TRACKED_EMOJI    = 'emoji_9';
const FIREBASE_APP_ID  = 'cliffbot-f45b0';
const DAYS_BACK        = 30;

// ── Firebase init ─────────────────────────────────────────────────────────────

let rawConfig = process.env.FIREBASE_CONFIG || '{}';
if (rawConfig.startsWith("'") && rawConfig.endsWith("'")) {
    rawConfig = rawConfig.slice(1, -1);
}

const firebaseConfig = JSON.parse(rawConfig);
if (!firebaseConfig.apiKey) {
    console.error('❌ FIREBASE_CONFIG is missing or invalid.');
    process.exit(1);
}

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

await signInAnonymously(auth);
console.log('✅ Firebase authenticated.');

// ── Discord client ────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

await client.login(process.env.DISCORD_TOKEN);
await new Promise(resolve => client.once('ready', resolve));
console.log(`✅ Logged in as ${client.user.tag}`);

// ── Fetch messages ────────────────────────────────────────────────────────────

const channel = await client.channels.fetch(CHANNEL_ID);
if (!channel?.isTextBased()) {
    console.error('❌ Channel not found or not a text channel.');
    process.exit(1);
}

const cutoff = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
console.log(`\nFetching messages from #${channel.name} (last ${DAYS_BACK} days)…`);

const allMessages = [];
let lastId = null;
let batchNum = 0;

while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    batchNum++;
    let stoppedEarly = false;

    for (const msg of batch.values()) {
        if (msg.createdTimestamp < cutoff) {
            stoppedEarly = true;
            break;
        }
        allMessages.push(msg);
    }

    console.log(`  Batch ${batchNum}: fetched ${batch.size} messages, kept ${allMessages.length} total`);

    if (stoppedEarly) break;

    // Oldest message in this batch becomes the cursor for the next fetch
    lastId = batch.last().id;
}

console.log(`\nTotal messages to scan: ${allMessages.length}`);

// ── Scan reactions ────────────────────────────────────────────────────────────

// tallies[userId] = { count, username }
const tallies = {};

let scanned = 0;
for (const msg of allMessages) {
    scanned++;
    if (scanned % 100 === 0) {
        console.log(`  Scanned ${scanned} / ${allMessages.length} messages…`);
    }

    // Find the emoji_9 reaction on this message (if any)
    const emojiReaction = msg.reactions.cache.find(
        r => r.emoji.name?.toLowerCase() === TRACKED_EMOJI.toLowerCase()
    );

    if (!emojiReaction) continue;

    // Fetch all users who added this reaction (paginate if >100 reactors)
    let reactorCursor = null;
    while (true) {
        const fetchOptions = { limit: 100 };
        if (reactorCursor) fetchOptions.after = reactorCursor;

        const reactors = await emojiReaction.users.fetch(fetchOptions);
        if (reactors.size === 0) break;

        for (const user of reactors.values()) {
            if (user.bot) continue;
            if (!tallies[user.id]) {
                tallies[user.id] = { count: 0, username: user.username };
            }
            tallies[user.id].count++;
        }

        if (reactors.size < 100) break;
        reactorCursor = reactors.last().id;
    }
}

// ── Summary ───────────────────────────────────────────────────────────────────

const userCount = Object.keys(tallies).length;
const totalReactions = Object.values(tallies).reduce((s, v) => s + v.count, 0);
console.log(`\nFound ${totalReactions} emoji_9 reactions across ${userCount} users.`);

if (userCount === 0) {
    console.log('Nothing to write. Exiting.');
    process.exit(0);
}

console.log('\nTallies:');
Object.entries(tallies)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([id, { count, username }]) => {
        console.log(`  ${username.padEnd(24)} (${id})  → ${count}`);
    });

// ── Write to Firestore ────────────────────────────────────────────────────────

console.log('\nWriting to Firestore…');
let written = 0;

for (const [userId, { count, username }] of Object.entries(tallies)) {
    const ref = doc(
        db,
        'artifacts', FIREBASE_APP_ID, 'public', 'data', 'emoji9Leaderboard',
        userId
    );

    await setDoc(
        ref,
        { count: increment(count), username },
        { merge: true }
    );

    written++;
    console.log(`  ✅ ${username}: +${count}`);
}

console.log(`\nDone! Wrote ${written} user records to Firestore.`);
process.exit(0);
