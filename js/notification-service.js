/* =====================================================================
   Notification Service — Web Mini Games Hub
   One reusable toast system for the whole app, covering five kinds of
   feedback:
     - success      → notifySuccess(title, message?, opts?)
     - warning      → notifyWarning(title, message?, opts?)
     - error        → notifyError(title, message?, opts?)
     - achievement  → notifyAchievement(achievement, opts?)
     - coin earned  → notifyCoinEarned(amount, reason?, opts?)

   Self-contained: injects its own CSS + DOM stack on first use, so any
   page can `import { notifySuccess } from "./notification-service.js"`
   and start calling it with zero markup or setup. Every toast gets a
   type-appropriate icon, an entrance/exit animation, an auto-dismiss
   progress bar (pauses on hover), and a settings-aware sound effect
   via game-audio.js.

   Generic escape hatch for anything that doesn't fit the five helpers:
     notify({ type, title, message, icon, duration, sound, reward, amount })
===================================================================== */

import {
  playSuccessSound,
  playWarningSound,
  playErrorSound,
  playAchievementSound,
  playCoinSound
} from "./game-audio.js";

/* ---------------------------------------------------------------
   Per-type presentation config: default icon markup, accent colors,
   the sound effect to play, and the label shown above the title.
--------------------------------------------------------------- */
const ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path class="wmgh-n-draw" d="M7.5 12.5l3 3 6-6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 22 20.5H2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9.5v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.15" fill="currentColor"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  achievement: null, // uses achievement.icon (emoji), falls back to trophy below
  coin: null // renders the animated 🪙 markup below
};

const TYPE_META = {
  success: { label: "Success", sound: playSuccessSound, className: "is-success" },
  warning: { label: "Warning", sound: playWarningSound, className: "is-warning" },
  error: { label: "Error", sound: playErrorSound, className: "is-error" },
  achievement: { label: "Achievement Unlocked", sound: playAchievementSound, className: "is-achievement" },
  coin: { label: "Coins Earned", sound: playCoinSound, className: "is-coin" }
};

const MAX_VISIBLE = 4;
const DEFAULT_DURATION = 4200;

