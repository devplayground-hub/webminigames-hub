/* =====================================================================
   Web Mini Games Hub — Dashboard Controller
   Auth guard + live Firestore profile sync + all widget rendering.
===================================================================== */

import { watchAuthState, logoutUser, initSessionForUser } from "./auth-service.js";
import { subscribeProfileData } from "./data-store.js";
import { ACHIEVEMENTS, DAILY_MISSIONS } from "./catalog.js";
import {
  applySavedSettingsOnLoad,
  reconcileSettingsFromProfile
} from "./settings-service.js";
import { reflectCoinChange, animateCoinValue } from "./coin-service.js";
import {
  ensureMissionsFresh,
  recordMissionProgress,
  getMissionProgress,
  isMissionComplete,
  getMissionsResetLabel,
  DAILY_LOGIN_BONUS
} from "./missions-service.js";
import {
  unlockAchievement,
  findNewlyUnlocked,
  showAchievementToasts
} from "./achievement-service.js";
import { renderGuestBanner } from "./guest-banner.js";

/* Apply whatever theme/background was saved locally immediately —
   before auth or Firestore have responded — so there's no flash of
   default colors on load. */
applySavedSettingsOnLoad();

/* ---------------------------------------------------------------
   Static catalogs
--------------------------------------------------------------- */
const GAMES = [
  {
    id: "tic-tac-toe",
    title: "Tic Tac Toe",
    desc: "Classic 3x3, a disappearing-move twist, or the 9-board Ultimate challenge.",
    icon: "⭕",
    accent: "cyan",
    category: "Strategy",
    href: "games/tic-tac-toe.html"
  },
  {
    id: "memory",
    title: "Memory Match",
    desc: "Flip and match in 4x4 or 5x5 grids — peek mode and a shuffle twist included.",
    icon: "🧠",
    accent: "violet",
    category: "Focus",
    href: "games/memory.html"
  },
  {
    id: "rps",
    title: "Rock Paper Scissors",
    desc: "Classic best-of duels, or the extended Lizard-Spock-Fire-Water showdown.",
    icon: "✂️",
    accent: "magenta",
    category: "Reflex",
    href: "games/rps.html"
  },
  {
    id: "guess",
    title: "Number Guessing",
    desc: "Pick your range, spend coins on hints, and crack the number.",
    icon: "🔢",
    accent: "gold",
    category: "Logic",
    href: "games/number-guessing.html"
  }
];

const GAME_FILTERS = ["All", "Strategy", "Focus", "Reflex", "Logic"];

/* ---------------------------------------------------------------
   Element refs
--------------------------------------------------------------- */
const coinAmountEl   = document.getElementById("coinAmount");
const coinPillEl     = document.getElementById("coinPill");
const avatarCircleEl = document.getElementById("avatarCircle");
const usernameEl     = document.getElementById("usernameLabel");

const gamesGridEl        = document.getElementById("gamesGrid");
const gameFiltersEl      = document.getElementById("gameFilters");
const taskListEl         = document.getElementById("taskList");
const tasksResetTagEl    = document.getElementById("tasksResetTag");
const achievementsGridEl = document.getElementById("achievementsGrid");
const achievementsCountEl= document.getElementById("achievementsCount");

const heroGreetingEl = document.getElementById("heroGreeting");
const heroSubtitleEl = document.getElementById("heroSubtitle");
const heroAvatarEl   = document.getElementById("heroAvatar");
const heroChipsEl    = document.getElementById("heroChips");

const settingsBtn = document.getElementById("settingsBtn");
settingsBtn.addEventListener("click", () => { window.location.href = "settings.html"; });

const avatarBtn      = document.getElementById("avatarBtn");
const profilePopover = document.getElementById("profilePopover");
const logoutBtn      = document.getElementById("logoutBtn");
const viewProfileBtn = document.getElementById("viewProfileBtn");

/* ---------------------------------------------------------------
   Popover toggling (profile menu)
   Only one open at a time; click outside closes it.
--------------------------------------------------------------- */
const popovers = [
  { btn: avatarBtn, panel: profilePopover }
];

function closeAllPopovers(){
  popovers.forEach(({ btn, panel }) => {
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  });
}

popovers.forEach(({ btn, panel }) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !panel.hidden;
    closeAllPopovers();
    if (!isOpen){
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
  });
});

document.addEventListener("click", (e) => {
  const clickedInsidePopover = e.target.closest(".nav-popover-wrap");
  if (!clickedInsidePopover) closeAllPopovers();
});

