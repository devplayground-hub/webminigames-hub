/* =====================================================================
   Memory Match — Page Bootstrap
   Owns the topbar (back button / title / sound toggle / coin pill),
   the auth guard, and the live coin/achievement/settings sync. All
   game rules live in memory-game.js; this file never touches board
   state directly.
===================================================================== */

import { applySavedSettingsOnLoad } from "./settings-service.js";
import { playClickSound } from "./game-audio.js";

import { initCoinPill, initBanner, wireSoundToggle } from "./game-shared.js";
import { bootGamePage } from "./game-page.js";
import { initHelpModal } from "./help-modal.js";
import * as MemoryGame from "./memory-game.js";

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
   Help (?) modal — same button/modal/close/animation as RPS.
===================================================================== */
initHelpModal({
  btnId: "memoryHelpBtn",
  overlayId: "memoryHelpModalOverlay",
  closeBtnId: "memoryHelpModalCloseBtn"
});

/* =====================================================================
   Topbar sync — memory-game.js owns the actual screen switching; this
   just keeps the back-button label/title in step with it.
===================================================================== */
const SCREEN_META = {
  setup: { title: "🧠 Memory Match", backLabel: "Back to Hub" },
  game: { title: "🧠 Memory Match", backLabel: "Change Setup" }
};

let currentScreen = "setup";

MemoryGame.onScreenChange((name) => {
  currentScreen = name;
  const meta = SCREEN_META[name];
  topbarTitleEl.textContent = meta.title;
  backBtnLabel.textContent = meta.backLabel;
});

backBtn.addEventListener("click", () => {
  if (currentScreen === "setup"){
    window.location.href = "../hub.html";
  } else {
    playClickSound();
    MemoryGame.showSetupScreen();
  }
});

/* =====================================================================
   Init
===================================================================== */
MemoryGame.init();

/* =====================================================================
   Auth guard + live coin/achievement/settings sync (shared helper —
   see game-page.js for the logic every game page used to duplicate).
===================================================================== */
bootGamePage({ onSoundSettingsChange: renderSoundIcon });
