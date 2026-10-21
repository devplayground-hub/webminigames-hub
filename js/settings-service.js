/* =====================================================================
   Settings Service — Web Mini Games Hub
   Theme/background catalogs + the logic to apply, save, and load
   appearance and audio preferences. Used by the Settings page
   directly, and by every other page (hub, profile) so a user's
   chosen look follows them across the whole app instantly.

   Storage rules:
   - Account users: cached in localStorage under a key namespaced to
     their UID (so Account A's browser cache can never leak into
     Account B's), AND synced to Firestore via data-store.js so it
     follows them across devices.
   - Guests: cached in sessionStorage only (this tab/session), never
     localStorage and never Firestore — gone the moment the guest
     session ends, exactly like the rest of their progress.
   - Before auth resolves on a fresh page load, a small anonymous
     "last painted" cache (not tied to any uid) is used purely to
     avoid a flash of default colors; it holds no game data and is
     immediately overwritten by the signed-in user's real settings
     the instant their profile loads.
===================================================================== */

import { updateProfileData } from "./data-store.js";

/* ---------------------------------------------------------------
   Catalogs
--------------------------------------------------------------- */
export const THEMES = [
  { id: "neon-dark", name: "Neon Dark",    cyan: "#00f0ff", magenta: "#ff2e9a", violet: "#8b5cff", gold: "#ffc94d" },
  { id: "neon-warm", name: "Sunset Arcade", cyan: "#ffb347", magenta: "#ff5e78", violet: "#ff8f4d", gold: "#ffd54d" },
  { id: "neon-cool", name: "Aurora Cool",   cyan: "#37f2c2", magenta: "#5be0ff", violet: "#7c8cff", gold: "#b6ffce" },
  { id: "neon-mono", name: "Mono Grid",     cyan: "#c9c9d9", magenta: "#9a9ab0", violet: "#7d7d99", gold: "#e8e8ee" }
];

export const BACKGROUNDS = [
  {
    id: "nebula", name: "Nebula",
    css: "radial-gradient(1200px 800px at 15% 0%, #1c1050 0%, transparent 60%), radial-gradient(1000px 700px at 85% 100%, #0e1f4a 0%, transparent 60%), linear-gradient(160deg, #0a0e27 0%, #150a30 100%)"
  },
  {
    id: "aurora", name: "Aurora",
    css: "radial-gradient(1200px 800px at 20% 10%, #063a3a 0%, transparent 60%), radial-gradient(1000px 700px at 80% 90%, #0a2f4f 0%, transparent 60%), linear-gradient(160deg, #041b2d 0%, #06261f 100%)"
  },
  {
    id: "sunset", name: "Sunset",
    css: "radial-gradient(1200px 800px at 15% 0%, #3d1030 0%, transparent 60%), radial-gradient(1000px 700px at 85% 100%, #4a1e0e 0%, transparent 60%), linear-gradient(160deg, #2a0e1f 0%, #331505 100%)"
  },
  {
    id: "midnight", name: "Midnight",
    css: "radial-gradient(1200px 800px at 15% 0%, #121212 0%, transparent 60%), radial-gradient(1000px 700px at 85% 100%, #181818 0%, transparent 60%), linear-gradient(160deg, #060606 0%, #0e0e0e 100%)"
  }
];

export const DEFAULT_SETTINGS = {
  theme: "neon-dark",
  background: "nebula",
  soundEnabled: true,
  soundVolume: 0.7,
  musicEnabled: true,
  musicVolume: 0.5
};

const LASTPAINT_KEY = "wmgh_settings_lastpaint"; // pre-auth flash cache only, no game data
const ACCOUNT_PREFIX = "wmgh_settings_";          // + uid, in localStorage
const GUEST_KEY = "wmgh_settings_guest";          // sessionStorage, this tab/session only

