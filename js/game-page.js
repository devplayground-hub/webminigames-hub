/* =====================================================================
   Game Page Boot — Web Mini Games Hub
   Every game's page-bootstrap file (tic-tac-toe.js, memory.js, rps.js,
   number-guessing.js) needs the exact same three things on load:
     1. Redirect to the login page if nobody is signed in.
     2. Subscribe to that user's profile (Firestore for an account,
        in-memory-only for a guest — data-store.js decides which).
     3. On every profile update: push the new coin total into the coin
        pill, diff the achievements array so newly-unlocked ones toast
        exactly once, and reconcile the sound setting.
   That block used to be copy-pasted into all four files (~35 lines
   each, one tiny wording difference away from drifting out of sync).
   It now lives here once — bootGamePage() is the only thing a game
   controller needs to call.
===================================================================== */

import { watchAuthState, initSessionForUser } from "./auth-service.js";
import { subscribeProfileData } from "./data-store.js";
import { reconcileSettingsFromProfile } from "./settings-service.js";
import { findNewlyUnlocked, showAchievementToasts } from "./achievement-service.js";
import { setCurrentUser, setProfile, reflectCoins } from "./game-shared.js";
import { renderGuestBanner } from "./guest-banner.js";

/**
 * Wires up the auth guard and the live profile → UI sync for a game page.
 *
 * @param {Object}   [options]
 * @param {string}   [options.loginRedirect="../index.html"]
 *        Where to send the browser when no user is signed in.
 * @param {(soundEnabled: boolean) => void} [options.onSoundSettingsChange]
 *        Called whenever the reconciled settings say sound should be
 *        rendered a certain way (e.g. after a cross-device settings change).
 *        Typically the render function returned by `wireSoundToggle()`.
 * @param {(err: Error) => void} [options.onError]
 *        Called if the profile listener errors out. Defaults to a
 *        console.error so failures are never silently swallowed.
 */
export function bootGamePage({
  loginRedirect = "../index.html",
  onSoundSettingsChange,
  onError = (err) => console.error("Profile listener error:", err)
} = {}){
  // null = "no snapshot seen yet" so nothing toasts on the very first load
  let lastAchievementIds = null;

  function subscribeToProfile(uid){
    subscribeProfileData(uid, (profile) => {
      setProfile(profile);
      renderGuestBanner(profile, { upgradeHref: "../settings.html" });

      const currentAchievementIds = profile.achievements || [];
      const newlyUnlocked = findNewlyUnlocked(lastAchievementIds, currentAchievementIds);
      if (newlyUnlocked.length) showAchievementToasts(newlyUnlocked);
      lastAchievementIds = currentAchievementIds;

      reflectCoins(profile.coins ?? 0);

      const merged = reconcileSettingsFromProfile(profile);
      onSoundSettingsChange?.(merged.soundEnabled);
    }, onError);
  }

  watchAuthState((user) => {
    if (!user){
      window.location.href = loginRedirect;
      return;
    }
    initSessionForUser(user);
    setCurrentUser(user);
    subscribeToProfile(user.uid);
  });
}
