/* =====================================================================
   Web Mini Games Hub — Profile Page Controller
   Auth guard + live Firestore profile sync + avatar/username editing.
===================================================================== */

import { auth } from "./firebase-init.js";
import { watchAuthState, initSessionForUser } from "./auth-service.js";
import { ACHIEVEMENTS, AVATARS } from "./catalog.js";
import {
  applySavedSettingsOnLoad,
  reconcileSettingsFromProfile
} from "./settings-service.js";
import {
  spendCoins,
  reflectCoinChange
} from "./coin-service.js";
import {
  getAchievementProgress,
  findNewlyUnlocked,
  showAchievementToasts
} from "./achievement-service.js";
import {
  subscribeProfileData,
  updateProfileData,
  arrayUnion,
  toMillisSafe
} from "./data-store.js";
import { renderGuestBanner } from "./guest-banner.js";
import {
  updateProfile as updateAuthProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* Apply whatever theme/background was saved locally immediately —
   before auth or Firestore have responded — so there's no flash of
   default colors on load. */
applySavedSettingsOnLoad();

/* ---------------------------------------------------------------
   Element refs
--------------------------------------------------------------- */
const backBtn        = document.getElementById("backBtn");
const settingsBtn     = document.getElementById("settingsBtn");
const coinPillEl      = document.getElementById("coinPill");
const coinAmountEl    = document.getElementById("coinAmount");
const pageBannerEl    = document.getElementById("pageBanner");

const heroAvatarEl    = document.getElementById("heroAvatar");
const guestTagEl      = document.getElementById("guestTag");
const displayNameText = document.getElementById("displayNameText");
const editNameBtn     = document.getElementById("editNameBtn");
const nameEditForm    = document.getElementById("nameEditForm");
const nameInput       = document.getElementById("nameInput");
const nameCancelBtn   = document.getElementById("nameCancelBtn");
const emailTextEl     = document.getElementById("emailText");
const memberSinceEl   = document.getElementById("memberSinceText");

const avatarGridEl        = document.getElementById("avatarGrid");
const avatarUnlockedTagEl = document.getElementById("avatarUnlockedTag");

const statsGridEl = document.getElementById("statsGrid");
const statsBarsEl = document.getElementById("statsBars");

const achievementsGridFullEl = document.getElementById("achievementsGridFull");
const achievementsCountTagEl = document.getElementById("achievementsCountTag");
const guestAchievementsNoteEl = document.getElementById("guestAchievementsNote");

/* ---------------------------------------------------------------
   Navigation
--------------------------------------------------------------- */
backBtn.addEventListener("click", () => {
  window.location.href = "hub.html";
});

settingsBtn.addEventListener("click", () => {
  window.location.href = "settings.html";
});

/* ---------------------------------------------------------------
   Banner helper
--------------------------------------------------------------- */
let bannerTimeout = null;
function showBanner(message, type = "error"){
  pageBannerEl.textContent = message;
  pageBannerEl.className = `page-banner show ${type}`;
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => {
    pageBannerEl.className = "page-banner";
  }, 3500);
}

/* ---------------------------------------------------------------
   Render: hero (avatar, name, email, member since, coins)
--------------------------------------------------------------- */
let lastCoinValue = null;

function renderHero(user, profile){
  displayNameText.textContent = profile.displayName || "Player";
  nameInput.value = profile.displayName || "";

  emailTextEl.textContent = profile.isGuest
    ? "Playing as a guest — sign up to keep this progress"
    : (profile.email || "No email on file");

  guestTagEl.hidden = !profile.isGuest;

  const createdMs = profile.createdAt ? toMillisSafe(profile.createdAt) : null;
  memberSinceEl.textContent = createdMs
    ? `Member since ${new Date(createdMs).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`
    : "Member since —";

  renderAvatarDisplay(profile);

  const newCoins = profile.coins ?? 0;
  if (lastCoinValue === null){
    coinAmountEl.textContent = newCoins;
  } else if (newCoins !== lastCoinValue){
    reflectCoinChange(coinAmountEl, coinPillEl, lastCoinValue, newCoins);
  }
  lastCoinValue = newCoins;
}