/* ---------------------------------------------------------------
   Render: game cards + category filters (static content, once)
--------------------------------------------------------------- */
function renderGames(){
  gamesGridEl.innerHTML = GAMES.map((game) => `
    <article class="game-card accent-${game.accent}" data-href="${game.href}" data-category="${game.category}">
      <div class="game-card-top">
        <div class="game-icon">${game.icon}</div>
        <span class="game-category">${game.category}</span>
      </div>
      <h3 class="game-title">${game.title}</h3>
      <p class="game-desc">${game.desc}</p>
      <button class="game-play-btn" type="button">Play Now →</button>
    </article>
  `).join("");

  gamesGridEl.querySelectorAll(".game-card").forEach((card) => {
    card.addEventListener("click", () => {
      window.location.href = card.dataset.href;
    });
  });
}

function renderGameFilters(){
  gameFiltersEl.innerHTML = GAME_FILTERS.map((f, i) => `
    <button class="filter-chip ${i === 0 ? "active" : ""}" data-filter="${f}" role="tab" aria-selected="${i === 0}">${f}</button>
  `).join("");

  gameFiltersEl.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      gameFiltersEl.querySelectorAll(".filter-chip").forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-selected", "false");
      });
      chip.classList.add("active");
      chip.setAttribute("aria-selected", "true");

      const filter = chip.dataset.filter;
      gamesGridEl.querySelectorAll(".game-card").forEach((card) => {
        const match = filter === "All" || card.dataset.category === filter;
        card.style.display = match ? "" : "none";
      });
    });
  });
}

/* ---------------------------------------------------------------
   Render: navbar (avatar, username, coins)
--------------------------------------------------------------- */
let lastCoinValue = null;
let lastHeroCoinValue = null;

function renderNavbar(user, profile){
  const name = profile.displayName || (profile.isGuest ? "Guest Player" : "Player");
  usernameEl.textContent = name;

  if (profile.photoURL){
    avatarCircleEl.innerHTML = `<img src="${profile.photoURL}" alt="${name}" />`;
  } else {
    avatarCircleEl.textContent = profile.isGuest ? "G" : name.charAt(0).toUpperCase();
  }

  const newCoins = profile.coins ?? 0;
  if (lastCoinValue === null){
    coinAmountEl.textContent = newCoins;
  } else if (newCoins !== lastCoinValue){
    reflectCoinChange(coinAmountEl, coinPillEl, lastCoinValue, newCoins);
  }
  lastCoinValue = newCoins;
}

function renderHero(profile){
  const name = profile.displayName || (profile.isGuest ? "Guest Player" : "Player");
  const firstName = name.split(" ")[0];

  heroGreetingEl.textContent = `Welcome back, ${firstName} 👋`;
  heroSubtitleEl.textContent = profile.isGuest
    ? "Playing as a guest — sign up any time to keep your progress."
    : "Ready to climb the leaderboard? Pick a game below to get started.";

  if (profile.photoURL){
    heroAvatarEl.innerHTML = `<img src="${profile.photoURL}" alt="${name}" />`;
  } else {
    heroAvatarEl.textContent = profile.isGuest ? "G" : name.charAt(0).toUpperCase();
  }

  const gamesPlayed = profile.statistics?.gamesPlayed || 0;
  const unlockedAchievements = (profile.achievements || []).length;
  const newCoins = profile.coins ?? 0;

  if (!heroChipsEl.dataset.rendered){
    heroChipsEl.innerHTML = `
      <div class="hero-chip">
        <span class="chip-value" id="heroCoinsValue">${newCoins}</span>
        <span class="chip-label">Coins</span>
      </div>
      <div class="hero-chip">
        <span class="chip-value" id="heroGamesValue">${gamesPlayed}</span>
        <span class="chip-label">Games Played</span>
      </div>
      <div class="hero-chip">
        <span class="chip-value" id="heroAchievementsValue">${unlockedAchievements}</span>
        <span class="chip-label">Achievements</span>
      </div>
    `;
    heroChipsEl.dataset.rendered = "true";
    lastHeroCoinValue = newCoins;
  } else {
    const heroCoinsEl = document.getElementById("heroCoinsValue");
    if (lastHeroCoinValue !== null && newCoins !== lastHeroCoinValue){
      animateCoinValue(heroCoinsEl, lastHeroCoinValue, newCoins);
    } else {
      heroCoinsEl.textContent = newCoins;
    }
    lastHeroCoinValue = newCoins;
    document.getElementById("heroGamesValue").textContent = gamesPlayed;
    document.getElementById("heroAchievementsValue").textContent = unlockedAchievements;
  }
}

