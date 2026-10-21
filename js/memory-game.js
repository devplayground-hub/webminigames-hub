/* =====================================================================
   Memory Match — Game Controller
   Owns the Setup screen (grid size + mode) and the Game screen (board,
   timer, score, shuffle interval, completion). Talks to
   Firestore only through the shared coin/achievement/mission services
   — no duplicate coin or achievement logic here.
===================================================================== */

import { generateDeck, shuffleArray } from "./memory-core.js";
import { addCoins, spendCoins, formatCoinAmount } from "./coin-service.js";
import { recordGameResult, recordAchievementProgress } from "./achievement-service.js";
import { updateProfileData } from "./data-store.js";
import {
  playFlipSound, playMatchSound, playMismatchSound, playShuffleSound,
  playBonusSound, playCompleteSound, playClickSound
} from "./game-audio.js";
import { getCurrentUser, getProfile, showBanner } from "./game-shared.js";

/* =====================================================================
   Tunables
===================================================================== */
const BASE_MATCH_POINTS = { 4: 100, 5: 140 };
const COMBO_STEP = 0.15;
const COMBO_CAP = 2.5;
const SHUFFLE_MODE_MULTIPLIER = 1.2;
const MISMATCH_PENALTY = 10;
const TIME_BONUS_WINDOW_SEC = 300; // finishing within 5 minutes earns the full window
const TIME_BONUS_RATE = 2;         // points per second under the window
const SHUFFLE_INTERVAL_MS = 10000; // "Every 10 seconds"
const BONUS_SCORE = 150;
const BONUS_COINS = 10;
const REVEAL_COST = 50;
const REVEAL_DURATION_MS = 3000; // "Reveal for 3 Seconds"

/* =====================================================================
   STATE
===================================================================== */
let gridSize = 4;
let mode = "classic";           // "classic" | "shuffle"
let pendingGridSize = 4;        // chosen on the setup screen before a mode is picked

let cellStates = [];            // [{ type: "pair"|"bonus"|"bonus-claimed", symbol, matched }]
let cardEls = [];
let totalPairs = 0;
let matchesFound = 0;
let wrongAttempts = 0;          // tracked silently — only used for the "no mismatches" achievement

let flippedIndices = [];
let isComparing = false;        // true while a flipped pair is being resolved
let boardLocked = false;
let gameActive = false;

let score = 0;
let comboMultiplier = 1;

let elapsedMs = 0;
let timerInterval = null;
let shuffleInterval = null;
let revealActive = false; // true while the "Reveal for 3 Seconds" peek is in progress
let revealTimeoutId = null;

/* =====================================================================
   DOM refs (resolved once in init())
===================================================================== */
let setupScreenEl, gameScreenEl;
let gridSegmented, chooseClassicBtn, chooseShuffleBtn;
let gameTitleEl, timerValueEl, scoreValueEl, comboBoxEl, comboValueEl;
let boardEl, restartBtn, revealBtn;
let shuffleToastEl;
let completionOverlayEl, completionTimeEl, completionScoreEl, completionCoinsEl;
let playAgainBtn, changeSetupFromCompletionBtn;

/* Small hook so the page bootstrap (which owns the topbar back-button
   label + title) can stay in sync with screen changes made from here. */
const screenChangeListeners = [];
export function onScreenChange(fn){ screenChangeListeners.push(fn); }
function notifyScreenChange(name){ screenChangeListeners.forEach((fn) => fn(name)); }

export function showSetupScreen(){
  stopTimers();
  gameActive = false;
  setupScreenEl.classList.add("active");
  gameScreenEl.classList.remove("active");
  notifyScreenChange("setup");
}
export function showGameScreenFor(chosenMode){
  setupScreenEl.classList.remove("active");
  gameScreenEl.classList.add("active");
  startNewGame(chosenMode, pendingGridSize);
  notifyScreenChange("game");
}