function findAvatarById(id){
  return AVATARS.find((a) => a.id === id);
}

function renderAvatarDisplay(profile){
  const current = findAvatarById(profile.avatar?.id);
  if (current){
    heroAvatarEl.textContent = current.emoji;
  } else if (profile.photoURL){
    heroAvatarEl.innerHTML = `<img src="${profile.photoURL}" alt="Profile photo" />`;
  } else {
    heroAvatarEl.textContent = (profile.displayName || "P").charAt(0).toUpperCase();
  }
}

/* ---------------------------------------------------------------
   Username editing
--------------------------------------------------------------- */
let currentUser = null;

editNameBtn.addEventListener("click", () => {
  nameEditForm.hidden = false;
  displayNameText.style.display = "none";
  editNameBtn.style.display = "none";
  nameInput.focus();
  nameInput.select();
});

nameCancelBtn.addEventListener("click", () => {
  closeNameEditor();
});

function closeNameEditor(){
  nameEditForm.hidden = true;
  displayNameText.style.display = "";
  editNameBtn.style.display = "";
}

nameEditForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newName = nameInput.value.trim();

  if (newName.length < 2 || newName.length > 20){
    showBanner("Username must be between 2 and 20 characters.");
    return;
  }
  if (!currentUser) return;

  try{
    await updateProfileData(currentUser.uid, { displayName: newName });
    if (auth.currentUser){
      await updateAuthProfile(auth.currentUser, { displayName: newName });
    }
    closeNameEditor();
    showBanner("Username updated!", "success");
  }catch(err){
    console.error("Failed to update username:", err);
    showBanner("Couldn't update username. Please try again.");
  }
});

