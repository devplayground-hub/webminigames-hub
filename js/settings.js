/* =====================================================================
   Web Mini Games Hub — Settings Page Controller
   Auth guard + live Firestore sync for all settings, applied to the
   DOM instantly on every change (no page refresh needed anywhere).
===================================================================== */

import {
  watchAuthState,
  logoutUser,
  linkGuestToEmail,
  resetPassword,
  deleteAccount,
  friendlyAuthError,
  initSessionForUser
} from "./auth-service.js";
import {
  THEMES,
  BACKGROUNDS,
  DEFAULT_SETTINGS,
  applySavedSettingsOnLoad,
  applySettingsToDOM,
  writeLocalSettings,
  saveSettingsToFirestore,
  reconcileSettingsFromProfile,
  playTestTone,
  playMusicPreview
} from "./settings-service.js";
import { reflectCoinChange } from "./coin-service.js";
import { findNewlyUnlocked, showAchievementToasts } from "./achievement-service.js";
import { subscribeProfileData, toMillisSafe } from "./data-store.js";

/* ---------------------------------------------------------------
   Apply whatever was saved locally immediately — before auth or
   Firestore have responded — so there's no flash of default colors.
--------------------------------------------------------------- */
applySavedSettingsOnLoad();

/* ---------------------------------------------------------------
   Element refs
--------------------------------------------------------------- */
const backBtn      = document.getElementById("backBtn");
const coinPillEl    = document.getElementById("coinPill");
const coinAmountEl  = document.getElementById("coinAmount");
const pageBannerEl  = document.getElementById("pageBanner");

const themeGridEl      = document.getElementById("themeGrid");
const backgroundGridEl = document.getElementById("backgroundGrid");

const soundToggle  = document.getElementById("soundToggle");
const soundVolume  = document.getElementById("soundVolume");
const testSoundBtn = document.getElementById("testSoundBtn");
const musicToggle  = document.getElementById("musicToggle");
const musicVolume  = document.getElementById("musicVolume");
const previewMusicBtn = document.getElementById("previewMusicBtn");

const accountEmailEl = document.getElementById("accountEmail");
const accountTypeEl  = document.getElementById("accountType");
const accountSinceEl = document.getElementById("accountSince");

const guestUpgradeBlock  = document.getElementById("guestUpgradeBlock");
const upgradeForm        = document.getElementById("upgradeForm");
const upgradeSubmit      = document.getElementById("upgradeSubmit");
const passwordResetBlock = document.getElementById("passwordResetBlock");
const resetPasswordBtn   = document.getElementById("resetPasswordBtn");
const logoutBtn           = document.getElementById("logoutBtn");

const deleteAccountBtn   = document.getElementById("deleteAccountBtn");
const deleteConfirmBox   = document.getElementById("deleteConfirmBox");
const deleteConfirmInput = document.getElementById("deleteConfirmInput");
const deleteConfirmBtn   = document.getElementById("deleteConfirmBtn");
const deleteCancelBtn    = document.getElementById("deleteCancelBtn");

/* ---------------------------------------------------------------
   Navigation
--------------------------------------------------------------- */
backBtn.addEventListener("click", () => { window.location.href = "hub.html"; });

/* ---------------------------------------------------------------
   Banner helper
--------------------------------------------------------------- */
let bannerTimeout = null;
function showBanner(message, type = "error"){
  pageBannerEl.textContent = message;
  pageBannerEl.className = `page-banner show ${type}`;
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => { pageBannerEl.className = "page-banner"; }, 4000);
}

/* ---------------------------------------------------------------
   State
--------------------------------------------------------------- */
let currentUser = null;
let currentSettings = { ...DEFAULT_SETTINGS };
let unsubscribeProfile = null;

/* Pushes a partial change into currentSettings, applies it to the
   DOM immediately, caches it locally, and (if signed in) persists
   the full settings object to Firestore. */
function updateSetting(partial){
  currentSettings = {
    ...currentSettings,
    ...partial
  };
  applySettingsToDOM(currentSettings);
  writeLocalSettings(currentSettings, currentUser?.uid, !!currentUser?.isAnonymous);

  if (currentUser){
    saveSettingsToFirestore(currentUser.uid, currentSettings).catch((err) => {
      console.error("Failed to save settings:", err);
      showBanner("Couldn't save that change. Check your connection.");
    });
  }
}

