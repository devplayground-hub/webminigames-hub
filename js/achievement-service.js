/* =====================================================================
   Achievement Service — Web Mini Games Hub
   Tracks milestones across every game: First Win, 10 Wins, 50 Wins,
   100 Games Played, Memory Master, Lucky Guesser (+ Welcome Aboard).
   Reusable from any page or future game:
     - recordGameResult(uid, {gameKey, won}) → the one call every game
       makes when a match ends; updates stats, checks achievements,
       AND feeds the daily missions system in one go.
     - recordAchievementProgress(uid, type, amount) → generic counter
       check, for achievement types not tied to overall win/play stats
       (Memory Master, Lucky Guesser).
     - unlockAchievement(uid, id) → direct grant, used for one-off
       achievements like "Welcome Aboard" that aren't threshold-based.
     - showAchievementToast(achievement) → animated unlock popup,
       rendered via the shared js/notification-service.js toast system.
     - findNewlyUnlocked(previousIds, currentIds) → diff helper so any
       page with a live profile listener can detect + celebrate an
       unlock the instant it happens, no matter what triggered it.

   Reads/writes go through data-store.js, so these calls work exactly
   the same whether `uid` belongs to a registered account (persisted
   to Firestore) or the current tab's guest session (in-memory only,
   never persisted) — the branching happens once, in data-store.js.
===================================================================== */

import { addCoins } from "./coin-service.js";
import { recordMissionProgress } from "./missions-service.js";
import { ACHIEVEMENTS } from "./catalog.js";
import { notifyAchievement } from "./notification-service.js";
import { getProfileData, updateProfileData, increment } from "./data-store.js";

/* ---------------------------------------------------------------
   Achievement types whose progress is read directly from a profile's
   lifetime `statistics` instead of a separate counter, since those
   numbers already exist and are the single source of truth.
--------------------------------------------------------------- */
const STATS_DERIVED_TYPES = {
  wins: (profile) => profile.statistics?.wins || 0,
  games_played: (profile) => profile.statistics?.gamesPlayed || 0
};

/* Maps a game's key (used by game pages) to its field name inside statistics. */
const GAME_STAT_KEYS = {
  "tic-tac-toe": "ticTacToe",
  "memory": "memoryGame",
  "rps": "rockPaperScissors",
  "guess": "numberGuessing"
};

/* ---------------------------------------------------------------
   Direct grant — used for one-off achievements (Welcome Aboard) and
   internally by recordAchievementProgress once a threshold is met.
   Safe to call repeatedly: no-ops if already unlocked.
--------------------------------------------------------------- */
export async function unlockAchievement(uid, achievementId){
  const achievement = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!achievement) return null;

  const profile = await getProfileData(uid);
  if (!profile) return null;

  const unlocked = profile.achievements || [];
  if (unlocked.includes(achievementId)) return null;

  await updateProfileData(uid, { achievements: [...unlocked, achievementId] });

  if (achievement.reward){
    await addCoins(uid, achievement.reward, {
      reason: `Achievement unlocked: ${achievement.title}`,
      category: "achievement"
    });
  }

  return achievement;
}

/* ---------------------------------------------------------------
   Generic threshold check — bumps the running count for `type` (for
   non-stats-derived types) or reads the current stat value directly
   (for "wins" / "games_played"), then unlocks any matching
   achievement whose target has now been reached.
   Returns the achievements newly unlocked by this call.
--------------------------------------------------------------- */
export async function recordAchievementProgress(uid, type, amount = 1){
  const profile = await getProfileData(uid);
  if (!profile) return [];

  const unlockedIds = profile.achievements || [];
  const candidates = ACHIEVEMENTS.filter((a) => a.type === type && !unlockedIds.includes(a.id));
  if (candidates.length === 0) return [];

  let currentValue;
  if (STATS_DERIVED_TYPES[type]){
    currentValue = STATS_DERIVED_TYPES[type](profile);
  } else {
    const progress = { ...(profile.achievementProgress || {}) };
    currentValue = (progress[type] || 0) + amount;
    progress[type] = currentValue;
    await updateProfileData(uid, { achievementProgress: progress });
  }

  const newlyUnlocked = [];
  for (const achievement of candidates){
    if (currentValue >= achievement.target){
      const result = await unlockAchievement(uid, achievement.id);
      if (result) newlyUnlocked.push(result);
    }
  }
  return newlyUnlocked;
}