/* ---------------------------------------------------------------
   Render: avatar picker grid
--------------------------------------------------------------- */
function renderAvatarGrid(profile){
  const unlocked = profile.avatar?.unlocked || [];
  const currentId = profile.avatar?.id || "default";
  const coins = profile.coins ?? 0;

  avatarUnlockedTagEl.textContent = `${unlocked.length} / ${AVATARS.length} unlocked`;

  avatarGridEl.innerHTML = AVATARS.map((a) => {
    const isUnlocked = unlocked.includes(a.id) || a.cost === 0;
    const isSelected = a.id === currentId;
    const canAfford = coins >= a.cost;

    const classes = [
      "avatar-tile",
      isSelected ? "selected" : "",
      !isUnlocked ? "locked" : "",
      !isUnlocked && canAfford ? "affordable" : "",
      !isUnlocked && !canAfford ? "unaffordable" : ""
    ].filter(Boolean).join(" ");

    return `
      <div class="${classes}" data-id="${a.id}" data-cost="${a.cost}" data-unlocked="${isUnlocked}">
        <span class="tile-emoji">${a.emoji}</span>
        <span class="tile-name">${a.name}</span>
        ${!isUnlocked ? `
          <div class="lock-badge">
            <span class="lock-icon">🔒</span>
            <span class="lock-cost">${a.cost}🪙</span>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");

  avatarGridEl.querySelectorAll(".avatar-tile").forEach((tile) => {
    tile.addEventListener("click", () => handleAvatarClick(tile, profile));
  });
}

async function handleAvatarClick(tile, profile){
  if (!currentUser) return;

  const id = tile.dataset.id;
  const cost = Number(tile.dataset.cost);
  const isUnlocked = tile.dataset.unlocked === "true";
  const currentId = profile.avatar?.id || "default";

  if (id === currentId) return; // already selected, nothing to do

  const uid = currentUser.uid;

  if (isUnlocked){
    try{
      await updateProfileData(uid, { "avatar.id": id });
    }catch(err){
      console.error("Failed to switch avatar:", err);
      showBanner("Couldn't switch avatars. Please try again.");
    }
    return;
  }

  // Locked — attempt purchase. spendCoins runs as an atomic Firestore
  // transaction, so it re-checks the real balance server-side even if
  // this client's cached `profile.coins` is stale — no double-spend
  // possible from a double-click or a second open tab.
  const avatar = findAvatarById(id);
  try{
    await spendCoins(uid, cost, {
      reason: `Unlocked avatar: ${avatar.name}`,
      category: "avatar"
    });
    await updateProfileData(uid, {
      "avatar.unlocked": arrayUnion(id),
      "avatar.id": id
    });
    showBanner(`${avatar.name} unlocked and equipped! 🎉`, "success");
  }catch(err){
    console.error("Failed to purchase avatar:", err);
    if (err.code === "coins/insufficient-funds"){
      showBanner(`Not enough coins — you need ${err.needed} more.`);
    } else {
      showBanner("Couldn't complete the purchase. Please try again.");
    }
  }
}

/* ---------------------------------------------------------------
   Render: statistics
--------------------------------------------------------------- */
function renderStats(profile){
  const s = profile.statistics || {};
  const gamesPlayed = s.gamesPlayed || 0;
  const wins = s.wins || 0;
  const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

  statsGridEl.innerHTML = `
    <div class="stat-box">
      <div class="stat-value">${gamesPlayed}</div>
      <div class="stat-label">Games Played</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${wins}</div>
      <div class="stat-label">Games Won</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${winRate}%</div>
      <div class="stat-label">Win Rate</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${profile.coins ?? 0}</div>
      <div class="stat-label">Coins</div>
    </div>
  `;

  const perGame = [
    { label: "Tic Tac Toe", played: s.ticTacToe?.played || 0 },
    { label: "Memory", played: s.memoryGame?.played || 0 },
    { label: "RPS", played: s.rockPaperScissors?.played || 0 },
    { label: "Guessing", played: s.numberGuessing?.played || 0 }
  ];
  const maxPlayed = Math.max(1, ...perGame.map((g) => g.played));

  statsBarsEl.innerHTML = perGame.map((g) => `
    <div class="stat-bar-row">
      <span class="stat-bar-label">${g.label}</span>
      <span class="stat-bar-track">
        <span class="stat-bar-fill" style="width:${(g.played / maxPlayed) * 100}%"></span>
      </span>
      <span class="stat-bar-value">${g.played}</span>
    </div>
  `).join("");
}

/* ---------------------------------------------------------------
   Render: achievements (with descriptions)
--------------------------------------------------------------- */
function renderAchievements(profile){
  const unlocked = profile.achievements || [];
  achievementsCountTagEl.textContent = `${unlocked.length} / ${ACHIEVEMENTS.length}`;
  guestAchievementsNoteEl.hidden = !profile.isGuest;

  achievementsGridFullEl.innerHTML = ACHIEVEMENTS.map((a) => {
    const isUnlocked = unlocked.includes(a.id);
    let descText = a.desc;
    if (!isUnlocked){
      const progress = getAchievementProgress(profile, a);
      descText = progress !== null ? `${Math.min(progress, a.target)} / ${a.target}` : "Locked";
    }
    return `
      <div class="achievement-card ${isUnlocked ? "unlocked" : "locked"}">
        <span class="achievement-icon">${a.icon}</span>
        <div class="achievement-text">
          <p class="achievement-title">${a.title}</p>
          <p class="achievement-desc">${descText}</p>
        </div>
      </div>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Auth guard + live Firestore subscription
--------------------------------------------------------------- */
let unsubscribeProfile = null;
let lastAchievementIds = null; // null = no snapshot seen yet, so nothing toasts on first load

function subscribeToProfile(uid){
  unsubscribeProfile = subscribeProfileData(uid, (profile) => {
    const currentAchievementIds = profile.achievements || [];
    const newlyUnlocked = findNewlyUnlocked(lastAchievementIds, currentAchievementIds);
    if (newlyUnlocked.length) showAchievementToasts(newlyUnlocked);
    lastAchievementIds = currentAchievementIds;

    reconcileSettingsFromProfile(profile);
    renderGuestBanner(profile);
    renderHero(currentUser, profile);
    renderAvatarGrid(profile);
    renderStats(profile);
    renderAchievements(profile);
  }, (err) => {
    console.error("Profile listener error:", err);
    showBanner("Couldn't load your profile. Check your connection.");
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