/* ---------------------------------------------------------------
   Render: Appearance swatches
--------------------------------------------------------------- */
function renderThemeGrid(){
  themeGridEl.innerHTML = THEMES.map((t) => `
    <div class="swatch-tile ${t.id === currentSettings.theme ? "selected" : ""}" data-theme="${t.id}">
      <span class="theme-swatch-dots">
        <span style="background:${t.cyan}"></span>
        <span style="background:${t.magenta}"></span>
        <span style="background:${t.violet}"></span>
      </span>
      <span class="swatch-name">${t.name}</span>
    </div>
  `).join("");

  themeGridEl.querySelectorAll(".swatch-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      updateSetting({ theme: tile.dataset.theme });
      renderThemeGrid();
    });
  });
}

function renderBackgroundGrid(){
  backgroundGridEl.innerHTML = BACKGROUNDS.map((b) => `
    <div class="swatch-tile ${b.id === currentSettings.background ? "selected" : ""}" data-bg="${b.id}">
      <span class="bg-swatch-preview" style="background:${b.css}"></span>
      <span class="swatch-name">${b.name}</span>
    </div>
  `).join("");

  backgroundGridEl.querySelectorAll(".swatch-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      updateSetting({ background: tile.dataset.bg });
      renderBackgroundGrid();
    });
  });
}

/* ---------------------------------------------------------------
   Render: Audio controls
--------------------------------------------------------------- */
function renderAudioControls(){
  soundToggle.checked = currentSettings.soundEnabled;
  soundVolume.value = Math.round(currentSettings.soundVolume * 100);
  soundVolume.disabled = !currentSettings.soundEnabled;
  testSoundBtn.disabled = !currentSettings.soundEnabled;

  musicToggle.checked = currentSettings.musicEnabled;
  musicVolume.value = Math.round(currentSettings.musicVolume * 100);
  musicVolume.disabled = !currentSettings.musicEnabled;
  previewMusicBtn.disabled = !currentSettings.musicEnabled;
}

soundToggle.addEventListener("change", () => {
  updateSetting({ soundEnabled: soundToggle.checked });
  renderAudioControls();
  if (soundToggle.checked) playTestTone(currentSettings.soundVolume);
});

soundVolume.addEventListener("input", () => {
  const vol = Number(soundVolume.value) / 100;
  currentSettings = { ...currentSettings, soundVolume: vol };
  applySettingsToDOM(currentSettings);
});
soundVolume.addEventListener("change", () => {
  const vol = Number(soundVolume.value) / 100;
  updateSetting({ soundVolume: vol });
  playTestTone(vol);
});

testSoundBtn.addEventListener("click", () => playTestTone(currentSettings.soundVolume));

musicToggle.addEventListener("change", () => {
  updateSetting({ musicEnabled: musicToggle.checked });
  renderAudioControls();
  if (musicToggle.checked) playMusicPreview(currentSettings.musicVolume);
});

musicVolume.addEventListener("input", () => {
  const vol = Number(musicVolume.value) / 100;
  currentSettings = { ...currentSettings, musicVolume: vol };
});
musicVolume.addEventListener("change", () => {
  const vol = Number(musicVolume.value) / 100;
  updateSetting({ musicVolume: vol });
  playMusicPreview(vol);
});

previewMusicBtn.addEventListener("click", () => playMusicPreview(currentSettings.musicVolume));

/* ---------------------------------------------------------------
   Account info + coin pill
--------------------------------------------------------------- */
let lastCoinValue = null;

function renderAccount(profile){
  const newCoins = profile.coins ?? 0;
  if (lastCoinValue === null){
    coinAmountEl.textContent = newCoins;
  } else if (newCoins !== lastCoinValue){
    reflectCoinChange(coinAmountEl, coinPillEl, lastCoinValue, newCoins);
  }
  lastCoinValue = newCoins;

  accountEmailEl.textContent = profile.isGuest ? "Guest (no email)" : (profile.email || "—");
  accountTypeEl.textContent = profile.isGuest ? "Guest" : "Registered";

  const createdMs = profile.createdAt ? toMillisSafe(profile.createdAt) : null;
  accountSinceEl.textContent = createdMs
    ? new Date(createdMs).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : "—";

  guestUpgradeBlock.hidden = !profile.isGuest;
  passwordResetBlock.hidden = !!profile.isGuest;
}