/* ---------------------------------------------------------------
   The single entry point every game calls when a match ends.
   Updates lifetime statistics, checks win/games-played achievements,
   and feeds the daily missions system — all from one call.

   gameKey: "tic-tac-toe" | "memory" | "rps" | "guess"
   won: true/false (a draw should pass won: false)

   Returns { unlockedAchievements, completedMissions } so the calling
   game page can show whatever celebration UI it wants, on top of the
   automatic toast every page already shows via findNewlyUnlocked().
--------------------------------------------------------------- */
export async function recordGameResult(uid, { gameKey, won = false } = {}){
  const statKey = GAME_STAT_KEYS[gameKey];

  const patch = {
    "statistics.gamesPlayed": increment(1),
    [`statistics.${won ? "wins" : "losses"}`]: increment(1)
  };
  if (statKey){
    patch[`statistics.${statKey}.played`] = increment(1);
    if (won && (statKey === "ticTacToe" || statKey === "rockPaperScissors" || statKey === "numberGuessing")){
      patch[`statistics.${statKey}.wins`] = increment(1);
    }
  }

  await updateProfileData(uid, patch);

  const unlockedAchievements = [
    ...await recordAchievementProgress(uid, "games_played"),
    ...(won ? await recordAchievementProgress(uid, "wins") : [])
  ];

  const completedMissions = [
    ...await recordMissionProgress(uid, "games_played", 1),
    ...(won ? await recordMissionProgress(uid, "games_won", 1) : [])
  ];

  return { unlockedAchievements, completedMissions };
}

/* ---------------------------------------------------------------
   Pure read helper for rendering progress on locked achievements
   (e.g. "7 / 10" under a still-locked "10 Wins" badge).
--------------------------------------------------------------- */
export function getAchievementProgress(profile, achievement){
  if (!achievement.type || !achievement.target) return null;
  if (STATS_DERIVED_TYPES[achievement.type]) return STATS_DERIVED_TYPES[achievement.type](profile);
  return profile?.achievementProgress?.[achievement.type] || 0;
}

/* ---------------------------------------------------------------
   Diff helper — call this from any page's profile listener with the
   previous and current `achievements` id arrays. Returns the full
   achievement objects for anything newly unlocked, so a toast can be
   shown regardless of what triggered the unlock.
   Pass `previousIds` as null on the very first snapshot so existing
   achievements don't all toast at once on page load.
--------------------------------------------------------------- */
export function findNewlyUnlocked(previousIds, currentIds){
  if (!previousIds) return [];
  const newIds = currentIds.filter((id) => !previousIds.includes(id));
  return newIds.map((id) => ACHIEVEMENTS.find((a) => a.id === id)).filter(Boolean);
}

/* ---------------------------------------------------------------
   Animated unlock toast. Rendering now lives in the shared
   notification-service.js (one toast stack, one CSS injection, one
   sound engine for every kind of in-app notification) — these two
   functions are kept as thin wrappers so every existing call site
   (hub.js, profile.js, each game page, etc.) keeps working unchanged.
--------------------------------------------------------------- */
export function showAchievementToast(achievement){
  if (!achievement) return;
  notifyAchievement(achievement);
}

/** Shows multiple unlock toasts staggered slightly so they don't all pop at once. */
export function showAchievementToasts(achievements){
  achievements.forEach((achievement, i) => {
    setTimeout(() => notifyAchievement(achievement), i * 350);
  });
}
