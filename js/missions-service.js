/* =====================================================================
   Missions Service — Web Mini Games Hub
   Daily missions: Play 3 Games, Win 2 Games, Earn 100 Coins, Use a
   Hint. Progress and the 24-hour reset window live under `missions`
   on the user's profile — permanently in Firestore for account
   users, in-memory-only for guests (see data-store.js). Reusable
   from any page or future game — call recordMissionProgress()
   whenever a tracked event happens, and this module handles capping,
   completion, and reward.
===================================================================== */

import { addCoins } from "./coin-service.js";
import { DAILY_MISSIONS } from "./catalog.js";
import { getProfileData, updateProfileData, toMillisSafe } from "./data-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DAILY_LOGIN_BONUS = 10;

function emptyProgress(){
  const progress = {};
  DAILY_MISSIONS.forEach((m) => { progress[m.id] = 0; });
  return progress;
}

function isStale(missions){
  if (!missions || !missions.lastReset) return true;
  return Date.now() - toMillisSafe(missions.lastReset) > DAY_MS;
}

/* ---------------------------------------------------------------
   Makes sure a profile's `missions` block exists and is within the
   current 24-hour window — resetting progress and granting the
   day's login bonus if not. Safe to call as often as you like: it
   only writes when a reset is actually needed.
   Returns the (possibly freshly-reset) missions object.
--------------------------------------------------------------- */
export async function ensureMissionsFresh(uid, profile){
  const current = profile?.missions;

  if (!isStale(current)){
    return { missions: current, justReset: false };
  }

  const fresh = {
    lastReset: new Date(),
    progress: emptyProgress(),
    completed: [],
    loginBonusClaimed: true
  };

  await updateProfileData(uid, { missions: fresh });
  await addCoins(uid, DAILY_LOGIN_BONUS, { reason: "Daily login bonus", category: "daily_task" });

  return { missions: fresh, justReset: true };
}

/* ---------------------------------------------------------------
   Records progress toward every mission matching `type` (e.g. a
   game finishing calls recordMissionProgress(uid, "games_played")).
   Automatically grants coins and marks a mission complete the
   moment its target is reached. Returns the missions that were
   newly completed by this call, if any, so the caller can show a
   celebration if it wants to.
--------------------------------------------------------------- */
export async function recordMissionProgress(uid, type, amount = 1){
  const profile = await getProfileData(uid);
  if (!profile) return [];

  const { missions } = await ensureMissionsFresh(uid, profile);

  const matching = DAILY_MISSIONS.filter(
    (m) => m.type === type && !missions.completed.includes(m.id)
  );
  if (matching.length === 0) return [];

  const newProgress = { ...missions.progress };
  const newlyCompleted = [];

  matching.forEach((m) => {
    const currentVal = newProgress[m.id] || 0;
    newProgress[m.id] = Math.min(m.target, currentVal + amount);
    if (newProgress[m.id] >= m.target){
      newlyCompleted.push(m);
    }
  });

  const updatedCompleted = [...missions.completed, ...newlyCompleted.map((m) => m.id)];

  await updateProfileData(uid, {
    "missions.progress": newProgress,
    "missions.completed": updatedCompleted
  });

  // Grant rewards after the progress write so a failed reward grant
  // (rare) doesn't also roll back progress that was genuinely made.
  for (const mission of newlyCompleted){
    await addCoins(uid, mission.reward, {
      reason: `Mission complete: ${mission.title}`,
      category: "mission"
    });
  }

  return newlyCompleted;
}

/* ---------------------------------------------------------------
   Pure read helper for rendering — safe to call even before a
   profile's `missions` field exists yet (returns 0 / not completed).
--------------------------------------------------------------- */
export function getMissionProgress(profile, missionId){
  return profile?.missions?.progress?.[missionId] ?? 0;
}

export function isMissionComplete(profile, missionId){
  return (profile?.missions?.completed || []).includes(missionId);
}

export function getMissionsResetLabel(profile){
  const lastResetMs = profile?.missions?.lastReset ? toMillisSafe(profile.missions.lastReset) : Date.now();
  const msLeft = Math.max(0, lastResetMs + DAY_MS - Date.now());
  const hrs = Math.floor(msLeft / 3600000);
  const mins = Math.floor((msLeft % 3600000) / 60000);
  return `resets in ${hrs}h ${mins}m`;
}
