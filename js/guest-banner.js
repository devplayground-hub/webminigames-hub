/* =====================================================================
   Guest Mode Banner — Web Mini Games Hub
   ---------------------------------------------------------------------
   One shared, non-intrusive "Guest Mode" indicator used on every page
   (hub, profile, settings, and all four games) so a guest always knows
   their progress isn't being saved — without a popup that interrupts
   gameplay.

   - Renders once per page as a static, in-flow banner (not a toast/
     modal), at the top of that page's <main id="main-content">.
   - Dismissible. The dismissal is remembered (sessionStorage) for the
     rest of this guest session, across every page, so it never nags
     the player again while they keep playing.
   - Automatically hidden for signed-in account users.
   - A fresh guest session (new guest, or a new guest session started
     after a logout) sees the banner again — see resetGuestBannerDismissal().

   Every page calls renderGuestBanner(profile) from its own profile
   listener; the DOM work below is the only place that logic lives, so
   no page/game duplicates its own guest-indicator markup or styling.
===================================================================== */

const DISMISS_KEY = "wmgh_guest_banner_dismissed";
let styleInjected = false;
let bannerEl = null;

function ensureStyles(){
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .guest-mode-banner{
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px 10px;
      flex-wrap: wrap;
      text-align: center;
      padding: 10px 40px 10px 16px;
      margin: 0 0 16px;
      border-radius: 12px;
      background: rgba(255, 201, 77, 0.12);
      border: 1px solid rgba(255, 201, 77, 0.35);
      color: #ffe8b0;
      font-family: 'Poppins', sans-serif;
      font-size: 13.5px;
      line-height: 1.5;
      position: relative;
      animation: guestBannerIn 0.25s ease-out;
    }
    .guest-mode-banner .guest-banner-title{ color: #ffc94d; font-weight: 700; }
    .guest-mode-banner .guest-banner-link{
      background: none;
      border: none;
      color: #ffc94d;
      font-weight: 700;
      text-decoration: underline;
      cursor: pointer;
      font-size: 13.5px;
      font-family: inherit;
      padding: 0;
    }
    .guest-mode-banner .guest-banner-link:hover{ opacity: 0.85; }
    .guest-mode-banner .guest-banner-close{
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: #ffe8b0;
      opacity: 0.65;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 6px;
      border-radius: 6px;
    }
    .guest-mode-banner .guest-banner-close:hover{ opacity: 1; background: rgba(255,255,255,0.08); }
    @keyframes guestBannerIn{
      from{ opacity: 0; transform: translateY(-6px); }
      to{ opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce){
      .guest-mode-banner{ animation: none; }
    }
  `;
  document.head.appendChild(style);
}

function isDismissed(){
  try{ return sessionStorage.getItem(DISMISS_KEY) === "1"; }catch{ return false; }
}
function setDismissed(){
  try{ sessionStorage.setItem(DISMISS_KEY, "1"); }catch{ /* ignore */ }
}

function removeBanner(){
  if (bannerEl){
    bannerEl.remove();
    bannerEl = null;
  }
}

/**
 * Shows (or hides) the shared Guest Mode banner at the top of the
 * page's #main-content, based on the given profile. Cheap to call on
 * every live profile update — it only touches the DOM when the guest
 * state actually changed since the last call.
 *
 * @param {Object|null} profile - the current live profile (or null before it loads)
 * @param {{upgradeHref?: string}} [options] - where "Create an account…" links to
 */
export function renderGuestBanner(profile, { upgradeHref = "settings.html" } = {}){
  const isGuest = !!profile?.isGuest;
  const shouldShow = isGuest && !isDismissed();

  if (!shouldShow){
    removeBanner();
    return;
  }

  if (bannerEl) return; // already showing, nothing to do

  const container = document.getElementById("main-content");
  if (!container) return;

  ensureStyles();
  bannerEl = document.createElement("div");
  bannerEl.className = "guest-mode-banner";
  bannerEl.setAttribute("role", "status");
  bannerEl.innerHTML = `
    <span>
      <span class="guest-banner-title">Guest Mode</span>
      — your progress, coins, achievements, and scores won't be saved.
      <button type="button" class="guest-banner-link" id="guestBannerUpgrade">Create an account to save your progress.</button>
    </span>
    <button type="button" class="guest-banner-close" id="guestBannerClose" aria-label="Dismiss this message">✕</button>
  `;
  container.prepend(bannerEl);

  bannerEl.querySelector("#guestBannerUpgrade").addEventListener("click", () => {
    window.location.href = upgradeHref;
  });
  bannerEl.querySelector("#guestBannerClose").addEventListener("click", () => {
    setDismissed();
    removeBanner();
  });
}

/** Call when a guest session ends (logout) so the NEXT guest session
 *  (this guest again, or a different one) sees the banner fresh
 *  instead of inheriting a stale "dismissed" flag from this tab. */
export function resetGuestBannerDismissal(){
  try{ sessionStorage.removeItem(DISMISS_KEY); }catch{ /* ignore */ }
  removeBanner();
}
