/**
 * scrape-mimic-data.js
 *
 * One-time script that scrapes 3 months of messages from a Discord channel
 * and stores each user's messages in Firestore for use by the /mimic command.
 *
 * Firestore path: artifacts/cliffbot-f45b0/mimicData/{userId}
 * Document shape: { username: string, messages: string[] }
 *
 * Run with: node scrape-mimic-data.js
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import 'dotenv/config';

// ── Config ────────────────────────────────────────────────────────────────────

const CHANNEL_ID      = '891400893524758619';
const FIREBASE_APP_ID = 'cliffbot-f45b0';
const DAYS_BACK       = 90;   // 3 months
const MAX_MSGS_PER_USER = 500; // cap to stay well under Firestore's 1 MB doc limit
const MIN_MSG_LENGTH  = 3;    // skip very short messages
const MAX_MSG_LENGTH  = 500;  // truncate extremely long messages

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
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message],
});

await client.login(process.env.DISCORD_TOKEN);
await new Promise(resolve => client.once('ready', resolve));
console.log(`✅ Logged in as ${client.user.tag}`);

// ── Fetch messages ────────────────────────────────────────────────────────────

const channel = await client.channels.fetch(CHANNEL_ID);
if (!channel?.isTextBased()) {
    console.error('❌ Channel not found or not text-based.');
    process.exit(1);
}

const cutoff = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
console.log(`\nFetching messages from #${channel.name} (last ${DAYS_BACK} days)…`);

// userMap[userId] = { username, messages: [] }
const userMap = {};
let lastId = null;
let totalFetched = 0;
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

        // Skip bots and command messages
        if (msg.author.bot) continue;
        if (!msg.content || msg.content.startsWith('!') || msg.content.startsWith('/')) continue;

        const text = msg.content.trim();
        if (text.length < MIN_MSG_LENGTH) continue;

        const uid = msg.author.id;
        if (!userMap[uid]) {
            userMap[uid] = { username: msg.author.username, messages: [] };
        }

        if (userMap[uid].messages.length < MAX_MSGS_PER_USER) {
            userMap[uid].messages.push(text.slice(0, MAX_MSG_LENGTH));
            totalFetched++;
        }
    }

    console.log(`  Batch ${batchNum}: fetched ${batch.size} msgs  |  total kept: ${totalFetched}`);

    if (stoppedEarly) break;
    lastId = batch.last().id;
}

const userCount = Object.keys(userMap).length;
console.log(`\nDone scraping. ${totalFetched} messages across ${userCount} users.`);

if (userCount === 0) {
    console.log('No data to write. Exiting.');
    process.exit(0);
}

// ── Write to Firestore ────────────────────────────────────────────────────────

console.log('\nWriting to Firestore…');

for (const [userId, { username, messages }] of Object.entries(userMap)) {
    const ref = doc(db, 'artifacts', FIREBASE_APP_ID, 'mimicData', userId);
    await setDoc(ref, { username, messages });
    console.log(`  ✅ ${username.padEnd(24)} — ${messages.length} messages`);
}

console.log(`\nAll done! Wrote ${userCount} user records.`);
process.exit(0);