/* ---------------------------------------------------------------
   Guest → permanent account upgrade
--------------------------------------------------------------- */
function setUpgradeLoading(loading){
  const label = upgradeSubmit.querySelector(".btn-label");
  const spinner = upgradeSubmit.querySelector(".spinner");
  upgradeSubmit.disabled = loading;
  if (label) label.style.opacity = loading ? "0" : "1";
  if (spinner) spinner.hidden = !loading;
}

upgradeForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = document.getElementById("upgradeName").value.trim();
  const email = document.getElementById("upgradeEmail").value.trim();
  const password = document.getElementById("upgradePassword").value;

  if (!name || !email || password.length < 6){
    showBanner("Fill in a name, email, and a password of at least 6 characters.");
    return;
  }

  setUpgradeLoading(true);
  try{
    await linkGuestToEmail({ name, email, password });
    showBanner("Account created! You're starting fresh at 0 coins.", "success");
    upgradeForm.reset();
  }catch(err){
    console.error("Guest upgrade failed:", err);
    showBanner(friendlyAuthError(err));
  }finally{
    setUpgradeLoading(false);
  }
});

/* ---------------------------------------------------------------
   Password reset (registered accounts)
--------------------------------------------------------------- */
resetPasswordBtn.addEventListener("click", async () => {
  if (!currentUser?.email){
    showBanner("No email on file for this account.");
    return;
  }
  resetPasswordBtn.disabled = true;
  try{
    await resetPassword(currentUser.email);
    showBanner("Password reset email sent. Check your inbox.", "success");
  }catch(err){
    showBanner(friendlyAuthError(err));
  }finally{
    resetPasswordBtn.disabled = false;
  }
});

/* ---------------------------------------------------------------
   Logout
--------------------------------------------------------------- */
logoutBtn.addEventListener("click", async () => {
  try{
    await logoutUser();
    window.location.href = "index.html";
  }catch(err){
    showBanner(friendlyAuthError(err));
  }
});

/* ---------------------------------------------------------------
   Delete account
--------------------------------------------------------------- */
deleteAccountBtn.addEventListener("click", () => {
  deleteConfirmBox.hidden = false;
  deleteConfirmInput.value = "";
  deleteConfirmInput.focus();
});

deleteCancelBtn.addEventListener("click", () => {
  deleteConfirmBox.hidden = true;
});

deleteConfirmBtn.addEventListener("click", async () => {
  if (deleteConfirmInput.value.trim() !== "DELETE"){
    showBanner('Type "DELETE" exactly to confirm.');
    return;
  }
  deleteConfirmBtn.disabled = true;
  try{
    await deleteAccount();
    window.location.href = "index.html";
  }catch(err){
    console.error("Account deletion failed:", err);
    showBanner(friendlyAuthError(err));
    deleteConfirmBtn.disabled = false;
  }
});

/* ---------------------------------------------------------------
   Auth guard + live Firestore subscription
--------------------------------------------------------------- */
let lastAchievementIds = null; // null = no snapshot seen yet, so nothing toasts on first load

function subscribeToProfile(uid){
  unsubscribeProfile = subscribeProfileData(uid, (profile) => {
    const currentAchievementIds = profile.achievements || [];
    const newlyUnlocked = findNewlyUnlocked(lastAchievementIds, currentAchievementIds);
    if (newlyUnlocked.length) showAchievementToasts(newlyUnlocked);
    lastAchievementIds = currentAchievementIds;

    currentSettings = reconcileSettingsFromProfile(profile);

    renderThemeGrid();
    renderBackgroundGrid();
    renderAudioControls();
    renderAccount(profile);
  }, (err) => {
    console.error("Profile listener error:", err);
    showBanner("Couldn't load your settings. Check your connection.");
  });
}

watchAuthState((user) => {
  if (!user){
    window.location.href = "index.html";
    return;
  }
  initSessionForUser(user);
  currentUser = user;
  if (unsubscribeProfile) unsubscribeProfile();
  subscribeToProfile(user.uid);
});
