/* =====================================================================
   Auth Service — Web Mini Games Hub
   Pure Firebase logic (no DOM). Reusable from the auth page, the hub,
   or any future page that needs to sign users in/out or read profiles.

   Account data (registered users) lives permanently in Firestore.
   Guests never touch Firebase at all — no Auth sign-in, no Firestore
   document. A guest's profile is an in-memory/sessionStorage-only
   object managed by data-store.js, identified by a locally-generated
   id, so it can never mix with, or be mistaken for, any real
   account's data, and leaves no record behind on any backend.
===================================================================== */

import { auth } from "./firebase-init.js";

import {
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  onAuthStateChanged,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  buildDefaultProfile,
  getProfileData,
  createProfileData,
  updateProfileData,
  deleteProfileData,
  startGuestSession,
  startFreshGuestSession,
  endGuestSession,
  isGuestActive,
  getCurrentGuestUid,
  peekStoredGuestUid
} from "./data-store.js";
import { clearGuestLocalSettings } from "./settings-service.js";
import { resetGuestBannerDismissal } from "./guest-banner.js";

/* ---------------------------------------------------------------
 * Guest ids
 * ---------------------------------------------------------------
 * Guests never sign in through Firebase Auth at all (that used to
 * be the root cause of the persistence bug: Firebase's anonymous
 * sign-in creates a real backend Auth record with LOCAL persistence
 * by default, so if the cleanup delete on logout ever failed — a
 * network blip, "requires-recent-login", etc. — or the browser
 * simply restored that persisted session later, the SAME anonymous
 * uid (and any data ever associated with it) could resurface on a
 * later "Continue as Guest" click). Guest ids are now generated
 * entirely client-side, are never sent to Firebase, and a brand-new
 * one is minted every single time "Continue as Guest" is clicked.
 */
function generateGuestUid(){
  const random = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `guest_${random}`;
}

/* ---------------------------------------------------------------
   Ensures a profile exists for this user and returns it.
   - Guests: an in-memory-only profile via data-store's guest
     session. Nothing is written to Firestore.
     - isFreshEntry=true (the normal case: the person just clicked
       "Continue as Guest") always starts a brand-new profile at
       default coins/progress, even if this uid happens to match a
       leftover sessionStorage entry from an earlier guest visit.
     - isFreshEntry=false is used only by initSessionForUser() below,
       to RESUME an already-in-progress guest session as the player
       navigates between pages within one continuous visit.
   - Everyone else: a real Firestore profile — created with defaults
     on first sign-in, otherwise just has lastLogin bumped.
--------------------------------------------------------------- */
export function ensureUserProfile(user, { isGuest = false, isFreshEntry = true } = {}){
  if (isGuest){
    return isFreshEntry ? startFreshGuestSession(user.uid) : startGuestSession(user.uid);
  }
  return ensureAccountProfile(user);
}

async function ensureAccountProfile(user){
  const existing = await getProfileData(user.uid);
  if (!existing){
    const profile = buildDefaultProfile({
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      isGuest: false
    });
    await createProfileData(user.uid, profile);
    return profile;
  }

  await updateProfileData(user.uid, { lastLogin: new Date() });
  return existing;
}

/* ---------------------------------------------------------------
   Email / Password
--------------------------------------------------------------- */
export async function registerWithEmail({ name, email, password }){
  // Mirrors loginWithEmail(): a guest session may still be active in this
  // tab. A normal sign-up creates a brand-new, unrelated account (unlike
  // linkGuestToEmail(), which is the explicit "upgrade this guest" path),
  // so make sure that new account is never read back through leftover
  // guest-session state.
  endGuestSession();

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name){
    await updateProfile(cred.user, { displayName: name });
  }
  const profile = await ensureUserProfile(cred.user, { isGuest: false });
  return { user: cred.user, profile };
}

export async function loginWithEmail({ email, password }){
  // A guest session may still be active in this tab (e.g. the person
  // opened index.html again while playing as a guest) — end it before
  // switching to a real account so guest progress can never bleed into
  // whichever account signs in next.
  endGuestSession();

  // Persist the session across browser restarts — there's no
  // "Remember me" toggle, so this is simply the one login behavior.
  await setPersistence(auth, browserLocalPersistence);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const profile = await ensureUserProfile(cred.user, { isGuest: false });
  return { user: cred.user, profile };
}

export async function resetPassword(email){
  await sendPasswordResetEmail(auth, email);
}

/* ---------------------------------------------------------------
   Guest mode
   Entirely client-side: no Firebase Auth sign-in and no Firestore
   document ever gets created for a guest. A brand-new random id is
   minted on every "Continue as Guest" click, so this can never
   resume, or collide with, an earlier guest's leftover progress.
--------------------------------------------------------------- */
export function continueAsGuest(){
  const uid = generateGuestUid();
  const profile = ensureUserProfile({ uid }, { isGuest: true, isFreshEntry: true });
  const user = { uid, isAnonymous: true, isGuest: true, displayName: "Guest Player" };
  return Promise.resolve({ user, profile });
}

