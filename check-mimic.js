/**
 * check-mimic.js
 *
 * Looks up a user's mimic data in Firestore by username and prints their
 * document ID and total message count.
 *
 * Usage: node check-mimic.js <username>
 * Example: node check-mimic.js shortcake0420
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import 'dotenv/config';

const FIREBASE_APP_ID = 'cliffbot-f45b0';

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

// ── Lookup ────────────────────────────────────────────────────────────────────

const targetUsername = process.argv[2]?.toLowerCase();
if (!targetUsername) {
    console.error('Usage: node check-mimic.js <username>');
    process.exit(1);
}

const snapshot = await getDocs(collection(db, 'artifacts', FIREBASE_APP_ID, 'mimicData'));

if (snapshot.empty) {
    console.log('No documents found in mimicData.');
    process.exit(0);
}

let found = false;
snapshot.forEach(docSnap => {
    const data = docSnap.data();
    if (data.username?.toLowerCase() === targetUsername) {
        console.log(`Document ID : ${docSnap.id}`);
        console.log(`Username    : ${data.username}`);
        console.log(`Messages    : ${data.messages?.length ?? 0}`);
        found = true;
    }
});

if (!found) {
    console.log(`No mimic data found for username "${targetUsername}".`);
}

process.exit(0);
