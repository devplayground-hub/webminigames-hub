/* =====================================================================
   Data Store — Web Mini Games Hub
   ---------------------------------------------------------------------
   THE single place that decides *where* a user's profile data lives:

     - Account users (registered email/password)  -> Firestore, keyed
       by their own Firebase Auth UID. Permanent, cross-device.
     - Guest users (never touch Firebase at all — no Auth sign-in,
       no Firestore document)                      -> in-memory + a
       sessionStorage mirror (so it survives navigating between the
       hub / games / profile / settings pages, which are separate
       full page loads), keyed to a locally-generated guest id. Never
       written to Firestore, never sent to Firebase Auth. Cleared on
       logout and automatically gone when the browser tab/session ends.

   Every other service (coin-service, achievement-service,
   missions-service, settings-service, game pages, hub, profile,
   settings) reads/writes profile data exclusively through this
   module instead of importing Firestore directly. That's what keeps
   "account vs guest" a single decision made in one place rather than
   duplicated (and risking drift) across every game/page file.
===================================================================== */

import { db } from "./firebase-init.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  increment as fbIncrement,
  arrayUnion as fbArrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const GUEST_PROFILE_KEY = "wmgh_guest_profile"; // sessionStorage — this browser tab/session only

/* ---------------------------------------------------------------
   Storage-agnostic sentinels
   Mirrors Firestore's increment()/arrayUnion() so every service can
   build the same patch object regardless of which backend ends up
   handling it. Converted to the real Firestore sentinel only when a
   write actually goes to Firestore; applied by hand for guests.
--------------------------------------------------------------- */
class Increment { constructor(amount){ this.amount = amount; } }
class ArrayUnion { constructor(items){ this.items = items; } }

export function increment(amount){ return new Increment(amount); }
export function arrayUnion(...items){ return new ArrayUnion(items); }

function toFirestoreValue(value){
  if (value instanceof Increment) return fbIncrement(value.amount);
  if (value instanceof ArrayUnion) return fbArrayUnion(...value.items);
  return value;
}

/** Applies a Firestore-style patch (supports "a.b.c" dot-paths and the
 *  sentinels above) directly onto a plain in-memory object. */
function applyPatch(target, patch){
  for (const [path, rawValue] of Object.entries(patch)){
    const keys = path.split(".");
    let node = target;
    for (let i = 0; i < keys.length - 1; i++){
      if (typeof node[keys[i]] !== "object" || node[keys[i]] === null) node[keys[i]] = {};
      node = node[keys[i]];
    }
    const lastKey = keys[keys.length - 1];

    if (rawValue instanceof Increment){
      node[lastKey] = (Number(node[lastKey]) || 0) + rawValue.amount;
    } else if (rawValue instanceof ArrayUnion){
      const existing = Array.isArray(node[lastKey]) ? node[lastKey] : [];
      const merged = [...existing];
      rawValue.items.forEach((item) => { if (!merged.includes(item)) merged.push(item); });
      node[lastKey] = merged;
    } else {
      node[lastKey] = rawValue;
    }
  }
}