/* ---------------------------------------------------------------
   Per-user read/write.
   uid + isGuest omitted  -> the pre-auth "last painted" cache.
   isGuest true           -> sessionStorage (temporary).
   isGuest false (+ uid)  -> localStorage, namespaced to that uid.
--------------------------------------------------------------- */
export function readLocalSettings(uid, isGuest){
  try{
    if (!uid){
      const raw = localStorage.getItem(LASTPAINT_KEY);
      return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    }
    const store = isGuest ? sessionStorage : localStorage;
    const key = isGuest ? GUEST_KEY : `${ACCOUNT_PREFIX}${uid}`;
    const raw = store.getItem(key);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  }catch{
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeLocalSettings(settings, uid, isGuest){
  try{
    // Always refresh the anonymous pre-auth cache too, purely so the
    // NEXT page load paints roughly the right colors before auth
    // resolves — never read back as anyone's authoritative data.
    localStorage.setItem(LASTPAINT_KEY, JSON.stringify(settings));

    if (uid){
      const store = isGuest ? sessionStorage : localStorage;
      const key = isGuest ? GUEST_KEY : `${ACCOUNT_PREFIX}${uid}`;
      store.setItem(key, JSON.stringify(settings));
    }
  }catch(err){
    console.error("Failed to write settings to storage:", err);
  }
}

/* Clears a guest's cached settings — called on logout so the next
   guest session (or the browser's next visit) never inherits them. */
export function clearGuestLocalSettings(){
  try{ sessionStorage.removeItem(GUEST_KEY); }catch{ /* ignore */ }
}

/* ---------------------------------------------------------------
   DOM application — theme colors become CSS custom properties on
   <html>, so every existing var(--neon-cyan) etc. across every
   stylesheet updates live, with no per-page special-casing needed.
   Background becomes an inline style on <body>, which overrides the
   gradient each page's own stylesheet sets by default.
--------------------------------------------------------------- */
export function applyTheme(themeId){
  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const root = document.documentElement.style;
  root.setProperty("--neon-cyan", theme.cyan);
  root.setProperty("--neon-magenta", theme.magenta);
  root.setProperty("--neon-violet", theme.violet);
  root.setProperty("--neon-gold", theme.gold);
}

export function applyBackground(bgId){
  const bg = BACKGROUNDS.find((b) => b.id === bgId) || BACKGROUNDS[0];
  /* Set only the image, not the full `background` shorthand — the
     shorthand silently resets background-repeat/attachment/size to
     their defaults, which undoes each page's "no-repeat, fixed,
     cover" rules and is what let the gradient visibly tile/cut off
     partway down the page. Setting backgroundImage alone swaps the
     picture while leaving those page-level rules intact. */
  document.body.style.backgroundImage = bg.css;
}

export function applySettingsToDOM(settings){
  applyTheme(settings.theme);
  applyBackground(settings.background);
}

/* Call this at the very top of every page's controller — applies
   whatever was last saved locally before any network round trip,
   so there's no flash of default colors on load. Uid isn't known
   yet at this point, so this intentionally reads the anonymous
   pre-auth cache only. */
export function applySavedSettingsOnLoad(){
  const settings = readLocalSettings();
  applySettingsToDOM(settings);
  return settings;
}

/* ---------------------------------------------------------------
   Firestore sync (account users only — see data-store.js, which
   is a no-op against Firestore for an active guest session).
--------------------------------------------------------------- */
export async function saveSettingsToFirestore(uid, settings){
  await updateProfileData(uid, { settings });
}

/* Merges a profile's settings over local defaults, caches the
   result under that user's own key (guest -> session, account ->
   uid-namespaced), and applies it — used once auth resolves so
   settings follow the signed-in user, not the browser. */
export function reconcileSettingsFromProfile(profile){
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(profile.settings || {})
  };
  writeLocalSettings(merged, profile.uid, !!profile.isGuest);
  applySettingsToDOM(merged);
  return merged;
}

/* ---------------------------------------------------------------
   Lightweight audio feedback (Web Audio oscillator) — gives instant,
   file-free confirmation when sound/music settings change, since no
   audio assets exist in the project yet. Swap this out once real
   sound effects / background music tracks are added.
--------------------------------------------------------------- */
let audioCtx = null;
function getAudioContext(){
  if (!audioCtx){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  return audioCtx;
}

export function playTestTone(volume = 0.7){
  try{
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.25;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
  }catch(err){
    console.error("Test tone failed:", err);
  }
}

export function playMusicPreview(volume = 0.5){
  try{
    const ctx = getAudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const startAt = ctx.currentTime + i * 0.14;
      gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.2;
      osc.connect(gain).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.16);
    });
  }catch(err){
    console.error("Music preview failed:", err);
  }
}