/* ---------------------------------------------------------------
   Logout
   - Guests: wipe the in-memory/sessionStorage profile. There's no
     Firebase session to sign out of or delete — guests never had one.
   - Everyone else: a normal sign-out.
--------------------------------------------------------------- */
export async function logoutUser(){
  const wasGuest = isGuestActive();
  endGuestSession();
  resetGuestBannerDismissal();

  if (wasGuest){
    clearGuestLocalSettings();
    return;
  }

  await signOut(auth);
}

/* ---------------------------------------------------------------
   Create a permanent account for someone currently playing as a
   guest. This is a normal brand-new account creation — NOT a
   transfer of the guest's progress. A guest's in-memory coins,
   achievements, stats, and missions are never written to Firestore
   and never copied onto the new account; the new account starts at
   the same clean defaults (0 coins, no achievements, zeroed stats)
   as any other sign-up. Only the display name/email the person
   just typed carry over — those are new inputs, not guest data.
   There's no shared Firebase uid to "link" here (a guest never had
   one): a fresh account is created with a fresh default profile,
   and the guest session is discarded.
--------------------------------------------------------------- */
export async function linkGuestToEmail({ name, email, password }){
  const guestUid = getCurrentGuestUid();
  if (!guestUid){
    throw { code: "auth/no-current-user" };
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (name){
    await updateProfile(cred.user, { displayName: name });
  }

  const permanentProfile = buildDefaultProfile({
    uid: cred.user.uid,
    displayName: name,
    email,
    isGuest: false
  });

  // The guest session is now over — discard it (its in-memory coins/
  // progress are simply gone, by design) before writing the new
  // account's fresh profile, and before the caller's watchAuthState
  // fires for the freshly-signed-in account, so this tab is never
  // seen as "still guest" again.
  endGuestSession();
  clearGuestLocalSettings();
  await createProfileData(cred.user.uid, permanentProfile);

  return cred.user;
}

/* ---------------------------------------------------------------
   Permanently delete the current account: removes the Firestore
   profile first, then the Firebase Auth account itself. If Firebase
   reports the session is too old (auth/requires-recent-login), the
   caller should prompt the user to log in again before retrying.
--------------------------------------------------------------- */
export async function deleteAccount(){
  if (!auth.currentUser){
    throw { code: "auth/no-current-user" };
  }
  const uid = auth.currentUser.uid;
  await deleteProfileData(uid);
  await deleteUser(auth.currentUser);
}

/* ---------------------------------------------------------------
   Auth state observer for pages to use as their auth guard.
   Guests never sign in through Firebase, so Firebase's own
   onAuthStateChanged alone can't tell a page "a guest is playing" —
   it only ever reports real accounts (or null). This wrapper checks
   sessionStorage for an in-progress guest session on every firing
   and, if one is found, reports a synthetic guest "user" instead of
   whatever Firebase itself reported. A guest session always wins
   over a stale/absent Firebase auth state, and is always cleared
   (see endGuestSession() in logoutUser/loginWithEmail/registerWithEmail
   above) before a real account sign-in, so the two can never mix.
--------------------------------------------------------------- */
export function watchAuthState(callback){
  return onAuthStateChanged(auth, (firebaseUser) => {
    const guestUid = peekStoredGuestUid();
    if (guestUid){
      callback({ uid: guestUid, isAnonymous: true, isGuest: true, displayName: "Guest Player" });
      return;
    }
    callback(firebaseUser);
  });
}

/* ---------------------------------------------------------------
   Every page is a separate full page load, so data-store's guest
   session state (an in-memory module variable) starts fresh each
   time. Pages call this once watchAuthState() resolves a signed-in
   user, BEFORE subscribing to profile data, so a guest's session is
   resumed from sessionStorage (or started fresh) and every later
   read/write on this page correctly stays in memory instead of
   hitting Firestore. No-op for real accounts.
--------------------------------------------------------------- */
export function initSessionForUser(user){
  if (user?.isAnonymous){
    startGuestSession(user.uid);
  }
}

/* ---------------------------------------------------------------
   Friendly error messages for every code these flows can throw
--------------------------------------------------------------- */
export function friendlyAuthError(error){
  const map = {
    "auth/invalid-email":            "That email address doesn't look right.",
    "auth/user-disabled":            "This account has been disabled.",
    "auth/user-not-found":           "No account found with that email.",
    "auth/wrong-password":           "Incorrect password. Try again.",
    "auth/invalid-credential":       "Incorrect email or password.",
    "auth/email-already-in-use":     "An account with this email already exists.",
    "auth/weak-password":            "Password should be at least 6 characters.",
    "auth/too-many-requests":        "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed":   "Network error. Check your connection and try again.",
    "auth/operation-not-allowed":    "This sign-in method isn't enabled for this project yet.",
    "auth/credential-already-in-use":"That email is already linked to another account.",
    "auth/requires-recent-login":    "This action needs a recent login. Please log out and back in, then try again.",
    "auth/no-current-user":          "You need to be signed in to do that."
  };
  return map[error.code] || "Something went wrong. Please try again.";
}
