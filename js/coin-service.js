/* =====================================================================
   Coin Service — Web Mini Games Hub
   Reusable coin logic for every page and future game:
     - addCoins / spendCoins   → atomic balance changes (Firestore
       transaction for account users, in-memory for guests — decided
       once, centrally, by data-store.js)
     - getCoinBalance          → one-off balance read
     - animateCoinValue        → smooth count-up/down on any element
     - showCoinPopup           → floating "+10 🪙" / "-25 🪙" feedback
   No page-specific DOM is touched except the small floating popup,
   which is self-contained and injects its own styles on first use.
===================================================================== */

import { runCoinTransaction, getProfileData } from "./data-store.js";

/** Add coins to a user's balance. Throws on invalid amount or missing profile. */
export async function addCoins(uid, amount, meta = {}){
  if (!Number.isFinite(amount) || amount <= 0){
    throw new Error("addCoins: amount must be a positive number.");
  }
  return runCoinTransaction(uid, Math.round(amount), meta);
}

/** Spend coins from a user's balance. Throws `coins/insufficient-funds` if they can't afford it. */
export async function spendCoins(uid, amount, meta = {}){
  if (!Number.isFinite(amount) || amount <= 0){
    throw new Error("spendCoins: amount must be a positive number.");
  }
  return runCoinTransaction(uid, -Math.round(amount), meta);
}

/** One-off balance read — useful when you need a number without subscribing to the whole profile. */
export async function getCoinBalance(uid){
  const profile = await getProfileData(uid);
  return profile?.coins ?? 0;
}

/* ---------------------------------------------------------------
   Formatting
--------------------------------------------------------------- */
export function formatCoinAmount(n){
  return Number(n ?? 0).toLocaleString();
}

/* ---------------------------------------------------------------
   Animated count-up/count-down on any text-holding element.
   Pure DOM — no Firebase, safe to call from anywhere.
--------------------------------------------------------------- */
export function animateCoinValue(el, from, to, { duration = 700 } = {}){
  if (!el) return;
  const start = performance.now();
  const startVal = Number.isFinite(from) ? from : to;
  const diff = to - startVal;

  if (diff === 0){
    el.textContent = formatCoinAmount(to);
    return;
  }

  function frame(now){
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const value = Math.round(startVal + diff * eased);
    el.textContent = formatCoinAmount(value);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = formatCoinAmount(to);
  }
  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------
   Floating "+10 🪙" / "-25 🪙" popup near any anchor element.
   Injects its own keyframes once, so it works on any page with
   zero CSS setup required.
--------------------------------------------------------------- */
let stylesInjected = false;
function ensureCoinPopupStyles(){
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .coin-float-popup{
      position: fixed;
      pointer-events: none;
      font-family: 'Poppins', sans-serif;
      font-weight: 700;
      font-size: 15px;
      z-index: 9999;
      white-space: nowrap;
      animation: coinFloatUp 1.15s ease-out forwards;
    }
    .coin-float-popup.positive{ color: #ffc94d; text-shadow: 0 0 10px rgba(255,201,77,0.6); }
    .coin-float-popup.negative{ color: #ff5470; text-shadow: 0 0 10px rgba(255,84,112,0.6); }
    @keyframes coinFloatUp{
      0%{ opacity: 0; transform: translate(-50%, 0) scale(0.8); }
      15%{ opacity: 1; transform: translate(-50%, -6px) scale(1.05); }
      80%{ opacity: 1; transform: translate(-50%, -38px) scale(1); }
      100%{ opacity: 0; transform: translate(-50%, -54px) scale(0.95); }
    }
  `;
  document.head.appendChild(style);
}

export function showCoinPopup(amount, anchorEl){
  if (!anchorEl || !amount) return;
  ensureCoinPopupStyles();

  const rect = anchorEl.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = `coin-float-popup ${amount > 0 ? "positive" : "negative"}`;
  popup.textContent = `${amount > 0 ? "+" : ""}${formatCoinAmount(amount)} 🪙`;
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  document.body.appendChild(popup);

  setTimeout(() => popup.remove(), 1200);
}

/* ---------------------------------------------------------------
   Convenience: does both the count-up AND the floating popup in
   one call — the common case on every page that shows a coin pill.
--------------------------------------------------------------- */
export function reflectCoinChange(el, anchorEl, from, to){
  if (from === to) return;
  animateCoinValue(el, from, to);
  showCoinPopup(to - from, anchorEl);
}
