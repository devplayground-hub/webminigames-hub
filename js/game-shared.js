/* =====================================================================
   Game Shared — Web Mini Games Hub
   Generic (not game-specific) cross-module state + small reusable UI
   wiring: current auth user, live profile, coin pill, page banner, and
   the sound-toggle button behavior. Every game page imports this
   instead of re-wiring the same auth/coin/banner/sound plumbing.
   (Tic Tac Toe originally had its own near-identical ttt-shared.js;
   that duplication has been folded in here — see hasUnlockedFeature
   below — so there is now exactly one copy of this state layer.)
===================================================================== */

import { reflectCoinChange, formatCoinAmount } from "./coin-service.js";
import { readLocalSettings, writeLocalSettings, saveSettingsToFirestore } from "./settings-service.js";
import { playClickSound } from "./game-audio.js";

/* ---------------------------------------------------------------
   Current signed-in user
--------------------------------------------------------------- */
let currentUser = null;
const userListeners = [];

export function setCurrentUser(user){
  currentUser = user;
  userListeners.forEach((fn) => fn(user));
}
export function getCurrentUser(){
  return currentUser;
}
export function onUserReady(fn){
  if (currentUser) fn(currentUser);
  else userListeners.push(fn);
}

/* ---------------------------------------------------------------
   Latest live profile snapshot
--------------------------------------------------------------- */
let latestProfile = null;
const profileListeners = [];

export function setProfile(profile){
  latestProfile = profile;
  profileListeners.forEach((fn) => fn(profile));
}
export function getProfile(){
  return latestProfile;
}
export function onProfileUpdate(fn){
  profileListeners.push(fn);
  if (latestProfile) fn(latestProfile);
}
/** True once the given feature id shows up in the signed-in user's unlockedFeatures. */
export function hasUnlockedFeature(featureId){
  return !!latestProfile?.unlockedFeatures?.includes(featureId);
}

/* ---------------------------------------------------------------
   Coin pill
--------------------------------------------------------------- */
let coinAmountEl = null;
let coinPillEl = null;
let lastCoinValue = null;

export function initCoinPill(amountEl, pillEl){
  coinAmountEl = amountEl;
  coinPillEl = pillEl;
}
export function reflectCoins(newCoins){
  if (!coinAmountEl) return;
  if (lastCoinValue === null){
    coinAmountEl.textContent = formatCoinAmount(newCoins);
  } else if (newCoins !== lastCoinValue){
    reflectCoinChange(coinAmountEl, coinPillEl, lastCoinValue, newCoins);
  }
  lastCoinValue = newCoins;
}
export function getLastCoinValue(){
  return lastCoinValue;
}

/* ---------------------------------------------------------------
   Page banner — small inline feedback strip (purchase/hint errors,
   confirmations). Mirrors the pattern used across the app.
--------------------------------------------------------------- */
let bannerEl = null;
let bannerTimeout = null;

export function initBanner(el){
  bannerEl = el;
}
export function showBanner(message, type = "error"){
  if (!bannerEl) return;
  bannerEl.textContent = message;
  bannerEl.className = `page-banner show ${type}`;
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    bannerEl.className = "page-banner";
  }, 3500);
}

/* ---------------------------------------------------------------
   Sound toggle — reads/writes the same app-wide settings system
   (localStorage + Firestore sync) every other page uses, so a mute
   here applies everywhere else too.
--------------------------------------------------------------- */
export function wireSoundToggle(buttonEl){
  function render(enabled){
    buttonEl.textContent = enabled ? "🔊" : "🔇";
    buttonEl.setAttribute("aria-label", enabled ? "Mute sound" : "Unmute sound");
    buttonEl.setAttribute("aria-pressed", String(!enabled));
  }

  buttonEl.addEventListener("click", () => {
    const user = getCurrentUser();
    const isGuest = !!user?.isAnonymous;
    const settings = readLocalSettings(user?.uid, isGuest);
    settings.soundEnabled = !settings.soundEnabled;
    writeLocalSettings(settings, user?.uid, isGuest);
    render(settings.soundEnabled);
    if (settings.soundEnabled) playClickSound();

    if (user){
      // Guest-safe: data-store.js routes this to the in-memory guest
      // profile instead of Firestore whenever the current tab is a
      // guest session, so this call is identical for both cases.
      saveSettingsToFirestore(user.uid, settings).catch((err) => {
        console.error("Failed to sync sound setting:", err);
      });
    }
  });

  const user = getCurrentUser();
  render(readLocalSettings(user?.uid, !!user?.isAnonymous).soundEnabled);
  return render; // exposed so the caller can re-sync it (e.g. from a profile listener)
}