/* ---------------------------------------------------------------
   Styles — injected once, self-contained, mirrors the app's neon
   dark palette (css/*.css :root vars) with sane fallback values so
   this still looks right on a page that hasn't defined them.
--------------------------------------------------------------- */
let stylesInjected = false;
function ensureStyles(){
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    #wmgh-notify-stack{
      position: fixed;
      top: 84px;
      right: 20px;
      z-index: 10500;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
      max-width: 360px;
    }
    @media (max-width: 560px){
      #wmgh-notify-stack{ left: 16px; right: 16px; top: 76px; max-width: none; }
    }

    .wmgh-notify{
      --accent: var(--neon-cyan, #00f0ff);
      pointer-events: auto;
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 280px;
      max-width: 360px;
      padding: 14px 16px 16px;
      border-radius: 16px;
      overflow: hidden;
      background: linear-gradient(135deg, rgba(20,10,45,0.97), rgba(10,14,39,0.97));
      border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 22px color-mix(in srgb, var(--accent) 25%, transparent);
      font-family: 'Poppins', sans-serif;
      color: var(--text-hi, #f4f6ff);
      backdrop-filter: blur(12px);
      animation: wmghNotifyIn 0.45s cubic-bezier(.22,1,.36,1) both;
    }
    @media (max-width: 560px){
      .wmgh-notify{ max-width: none; }
    }
    .wmgh-notify.is-leaving{ animation: wmghNotifyOut 0.28s cubic-bezier(.4,0,1,1) both; }
    .wmgh-notify.is-error{ animation: wmghNotifyIn 0.45s cubic-bezier(.22,1,.36,1) both, wmghShake 0.42s ease 0.45s 1; }

    .wmgh-notify.is-success{ --accent: var(--success, #35e0a1); }
    .wmgh-notify.is-warning{ --accent: #ffc94d; }
    .wmgh-notify.is-error{ --accent: var(--danger, #ff5470); }
    .wmgh-notify.is-achievement{ --accent: var(--neon-cyan, #00f0ff); }
    .wmgh-notify.is-coin{ --accent: #ffc94d; }

    .wmgh-n-icon{
      flex-shrink: 0;
      width: 40px; height: 40px;
      border-radius: 12px;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      animation: wmghIconPulse 1.6s ease-in-out infinite;
    }
    .wmgh-n-icon svg{ width: 22px; height: 22px; }
    .wmgh-n-icon .wmgh-n-draw{
      stroke-dasharray: 20;
      stroke-dashoffset: 20;
      animation: wmghDrawCheck 0.45s 0.15s cubic-bezier(.65,0,.35,1) forwards;
    }

    .wmgh-n-body{ min-width: 0; flex: 1; }
    .wmgh-n-label{ font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--accent); }
    .wmgh-n-title{ font-size: 14px; font-weight: 700; margin: 2px 0; line-height: 1.3; word-break: break-word; }
    .wmgh-n-desc{ font-size: 11.5px; color: var(--text-mid, rgba(244,246,255,0.7)); line-height: 1.35; word-break: break-word; }
    .wmgh-n-reward{ font-size: 11.5px; font-weight: 700; color: #ffc94d; margin-top: 4px; }
    .wmgh-n-amount{ font-size: 20px; font-weight: 800; color: #ffc94d; margin: 1px 0 2px; }

    .wmgh-n-close{
      flex-shrink: 0;
      background: none; border: none; cursor: pointer;
      color: var(--text-low, rgba(244,246,255,0.46));
      font-size: 15px; line-height: 1;
      padding: 2px 2px 2px 6px;
      transition: color 0.15s var(--ease, ease);
    }
    .wmgh-n-close:hover{ color: var(--text-hi, #f4f6ff); }

    .wmgh-n-bar{
      position: absolute; left: 0; bottom: 0;
      height: 3px; width: 100%;
      background: color-mix(in srgb, var(--accent) 70%, transparent);
      transform-origin: left;
      animation: wmghBarShrink linear forwards;
    }
    .wmgh-notify.is-paused .wmgh-n-bar{ animation-play-state: paused; }

    .wmgh-n-coin-icon{
      display: inline-block;
      animation: wmghCoinSpin 1.1s ease-in-out infinite;
    }

    @keyframes wmghNotifyIn{
      0%{ opacity: 0; transform: translateX(40px) scale(0.92); }
      60%{ opacity: 1; transform: translateX(-4px) scale(1.02); }
      100%{ opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes wmghNotifyOut{
      to{ opacity: 0; transform: translateX(40px) scale(0.9); }
    }
    @keyframes wmghShake{
      0%, 100%{ transform: translateX(0); }
      20%{ transform: translateX(-5px); }
      40%{ transform: translateX(4px); }
      60%{ transform: translateX(-3px); }
      80%{ transform: translateX(2px); }
    }
    @keyframes wmghIconPulse{
      0%, 100%{ box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent); }
      50%{ box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
    }
    @keyframes wmghDrawCheck{ to{ stroke-dashoffset: 0; } }
    @keyframes wmghBarShrink{ from{ transform: scaleX(1); } to{ transform: scaleX(0); } }
    @keyframes wmghCoinSpin{
      0%, 100%{ transform: rotateY(0deg); }
      50%{ transform: rotateY(180deg); }
    }

    @media (prefers-reduced-motion: reduce){
      .wmgh-notify, .wmgh-notify.is-error, .wmgh-n-icon, .wmgh-n-draw, .wmgh-n-coin-icon{
        animation-duration: 0.001ms !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function getStack(){
  let stack = document.getElementById("wmgh-notify-stack");
  if (!stack){
    stack = document.createElement("div");
    stack.id = "wmgh-notify-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

/* Toasts beyond MAX_VISIBLE wait here and get shown as older ones close,
   so a burst of achievements/errors never silently drops one. */
const queue = [];
let visibleCount = 0;

function renderNext(){
  if (visibleCount >= MAX_VISIBLE || queue.length === 0) return;
  const job = queue.shift();
  visibleCount++;
  renderToast(job);
}

function renderToast({ type, title, message, icon, duration, reward, amount, sound, dismissible }){
  ensureStyles();
  const meta = TYPE_META[type] || TYPE_META.success;

  const toast = document.createElement("div");
  toast.className = `wmgh-notify ${meta.className}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");

  const iconMarkup =
    icon ??
    (type === "achievement" ? "🏆" : type === "coin" ? `<span class="wmgh-n-coin-icon">🪙</span>` : ICONS[type]);

  toast.innerHTML = `
    <span class="wmgh-n-icon">${iconMarkup}</span>
    <span class="wmgh-n-body">
      <span class="wmgh-n-label">${meta.label}</span>
      ${type === "coin" && amount != null ? `<p class="wmgh-n-amount">+${Number(amount).toLocaleString()} 🪙</p>` : ""}
      ${title ? `<p class="wmgh-n-title">${title}</p>` : ""}
      ${message ? `<p class="wmgh-n-desc">${message}</p>` : ""}
      ${reward ? `<p class="wmgh-n-reward">+${reward} 🪙</p>` : ""}
    </span>
    ${dismissible ? `<button class="wmgh-n-close" aria-label="Dismiss notification">✕</button>` : ""}
    <span class="wmgh-n-bar" style="animation-duration:${duration}ms"></span>
  `;

  if (sound) meta.sound();

  let remaining = duration;
  let timerStart = performance.now();
  let timeoutId = null;
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timeoutId);
    toast.classList.add("is-leaving");
    setTimeout(() => {
      toast.remove();
      visibleCount--;
      renderNext();
    }, 300);
  };

  const arm = (ms) => {
    timerStart = performance.now();
    remaining = ms;
    timeoutId = setTimeout(dismiss, ms);
  };

  if (duration > 0){
    arm(duration);
    toast.addEventListener("mouseenter", () => {
      toast.classList.add("is-paused");
      clearTimeout(timeoutId);
      remaining -= performance.now() - timerStart;
    });
    toast.addEventListener("mouseleave", () => {
      toast.classList.remove("is-paused");
      arm(Math.max(remaining, 600));
    });
  } else {
    toast.querySelector(".wmgh-n-bar")?.remove();
  }

  const closeBtn = toast.querySelector(".wmgh-n-close");
  if (closeBtn) closeBtn.addEventListener("click", dismiss);

  toast._wmghDismiss = dismiss;
  getStack().appendChild(toast);
  return dismiss;
}

/* ---------------------------------------------------------------
   Core entry point. Every convenience helper below is a thin
   wrapper around this.
--------------------------------------------------------------- */
export function notify({
  type = "success",
  title = "",
  message = "",
  icon = null,
  duration = DEFAULT_DURATION,
  sound = true,
  reward = null,
  amount = null,
  dismissible = true
} = {}){
  if (!TYPE_META[type]){
    console.warn(`notify(): unknown type "${type}", falling back to "success".`);
    type = "success";
  }

  const job = { type, title, message, icon, duration, reward, amount, sound, dismissible };

  if (visibleCount >= MAX_VISIBLE){
    queue.push(job);
    return () => {
      const idx = queue.indexOf(job);
      if (idx !== -1) queue.splice(idx, 1);
    };
  }

  visibleCount++;
  return renderToast(job);
}

/** Dismisses every visible + queued notification immediately. */
export function dismissAllNotifications(){
  queue.length = 0;
  document.querySelectorAll(".wmgh-notify").forEach((el) => el._wmghDismiss?.());
}

/* ---------------------------------------------------------------
   Convenience helpers — one per notification kind.
--------------------------------------------------------------- */

/** e.g. notifySuccess("Profile saved", "Your changes are live.") */
export function notifySuccess(title, message = "", opts = {}){
  return notify({ type: "success", title, message, ...opts });
}

/** e.g. notifyWarning("Low on coins", "You need 20 more to buy this.") */
export function notifyWarning(title, message = "", opts = {}){
  return notify({ type: "warning", title, message, duration: 5000, ...opts });
}

/** e.g. notifyError("Couldn't save", "Check your connection and try again.") */
export function notifyError(title, message = "", opts = {}){
  return notify({ type: "error", title, message, duration: 6000, ...opts });
}

/**
 * e.g. notifyAchievement({ icon:"🥇", title:"First Win", desc:"Win your first game", reward:50 })
 * Accepts the same achievement objects already used by catalog.js / achievement-service.js.
 */
export function notifyAchievement(achievement, opts = {}){
  if (!achievement) return () => {};
  return notify({
    type: "achievement",
    title: achievement.title,
    message: achievement.desc,
    icon: achievement.icon,
    reward: achievement.reward || null,
    duration: 5000,
    ...opts
  });
}

/** e.g. notifyCoinEarned(50, "Daily mission completed") */
export function notifyCoinEarned(amount, reason = "", opts = {}){
  return notify({
    type: "coin",
    title: reason,
    amount,
    duration: 3800,
    ...opts
  });
}

/** Shows several notifications staggered slightly so they don't all pop at once. */
export function notifyMany(items){
  items.forEach((item, i) => {
    setTimeout(() => notify(item), i * 350);
  });
}