/* =====================================================================
   Board rendering
===================================================================== */
function renderBoardDOM(){
  boardEl.className = `memory-board grid-${gridSize}`;
  boardEl.innerHTML = "";
  cardEls = [];

  cellStates.forEach((cell, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = cell.type === "bonus" ? "memory-card bonus" : "memory-card";
    btn.dataset.index = String(i);
    btn.setAttribute("aria-label", cell.type === "bonus" ? "Bonus star card" : `Memory card ${i + 1}`);
    btn.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-card-face memory-card-front">❔</div>
        <div class="memory-card-face memory-card-back">${cell.symbol}</div>
      </div>`;
    btn.addEventListener("click", () => handleCardClick(i));
    boardEl.appendChild(btn);
    cardEls.push(btn);
  });
}

function flipFaceUp(i){
  const el = cardEls[i];
  if (!el) return;
  el.classList.add("flipped");
}
function flipFaceDown(i){
  const el = cardEls[i];
  if (!el) return;
  el.classList.remove("flipped", "mismatch");
}
function markMatched(i, { bonus = false } = {}){
  const el = cardEls[i];
  if (!el) return;
  el.classList.add("flipped", "matched");
  el.classList.add(bonus ? "bonus-matched" : "match-pulse");
  el.disabled = true;
}

/* Small floating "+120" label near a card, mirroring the coin popup
   pattern used elsewhere in the app, scoped to this page. */
let scorePopupStylesInjected = false;
function ensureScorePopupStyles(){
  if (scorePopupStylesInjected) return;
  scorePopupStylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    .score-float-popup{
      position: fixed;
      pointer-events: none;
      font-family: 'Poppins', sans-serif;
      font-weight: 800;
      font-size: 15px;
      color: #ffc94d;
      text-shadow: 0 0 10px rgba(255,201,77,0.6);
      z-index: 9999;
      white-space: nowrap;
      animation: memoryScoreFloatUp 1s ease-out forwards;
    }
    @keyframes memoryScoreFloatUp{
      0%{ opacity: 0; transform: translate(-50%, 0) scale(0.85); }
      15%{ opacity: 1; transform: translate(-50%, -6px) scale(1.05); }
      80%{ opacity: 1; transform: translate(-50%, -36px) scale(1); }
      100%{ opacity: 0; transform: translate(-50%, -50px) scale(0.95); }
    }
  `;
  document.head.appendChild(style);
}
function spawnScorePopup(i, text){
  const el = cardEls[i];
  if (!el) return;
  ensureScorePopupStyles();
  const rect = el.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "score-float-popup";
  popup.textContent = text;
  popup.style.left = `${rect.left + rect.width / 2}px`;
  popup.style.top = `${rect.top}px`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1050);
}

function showShuffleToast(){
  shuffleToastEl.classList.remove("show");
  // Force reflow so re-triggering the animation works even if it's
  // still fading out from the previous shuffle tick.
  void shuffleToastEl.offsetWidth;
  shuffleToastEl.classList.add("show");
  clearTimeout(showShuffleToast._t);
  showShuffleToast._t = setTimeout(() => shuffleToastEl.classList.remove("show"), 1400);
}

/* =====================================================================
   Status rendering
===================================================================== */
function updateGameTitle(){
  const label = mode === "shuffle" ? "Shuffle Mode" : "Classic Mode";
  const icon = mode === "shuffle" ? "🔀" : "🧠";
  gameTitleEl.textContent = `${icon} ${label} — ${gridSize}×${gridSize}`;
}

function renderScore(){
  scoreValueEl.textContent = Math.max(0, Math.round(score));
}

function renderCombo(){
  const show = comboMultiplier > 1;
  comboBoxEl.hidden = !show;
  comboValueEl.textContent = `x${comboMultiplier.toFixed(2)}`;
}

function renderTimer(){
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  timerValueEl.textContent = `${m}:${s}`;
}

/* =====================================================================
   Timer + Shuffle interval
===================================================================== */
function startTimer(){
  const start = performance.now() - elapsedMs;
  timerInterval = setInterval(() => {
    elapsedMs = performance.now() - start;
    renderTimer();
  }, 250);
}

function startShuffleTimer(){
  if (mode !== "shuffle") return;
  shuffleInterval = setInterval(() => {
    // "Do not shuffle while two cards are being compared or after the
    // game ends."
    if (!gameActive || isComparing || boardLocked) return;
    performShuffle();
  }, SHUFFLE_INTERVAL_MS);
}

function stopTimers(){
  clearInterval(timerInterval);
  clearInterval(shuffleInterval);
  timerInterval = null;
  shuffleInterval = null;
}

function performShuffle(){
  const unmatchedIdx = cellStates
    .map((c, i) => (c.matched || c.type !== "pair" ? null : i))
    .filter((i) => i !== null);

  if (unmatchedIdx.length < 2) return;

  const symbols = shuffleArray(unmatchedIdx.map((i) => cellStates[i].symbol));
  unmatchedIdx.forEach((slotIndex, k) => {
    cellStates[slotIndex].symbol = symbols[k];
    // Cards are face-down right now (not matched, not mid-compare), so
    // the DOM's <back> face can be updated invisibly — nothing flips.
    const backFace = cardEls[slotIndex]?.querySelector(".memory-card-back");
    if (backFace) backFace.textContent = symbols[k];
  });

  unmatchedIdx.forEach((i) => {
    const el = cardEls[i];
    if (!el) return;
    el.classList.add("shuffle-pulse");
    setTimeout(() => el.classList.remove("shuffle-pulse"), 500);
  });

  showShuffleToast();
  playShuffleSound();
}

/* =====================================================================
   "Reveal for 3 Seconds" — coin-spent, one-off peek at the whole board.
   Briefly flips every still-hidden card face up, then flips them back
   down and lets the game continue exactly as before. Available in both
   Classic and Shuffle mode.
===================================================================== */
async function handleRevealClick(){
  if (!gameActive || boardLocked || isComparing || revealActive) return;

  const user = getCurrentUser();
  if (!user) return;

  playClickSound();
  try{
    await spendCoins(user.uid, REVEAL_COST, {
      reason: "Memory Match — Reveal for 3 Seconds",
      category: "power-up"
    });
  }catch(err){
    if (err.code === "coins/insufficient-funds"){
      showBanner(`Not enough coins — you need ${err.needed} more.`);
    } else {
      console.error("Failed to spend coins on Reveal:", err);
      showBanner("Couldn't use Reveal right now. Please try again.");
    }
    return;
  }

  revealBoardBriefly();
}

function revealBoardBriefly(){
  revealActive = true;
  boardLocked = true;

  const wasShuffling = shuffleInterval !== null;
  if (shuffleInterval){
    clearInterval(shuffleInterval);
    shuffleInterval = null;
  }

  // Only peek at cards that aren't already face-up (matched, claimed,
  // or mid-comparison) — those are already showing their symbol.
  const cardsToPeek = cellStates
    .map((cell, i) => {
      const alreadyVisible = cell.matched || cell.type === "bonus-claimed" || flippedIndices.includes(i);
      return alreadyVisible ? null : i;
    })
    .filter((i) => i !== null);

  cardsToPeek.forEach((i) => cardEls[i]?.classList.add("flipped", "reveal-peek"));

  const revealedCardEls = cardsToPeek.map((i) => cardEls[i]);
  revealTimeoutId = setTimeout(() => {
    revealedCardEls.forEach((el) => el?.classList.remove("flipped", "reveal-peek"));
    revealTimeoutId = null;
    revealActive = false;
    boardLocked = false;
    if (wasShuffling && gameActive) startShuffleTimer();
  }, REVEAL_DURATION_MS);
}

/* =====================================================================
   Game flow
===================================================================== */
function handleCardClick(i){
  if (!gameActive || boardLocked || isComparing) return;
  const cell = cellStates[i];
  if (!cell || cell.matched || cell.type === "bonus-claimed") return;
  if (flippedIndices.includes(i)) return;

  if (cell.type === "bonus"){
    claimBonus(i);
    return;
  }

  flipFaceUp(i);
  playFlipSound();
  flippedIndices.push(i);

  if (flippedIndices.length === 2){
    isComparing = true;
    const [a, b] = flippedIndices;
    if (cellStates[a].symbol === cellStates[b].symbol){
      setTimeout(() => resolveMatch(a, b), 360);
    } else {
      cardEls[a].classList.add("mismatch");
      cardEls[b].classList.add("mismatch");
      setTimeout(() => resolveMismatch(a, b), 800);
    }
  }
}

function resolveMatch(a, b){
  cellStates[a].matched = true;
  cellStates[b].matched = true;
  matchesFound++;
  markMatched(a);
  markMatched(b);
  playMatchSound();

  comboMultiplier = Math.min(COMBO_CAP, comboMultiplier + COMBO_STEP);
  const base = BASE_MATCH_POINTS[gridSize] || BASE_MATCH_POINTS[4];
  const modeBonus = mode === "shuffle" ? SHUFFLE_MODE_MULTIPLIER : 1;
  const gained = Math.round(base * comboMultiplier * modeBonus);
  score += gained;
  renderScore();
  renderCombo();
  spawnScorePopup(b, `+${gained}`);

  flippedIndices = [];
  isComparing = false;

  if (matchesFound === totalPairs){
    finishGame();
  }
}

function resolveMismatch(a, b){
  wrongAttempts++;
  comboMultiplier = 1;
  score = Math.max(0, score - MISMATCH_PENALTY);
  renderScore();
  renderCombo();
  playMismatchSound();
  flipFaceDown(a);
  flipFaceDown(b);
  flippedIndices = [];
  isComparing = false;
}

async function claimBonus(i){
  cellStates[i].type = "bonus-claimed";
  markMatched(i, { bonus: true });
  score += BONUS_SCORE;
  renderScore();
  playBonusSound();
  spawnScorePopup(i, `+${BONUS_SCORE}`);

  const user = getCurrentUser();
  if (!user) return;
  try{
    await addCoins(user.uid, BONUS_COINS, {
      reason: "Memory Match bonus star",
      category: "game-reward"
    });
  }catch(err){
    console.error("Failed to grant bonus coins:", err);
  }
}

/* ---------------------------------------------------------------
   Completion
--------------------------------------------------------------- */
async function finishGame(){
  gameActive = false;
  boardLocked = true;
  stopTimers();

  const finalElapsedMs = elapsedMs;
  const timeBonus = Math.max(0, TIME_BONUS_WINDOW_SEC - Math.floor(finalElapsedMs / 1000)) * TIME_BONUS_RATE;
  score += timeBonus;
  renderScore();
  playCompleteSound();

  const finalScore = Math.max(0, Math.round(score));
  const coinsEarned = Math.max(5, Math.round(finalScore / 15));

  showCompletionOverlay({ elapsedMs: finalElapsedMs, score: finalScore, coinsEarned });

  const user = getCurrentUser();
  if (!user) return;

  try{
    await addCoins(user.uid, coinsEarned, {
      reason: `Memory Match complete (${mode}, ${gridSize}x${gridSize})`,
      category: "game-reward"
    });
    await recordGameResult(user.uid, { gameKey: "memory", won: true });

    if (wrongAttempts === 0){
      await recordAchievementProgress(user.uid, "memory_perfect");
    }
    if (mode === "shuffle"){
      await recordAchievementProgress(user.uid, "shuffle_wins");
    }

    await maybeUpdateBestTime(user.uid, finalElapsedMs);
  }catch(err){
    console.error("Failed to record Memory Match result:", err);
  }
}

async function maybeUpdateBestTime(uid, ms){
  const profile = getProfile();
  const currentBest = profile?.statistics?.memoryGame?.bestTimeMs;
  if (currentBest != null && currentBest <= ms) return;
  try{
    await updateProfileData(uid, { "statistics.memoryGame.bestTimeMs": Math.round(ms) });
  }catch(err){
    console.error("Failed to update Memory Match best time:", err);
  }
}

function showCompletionOverlay({ elapsedMs, score, coinsEarned }){
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  completionTimeEl.textContent = `${m}:${s}`;
  completionScoreEl.textContent = formatCoinAmount(score);
  completionCoinsEl.textContent = `+${formatCoinAmount(coinsEarned)} 🪙`;
  completionOverlayEl.hidden = false;
  requestAnimationFrame(() => completionOverlayEl.classList.add("show"));
}
function hideCompletionOverlay(){
  completionOverlayEl.classList.remove("show");
  completionOverlayEl.hidden = true;
}

/* =====================================================================
   Setup / new game
===================================================================== */
function startNewGame(chosenMode, chosenGridSize){
  mode = chosenMode;
  gridSize = chosenGridSize;

  if (revealTimeoutId){
    clearTimeout(revealTimeoutId);
    revealTimeoutId = null;
  }
  revealActive = false;

  const built = generateDeck(gridSize);
  cellStates = built.cells;
  totalPairs = built.pairCount;
  matchesFound = 0;
  wrongAttempts = 0;
  flippedIndices = [];
  isComparing = false;
  boardLocked = false;
  gameActive = true;
  score = 0;
  comboMultiplier = 1;
  elapsedMs = 0;

  hideCompletionOverlay();
  renderBoardDOM();
  updateGameTitle();
  renderScore();
  renderCombo();
  renderTimer();

  stopTimers();
  startTimer();
  startShuffleTimer();
}

function wireControls(){
  gridSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn || Number(btn.dataset.grid) === pendingGridSize) return;
    pendingGridSize = Number(btn.dataset.grid);
    gridSegmented.querySelectorAll(".segment").forEach((s) => {
      s.classList.toggle("active", s === btn);
      s.setAttribute("aria-selected", String(s === btn));
    });
    playClickSound();
  });

  chooseClassicBtn.addEventListener("click", () => { playClickSound(); showGameScreenFor("classic"); });
  chooseShuffleBtn.addEventListener("click", () => { playClickSound(); showGameScreenFor("shuffle"); });

  restartBtn.addEventListener("click", () => {
    playClickSound();
    startNewGame(mode, gridSize);
  });

  revealBtn.addEventListener("click", handleRevealClick);

  playAgainBtn.addEventListener("click", () => {
    playClickSound();
    startNewGame(mode, gridSize);
  });
  changeSetupFromCompletionBtn.addEventListener("click", () => { playClickSound(); showSetupScreen(); });
}

