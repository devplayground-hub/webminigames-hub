/* =====================================================================
   Rock Paper Scissors — Page Bootstrap
   Owns the topbar (back button / title / sound toggle / coin pill),
   the auth guard, and the live coin/achievement/settings sync. All
   game rules live in rps-game.js; this file never touches move/score
   state directly.
===================================================================== */

import { applySavedSettingsOnLoad } from "./settings-service.js";
import { playClickSound } from "./game-audio.js";

import { initCoinPill, initBanner, wireSoundToggle } from "./game-shared.js";
import { bootGamePage } from "./game-page.js";
import { initHelpModal } from "./help-modal.js";
import * as RpsGame from "./rps-game.js";

applySavedSettingsOnLoad();

/* =====================================================================
   DOM refs
===================================================================== */
const backBtn = document.getElementById("backBtn");
const backBtnLabel = document.getElementById("backBtnLabel");
const topbarTitleEl = document.getElementById("topbarTitle");
const soundToggleBtn = document.getElementById("soundToggleBtn");

const coinAmountEl = document.getElementById("coinAmount");
const coinPillEl = document.getElementById("coinPill");
const pageBannerEl = document.getElementById("pageBanner");

initCoinPill(coinAmountEl, coinPillEl);
initBanner(pageBannerEl);
const renderSoundIcon = wireSoundToggle(soundToggleBtn);

/* =====================================================================
   Topbar sync — rps-game.js owns the actual screen switching; this
   just keeps the back-button label/title in step.
===================================================================== */
const SCREEN_META = {
  mode: { title: "✊ Rock Paper Scissors", backLabel: "Back to Hub" },
  game: { title: "✊ Rock Paper Scissors", backLabel: "Change Mode" }
};

let currentScreen = "mode";

RpsGame.onScreenChange((name) => {
  currentScreen = name;
  const meta = SCREEN_META[name];
  topbarTitleEl.textContent = meta.title;
  backBtnLabel.textContent = meta.backLabel;
});

backBtn.addEventListener("click", () => {
  if (currentScreen === "mode"){
    window.location.href = "../hub.html";
  } else {
    playClickSound();
    RpsGame.showModeScreen();
  }
});

/* =====================================================================
   Help (?) modal — one button for the whole game, on the Mode Select
   screen only. Same shared wiring as Tic-Tac-Toe / Memory / Number
   Guessing (open, ✕ close, backdrop click, Escape).
===================================================================== */
initHelpModal({
  btnId: "rpsHelpBtn",
  overlayId: "rpsHelpModalOverlay",
  closeBtnId: "rpsHelpModalCloseBtn"
});

/* =====================================================================
   Init
===================================================================== */
RpsGame.init();

/* =====================================================================
   Auth guard + live coin/achievement/settings sync (shared helper —
   see game-page.js for the logic every game page used to duplicate).
===================================================================== */
bootGamePage({ onSoundSettingsChange: renderSoundIcon });
