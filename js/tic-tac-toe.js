/* =====================================================================
   Tic Tac Toe — Page Bootstrap
   Owns the three top-level screens (Mode Select / Classic / Ultimate —
   only one visible at a time), the auth guard, the live coin/
   achievement/settings sync, and the shared sound toggle. All game
   rules live in ttt-classic.js and ttt-ultimate.js; this file never
   touches board state directly.

   Performance note: ttt-classic.js and ttt-ultimate.js are each a
   sizeable, fully independent rules engine (board state, AI, DOM).
   Most sessions only ever play one variant, so instead of statically
   importing both up front, this file lazy-loads each variant with a
   dynamic import() the first time the player actually chooses it (see
   loadVariant() below). The unplayed variant's code is never fetched,
   parsed, or executed for that session.
===================================================================== */

import { applySavedSettingsOnLoad } from "./settings-service.js";
import { playClickSound } from "./game-audio.js";

import { initCoinPill, initBanner, wireSoundToggle } from "./game-shared.js";
import { bootGamePage } from "./game-page.js";
import { initHelpModal } from "./help-modal.js";

applySavedSettingsOnLoad();

/* =====================================================================
   DOM refs
===================================================================== */
const screens = {
  "mode-select": document.getElementById("modeSelectScreen"),
  classic: document.getElementById("classicScreen"),
  ultimate: document.getElementById("ultimateScreen")
};

const backBtn = document.getElementById("backBtn");
const backBtnLabel = document.getElementById("backBtnLabel");
const topbarTitleEl = document.getElementById("topbarTitle");
const soundToggleBtn = document.getElementById("soundToggleBtn");

const chooseClassicBtn = document.getElementById("chooseClassicBtn");
const chooseUltimateBtn = document.getElementById("chooseUltimateBtn");

const setupModeSegmented = document.getElementById("setupModeSegmented");
const setupDifficultyGroup = document.getElementById("setupDifficultyGroup");
const setupDifficultySegmented = document.getElementById("setupDifficultySegmented");
const setupStartBtn = document.getElementById("setupStartBtn");

const coinAmountEl = document.getElementById("coinAmount");
const coinPillEl = document.getElementById("coinPill");
const pageBannerEl = document.getElementById("pageBanner");

initCoinPill(coinAmountEl, coinPillEl);
initBanner(pageBannerEl);
// Reuses the same sound-toggle wiring every other game page uses, instead
// of a page-local re-implementation (this page used to have its own).
const renderSoundIcon = wireSoundToggle(soundToggleBtn);

/* =====================================================================
   Help (?) modal — same button/modal/close/animation as RPS.
===================================================================== */
initHelpModal({
  btnId: "tttHelpBtn",
  overlayId: "tttHelpModalOverlay",
  closeBtnId: "tttHelpModalCloseBtn"
});

/* =====================================================================
   Variant loading — see the perf note above. Each variant module is
   fetched + init()'d at most once per page load, on first selection.
===================================================================== */
const variantModules = { classic: null, ultimate: null };

async function loadVariant(variant){
  if (!variantModules[variant]){
    const mod = variant === "classic"
      ? await import("./ttt-classic.js")
      : await import("./ttt-ultimate.js");
    mod.init(); // builds that variant's board DOM the first time it's needed
    variantModules[variant] = mod;
  }
  return variantModules[variant];
}

/* =====================================================================
   Game setup — Player vs Player / Player vs Computer + difficulty live
   right on the mode-select page, below the Classic/Ultimate cards.
   Whichever card is currently selected owns the Mode/Difficulty picks
   below it; each variant remembers its own last-picked settings.
===================================================================== */
const variantCards = {
  classic: chooseClassicBtn,
  ultimate: chooseUltimateBtn
};

const variantConfig = {
  classic: { mode: "pvp", difficulty: "medium" },
  ultimate: { mode: "pvp", difficulty: "medium" }
};

let selectedVariant = "classic"; // "classic" | "ultimate" — Classic pre-selected on load

/** Re-renders the mode-select cards + segmented controls for the currently selected variant. */
function renderSetupControls(){
  const cfg = variantConfig[selectedVariant];

  Object.entries(variantCards).forEach(([variant, card]) => {
    const isSelected = variant === selectedVariant;
    card.classList.toggle("selected", isSelected);
    card.setAttribute("aria-pressed", String(isSelected));
  });

  setupModeSegmented.querySelectorAll(".segment").forEach((s) => {
    const active = s.dataset.mode === cfg.mode;
    s.classList.toggle("active", active);
    s.setAttribute("aria-selected", String(active));
  });
  setupDifficultyGroup.hidden = cfg.mode !== "pvc";
  setupDifficultySegmented.querySelectorAll(".segment").forEach((s) => {
    const active = s.dataset.difficulty === cfg.difficulty;
    s.classList.toggle("active", active);
    s.setAttribute("aria-selected", String(active));
  });
}

function selectVariant(variant){
  if (variant === selectedVariant) return;
  selectedVariant = variant;
  playClickSound();
  renderSetupControls();
}

chooseClassicBtn.addEventListener("click", () => selectVariant("classic"));
chooseUltimateBtn.addEventListener("click", () => selectVariant("ultimate"));

setupModeSegmented.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  const cfg = variantConfig[selectedVariant];
  if (btn.dataset.mode === cfg.mode) return;
  cfg.mode = btn.dataset.mode;
  playClickSound();
  renderSetupControls();
});

setupDifficultySegmented.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  const cfg = variantConfig[selectedVariant];
  if (btn.dataset.difficulty === cfg.difficulty) return;
  cfg.difficulty = btn.dataset.difficulty;
  playClickSound();
  renderSetupControls();
});

setupStartBtn.addEventListener("click", async () => {
  playClickSound();
  const variant = selectedVariant;
  const cfg = variantConfig[variant];
  const mod = await loadVariant(variant); // no-op fetch if already loaded
  // The player may have switched screens again while the module was
  // loading; only apply/enter if their choice is still the one we loaded.
  if (variant !== selectedVariant) return;
  mod.applyConfig(cfg);
  showScreen(variant);
});

/* =====================================================================
   Screen switching — exactly one of the three screens is visible.
===================================================================== */
const SCREEN_META = {
  "mode-select": { title: "⭕ Tic Tac Toe", backLabel: "Back to Hub" },
  classic: { title: "⭕ Classic Mode", backLabel: "Change Mode" },
  ultimate: { title: "🌌 Ultimate Mode", backLabel: "Change Mode" }
};

let currentScreen = "mode-select";

function showScreen(name){
  currentScreen = name;
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
  const meta = SCREEN_META[name];
  topbarTitleEl.textContent = meta.title;
  backBtnLabel.textContent = meta.backLabel;

  // Both variants are lazy-loaded, so only call onEnter() on one that has
  // actually finished loading (it always will have, by the time its own
  // screen is shown — see setupStartBtn above).
  variantModules[name]?.onEnter?.();
}

backBtn.addEventListener("click", () => {
  if (currentScreen === "mode-select"){
    window.location.href = "../hub.html";
  } else {
    playClickSound();
    showScreen("mode-select");
  }
});

renderSetupControls();
showScreen("mode-select");

/* =====================================================================
   Auth guard + live coin/achievement/settings sync (shared helper —
   see game-page.js for the logic every game page used to duplicate).
===================================================================== */
bootGamePage({ onSoundSettingsChange: renderSoundIcon });