/* ---------------------------------------------------------------
   Render: daily missions
--------------------------------------------------------------- */
function renderDailyMissions(profile){
  taskListEl.innerHTML = DAILY_MISSIONS.map((mission) => {
    const isDone = isMissionComplete(profile, mission.id);
    const progress = isDone ? mission.target : getMissionProgress(profile, mission.id);
    return `
      <li class="task-item ${isDone ? "completed" : ""}">
        <span class="task-check">${isDone ? "✓" : mission.icon}</span>
        <span class="task-info">
          <span class="task-title">${mission.title}</span>
          <span class="task-progress">${progress}/${mission.target}</span>
        </span>
        <span class="task-reward">+${mission.reward}🪙</span>
      </li>
    `;
  }).join("");

  tasksResetTagEl.textContent = getMissionsResetLabel(profile);
}

/* ---------------------------------------------------------------
   Render: achievements
--------------------------------------------------------------- */
function renderAchievements(profile){
  const unlocked = profile.achievements || [];
  achievementsCountEl.textContent = `${unlocked.length} / ${ACHIEVEMENTS.length}`;

  achievementsGridEl.innerHTML = ACHIEVEMENTS.map((a) => {
    const isUnlocked = unlocked.includes(a.id);
    return `
      <div class="achievement-badge ${isUnlocked ? "unlocked" : "locked"}">
        ${a.icon}
        <span class="tooltip">${a.title}${isUnlocked ? "" : " (locked)"}</span>
      </div>
    `;
  }).join("");
}

/* ---------------------------------------------------------------
   Profile menu actions
--------------------------------------------------------------- */
logoutBtn.addEventListener("click", async () => {
  try{
    await logoutUser();
    window.location.href = "index.html";
  }catch(err){
    console.error("Logout failed:", err);
  }
});

viewProfileBtn.addEventListener("click", () => {
  window.location.href = "profile.html";
});

/* ---------------------------------------------------------------
   Onboarding checks — run once per session, right after the first
   profile snapshot arrives. Resets stale daily missions + grants the
   day's login bonus (handled by ensureMissionsFresh), and unlocks
   the one-time "Welcome Aboard" achievement.
--------------------------------------------------------------- */
async function runOnboardingChecks(uid, profile){
  try{
    const { justReset } = await ensureMissionsFresh(uid, profile);
    if (justReset){
      // The login bonus itself counts toward the "Earn 100 Coins"
      // mission — recorded explicitly here since ensureMissionsFresh
      // only owns the reset lifecycle, not progress tracking.
      await recordMissionProgress(uid, "coins_earned", DAILY_LOGIN_BONUS);
    }
  }catch(err){
    console.error("Mission reset check failed:", err);
  }

  try{
    // unlockAchievement handles the "already unlocked" check and the
    // coin reward internally — the toast itself is shown by the
    // profile snapshot handler below, via findNewlyUnlocked(), the
    // moment this write lands rather than from this call directly.
    await unlockAchievement(uid, "welcome");
    await recordMissionProgress(uid, "coins_earned", 25);
  }catch(err){
    console.error("Onboarding check failed:", err);
  }
}

/* ---------------------------------------------------------------
   Auth guard + live Firestore subscription
--------------------------------------------------------------- */
let currentUser = null;
let unsubscribeProfile = null;
let hasRunOnboarding = false;
let lastAchievementIds = null; // null = no snapshot seen yet, so nothing toasts on first load

function subscribeToProfile(uid){
  unsubscribeProfile = subscribeProfileData(uid, (profile) => {
    const currentAchievementIds = profile.achievements || [];
    const newlyUnlocked = findNewlyUnlocked(lastAchievementIds, currentAchievementIds);
    if (newlyUnlocked.length) showAchievementToasts(newlyUnlocked);
    lastAchievementIds = currentAchievementIds;

    renderNavbar(currentUser, profile);
    renderGuestBanner(profile);
    renderHero(profile);
    renderDailyMissions(profile);
    renderAchievements(profile);
    reconcileSettingsFromProfile(profile);

    if (!hasRunOnboarding){
      hasRunOnboarding = true;
      runOnboardingChecks(uid, profile);
    }
  }, (err) => {
    console.error("Profile listener error:", err);
  });
}

renderGames();
renderGameFilters();

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