/** Reads a Firestore Timestamp, a plain Date, or an ISO string uniformly. */
export function toMillisSafe(value){
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ---------------------------------------------------------------
   Default profile shape — shared by real signups (Firestore) and
   guest sessions (in-memory), so the two can never drift apart.
--------------------------------------------------------------- */
export function buildDefaultProfile({ uid, displayName, email, photoURL, isGuest, now }){
  const timestamp = now ?? new Date();
  return {
    uid,
    displayName: displayName || (isGuest ? "Guest Player" : "Player"),
    email: email || null,
    photoURL: photoURL || null,
    isGuest: !!isGuest,

    avatar: {
      id: "default",
      unlocked: ["default", "ninja", "robot", "alien", "wizard"]
    },

    coins: 0,
    achievements: [],
    achievementProgress: {},
    unlockedFeatures: [],

    theme: {
      background: "nebula",
      ui: "neon-dark",
      unlocked: ["nebula", "neon-dark"]
    },

    settings: {
      theme: "neon-dark",
      background: "nebula",
      soundEnabled: true,
      soundVolume: 0.7,
      musicEnabled: true,
      musicVolume: 0.5
    },

    statistics: {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      ticTacToe: { played: 0, wins: 0 },
      memoryGame: { played: 0, bestTimeMs: null },
      rockPaperScissors: { played: 0, wins: 0 },
      numberGuessing: { played: 0, wins: 0 }
    },

    createdAt: timestamp,
    lastLogin: timestamp
  };
}

/* =====================================================================
   Guest session (in-memory, mirrored to sessionStorage)
===================================================================== */
let guestActive = false;
let guestUid = null;
let guestProfile = null;
const guestListeners = new Set();

function persistGuestToSession(){
  try{
    sessionStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify({ uid: guestUid, profile: guestProfile }));
  }catch(err){
    console.error("Failed to persist guest session:", err);
  }
}

function notifyGuestListeners(){
  const snapshot = { ...guestProfile };
  guestListeners.forEach((fn) => fn(snapshot));
}

/** True while the current tab is in a guest (anonymous) session. */
export function isGuestActive(){
  return guestActive;
}

/** The active guest's uid, or null if this page isn't (yet) in guest
 *  mode. Used by auth-service.js's linkGuestToEmail() to find the
 *  guest profile to carry over when upgrading to a real account. */
export function getCurrentGuestUid(){
  return guestActive ? guestUid : null;
}

/**
 * Peeks at sessionStorage for an already-in-progress guest session
 * WITHOUT activating guest mode on this page — used by auth-service.js's
 * watchAuthState() wrapper to tell, on a brand-new page load (before
 * startGuestSession() has run), whether this tab is mid-guest-session.
 * Returns the stored uid, or null if there isn't one.
 */