/* =====================================================================
   Init — resolves DOM refs and wires everything up once.
===================================================================== */
export function init(){
  setupScreenEl = document.getElementById("setupScreen");
  gameScreenEl = document.getElementById("gameScreen");

  gridSegmented = document.getElementById("gridSegmented");
  chooseClassicBtn = document.getElementById("chooseClassicBtn");
  chooseShuffleBtn = document.getElementById("chooseShuffleBtn");

  gameTitleEl = document.getElementById("gameTitle");
  timerValueEl = document.getElementById("timerValue");
  scoreValueEl = document.getElementById("scoreValue");
  comboBoxEl = document.getElementById("comboBox");
  comboValueEl = document.getElementById("comboValue");

  boardEl = document.getElementById("memoryBoard");
  restartBtn = document.getElementById("memoryRestartBtn");
  revealBtn = document.getElementById("memoryRevealBtn");
  shuffleToastEl = document.getElementById("shuffleToast");

  completionOverlayEl = document.getElementById("completionOverlay");
  completionTimeEl = document.getElementById("completionTime");
  completionScoreEl = document.getElementById("completionScore");
  completionCoinsEl = document.getElementById("completionCoins");
  playAgainBtn = document.getElementById("playAgainBtn");
  changeSetupFromCompletionBtn = document.getElementById("changeSetupFromCompletionBtn");

  wireControls();
}