export function peekStoredGuestUid(){
  try{
    const raw = sessionStorage.getItem(GUEST_PROFILE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved?.uid || null;
  }catch{
    return null;
  }
}

/**
 * Starts (or resumes, on a page navigation within the same tab) a guest
 * session for the given anonymous UID. Guest data is NEVER read from or
 * written to Firestore — only sessionStorage, so it disappears the
 * moment the tab/browser session ends and never mixes with any other
 * guest or account.
 *
 * Used for RESUMING an in-progress guest session as the player
 * navigates between pages (hub -> a game -> back to hub, etc.) within
 * one continuous visit — the anonymous Firebase user (and therefore
 * its uid) stays the same across those page loads, so this picks the
 * matching sessionStorage profile back up instead of resetting it.
 *
 * This is NOT what runs when someone explicitly clicks "Continue as
 * Guest" — that always goes through startFreshGuestSession() below,
 * specifically so a brand-new guest visit can never accidentally
 * resume a previous guest's leftover progress.
 */
export function startGuestSession(uid){
  guestActive = true;

  // Resume this exact tab's in-progress guest session on navigation
  // between pages (each page load re-imports this module fresh).
  try{
    const raw = sessionStorage.getItem(GUEST_PROFILE_KEY);
    if (raw){
      const saved = JSON.parse(raw);
      if (saved && saved.uid === uid && saved.profile){
        guestUid = uid;
        guestProfile = saved.profile;
        return guestProfile;
      }
    }
  }catch(err){
    console.error("Failed to resume guest session:", err);
  }

  // Different UID (or none saved) — this is a brand-new guest session.
  guestUid = uid;
  guestProfile = buildDefaultProfile({ uid, isGuest: true });
  persistGuestToSession();
  return guestProfile;
}

/**
 * Starts an ALWAYS-fresh guest session for the given uid — used only
 * for the explicit "Continue as Guest" entry point. Unlike
 * startGuestSession() above, this never looks at (or resumes from) any
 * previously saved sessionStorage profile, even if the uid happens to
 * match a prior one. In practice auth-service.js's continueAsGuest()
 * already mints a brand-new random id on every click, so this can't
 * happen — this is just belt-and-suspenders so every explicit guest
 * entry is guaranteed to start at the same default coins/progress
 * every time no matter what uid it's called with.
 */
export function startFreshGuestSession(uid){
  guestActive = true;
  guestUid = uid;
  guestProfile = buildDefaultProfile({ uid, isGuest: true });
  persistGuestToSession();
  return guestProfile;
}

/** Ends the guest session and wipes every trace of it from this tab. */
export function endGuestSession(){
  guestActive = false;
  guestUid = null;
  guestProfile = null;
  guestListeners.clear();
  try{ sessionStorage.removeItem(GUEST_PROFILE_KEY); }catch{ /* ignore */ }
}

/* =====================================================================
   Unified profile API — every service/page uses ONLY these functions,
   never Firestore directly, so "guest vs account" is decided here once.
===================================================================== */

/** One-off read. Returns the profile object, or null if none exists yet. */
export async function getProfileData(uid){
  if (guestActive){
    return guestProfile && guestProfile.uid === uid ? { ...guestProfile } : null;
  }
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

/** Creates a brand-new PERMANENT profile. Account users only — a guest
 *  profile is created via startGuestSession() and is never persisted. */
export async function createProfileData(uid, data){
  await setDoc(doc(db, "users", uid), data);
}

/** Applies a partial (dot-path capable) patch to a user's profile. */
export async function updateProfileData(uid, patch){
  if (guestActive){
    if (!guestProfile || guestProfile.uid !== uid) return;
    applyPatch(guestProfile, patch);
    persistGuestToSession();
    notifyGuestListeners();
    return;
  }
  const firestorePatch = {};
  for (const [key, value] of Object.entries(patch)) firestorePatch[key] = toFirestoreValue(value);
  await updateDoc(doc(db, "users", uid), firestorePatch);
}

/** Live subscription — fires immediately with the current data, then on
 *  every change. Returns an unsubscribe function, same as Firestore's. */
export function subscribeProfileData(uid, onData, onError){
  if (guestActive){
    guestListeners.add(onData);
    if (guestProfile && guestProfile.uid === uid) onData({ ...guestProfile });
    return () => guestListeners.delete(onData);
  }
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (snap.exists()) onData(snap.data());
  }, onError);
}

/** Permanently deletes a profile. No-op for guests (nothing was ever
 *  persisted for them to begin with). */
export async function deleteProfileData(uid){
  if (guestActive) return;
  await deleteDoc(doc(db, "users", uid));
}

/**
 * Atomic coin balance change. Uses a real Firestore transaction for
 * account users (safe across two tabs/devices); for guests it's a
 * simple in-memory read-modify-write, which is all one tab needs.
 */
export async function runCoinTransaction(uid, delta){
  if (guestActive){
    if (!guestProfile || guestProfile.uid !== uid){
      throw Object.assign(new Error("No guest profile found."), { code: "coins/no-profile" });
    }
    const current = guestProfile.coins ?? 0;
    const updated = current + delta;
    if (updated < 0){
      throw Object.assign(
        new Error(`Not enough coins — need ${Math.abs(updated)} more.`),
        { code: "coins/insufficient-funds", have: current, needed: Math.abs(delta) }
      );
    }
    guestProfile.coins = updated;
    persistGuestToSession();
    notifyGuestListeners();
    return updated;
  }

  const userRef = doc(db, "users", uid);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists()){
      throw Object.assign(new Error("User profile not found."), { code: "coins/no-profile" });
    }
    const current = snap.data().coins ?? 0;
    const updated = current + delta;
    if (updated < 0){
      throw Object.assign(
        new Error(`Not enough coins — need ${Math.abs(updated)} more.`),
        { code: "coins/insufficient-funds", have: current, needed: Math.abs(delta) }
      );
    }
    transaction.update(userRef, { coins: updated });
    return updated;
  });
}
