/* =====================================================================
   Number Guessing — Game Controller
   Owns the Setup screen (range + difficulty) and the Game screen
   (guessing, attempts, hints, history, completion). Talks to
   Firestore only through the shared coin/achievement/mission
   services and the reusable Hint Manager — no duplicate coin,
   achievement, or hint logic here.
===================================================================== */

import { addCoins, spendCoins, formatCoinAmount } from "./coin-service.js";
import { recordGameResult, recordAchievementProgress } from "./achievement-service.js";
import { recordMissionProgress } from "./missions-service.js";
import { createHintManager } from "./hint-manager.js";
import { playHintSound, playWinSound, playLoseSound, playClickSound } from "./game-audio.js";
import { getCurrentUser, showBanner } from "./game-shared.js";

/* =====================================================================
   Tunables
===================================================================== */
const RANGES = {
  50:   { min: 1, max: 50,   label: "1–50" },
  100:  { min: 1, max: 100,  label: "1–100" },
  500:  { min: 1, max: 500,  label: "1–500" },
  1000: { min: 1, max: 1000, label: "1–1000" }
};

const DIFFICULTIES = {
  easy:   { label: "Easy",   attemptBonus: 5, scoreMult: 1.0, costMult: 1.0 },
  medium: { label: "Medium", attemptBonus: 3, scoreMult: 1.5, costMult: 1.3 },
  hard:   { label: "Hard",   attemptBonus: 1, scoreMult: 2.2, costMult: 1.6 }
};

const RANGE_SCORE_MULT = { 50: 1, 100: 1.3, 500: 1.8, 1000: 2.2 };
const RANGE_COST_MULT  = { 50: 1, 100: 1.15, 500: 1.4, 1000: 1.7 };

const BASE_SCORE = 100;
const BASE_HINT_COST = 12;
const MIN_SCORE = 10;
const MIN_COINS_REWARD = 5;

function computeMaxAttempts(rangeKey, difficultyKey){
  const { min, max } = RANGES[rangeKey];
  const size = max - min + 1;
  const bonus = DIFFICULTIES[difficultyKey].attemptBonus;
  return Math.ceil(Math.log2(size)) + bonus;
}
function computeBaseScore(rangeKey, difficultyKey){
  return Math.round(BASE_SCORE * DIFFICULTIES[difficultyKey].scoreMult * RANGE_SCORE_MULT[rangeKey]);
}
function computeHintBaseCost(rangeKey, difficultyKey){
  return Math.round(BASE_HINT_COST * DIFFICULTIES[difficultyKey].costMult * RANGE_COST_MULT[rangeKey]);
}

/* =====================================================================
   STATE
===================================================================== */
let pendingRangeKey = "50";
let pendingDifficultyKey = "easy";

let rangeKey = "50";
let difficultyKey = "easy";
let rangeMin = 1;
let rangeMax = 50;

let secretNumber = null;
let maxAttempts = 0;
let attemptsUsed = 0;
let hintsUsed = 0;
let guessedNumbers = new Set();
let gameActive = false;
let awaitingHint = false;
let awaitingResult = false;

let hintManager = null;

/* =====================================================================
   DOM refs (resolved once in init())
===================================================================== */
let setupScreenEl, gameScreenEl;
let rangeSegmented, difficultySegmented, setupSummaryEl, startGameBtn;
let gameTitleEl, attemptsValueEl, scoreValueEl, hintsUsedValueEl;
let hintBtn, hintCostLabelEl, hintLogEl;
let guessForm, guessInputEl, guessSubmitBtn, guessFeedbackEl, guessHistoryEl;
let restartBtn;
let completionOverlayEl, completionIconEl, completionTitleEl, completionSubtitleEl;
let completionAttemptsEl, completionScoreEl, completionCoinsEl;
let playAgainBtn, changeSetupFromCompletionBtn;

/* Small hook so the page bootstrap (which owns the topbar back-button
   label + title) can stay in sync with screen changes made from here. */
const screenChangeListeners = [];
export function onScreenChange(fn){ screenChangeListeners.push(fn); }
function notifyScreenChange(name){ screenChangeListeners.forEach((fn) => fn(name)); }

export function showSetupScreen(){
  gameActive = false;
  setupScreenEl.classList.add("active");
  gameScreenEl.classList.remove("active");
  hideCompletionOverlay();
  notifyScreenChange("setup");
}
export function showGameScreenFor(chosenRangeKey, chosenDifficultyKey){
  setupScreenEl.classList.remove("active");
  gameScreenEl.classList.add("active");
  startNewGame(chosenRangeKey, chosenDifficultyKey);
  notifyScreenChange("game");
}

/* =====================================================================
   Rendering
===================================================================== */
function computeLiveScore(){
  const base = computeBaseScore(rangeKey, difficultyKey);
  const attemptPenaltyPer = Math.round(base * 0.06);
  const hintPenaltyPer = Math.round(base * 0.10);
  const penalty = attemptsUsed * attemptPenaltyPer + hintsUsed * hintPenaltyPer;
  return Math.max(MIN_SCORE, base - penalty);
}

function renderGameTitle(){
  const diff = DIFFICULTIES[difficultyKey];
  const range = RANGES[rangeKey];
  gameTitleEl.textContent = `🔢 ${diff.label} — ${range.label}`;
}
function renderAttempts(){
  attemptsValueEl.textContent = `${attemptsUsed} / ${maxAttempts}`;
}
function renderScore(){
  scoreValueEl.textContent = String(computeLiveScore());
}
function renderHintsUsed(){
  hintsUsedValueEl.textContent = String(hintsUsed);
}
function renderHintButton(){
  const hintsLeft = hintManager && hintManager.hasMoreHints();
  hintBtn.disabled = !gameActive || awaitingHint || !hintsLeft;
  if (!hintsLeft){
    hintCostLabelEl.textContent = "— none left";
  } else {
    const cost = hintManager.getNextCost(computeHintBaseCost(rangeKey, difficultyKey));
    hintCostLabelEl.textContent = `— ${formatCoinAmount(cost)} 🪙`;
  }
}
function renderGuessControls(){
  guessInputEl.disabled = !gameActive;
  guessSubmitBtn.disabled = !gameActive;
}

function appendHintLog(hint){
  const item = document.createElement("div");
  item.className = "hint-log-item";
  item.innerHTML = `<span class="hint-log-label">${hint.label}</span><span>${hint.text}</span>`;
  hintLogEl.appendChild(item);
}

function appendGuessChip(value, direction){
  const chip = document.createElement("span");
  chip.className = `guess-chip ${direction}`;
  const arrow = direction === "higher" ? "↑" : direction === "lower" ? "↓" : "✓";
  chip.textContent = `${value} ${arrow}`;
  guessHistoryEl.appendChild(chip);
}

function setFeedback(message, type){
  guessFeedbackEl.textContent = message;
  guessFeedbackEl.className = `guess-feedback ${type || ""}`.trim();
}

function renderAll(){
  renderGameTitle();
  renderAttempts();
  renderScore();
  renderHintsUsed();
  renderHintButton();
  renderGuessControls();
}

/* =====================================================================
   Setup screen — range/difficulty selection preview
===================================================================== */
function renderSetupSummary(){
  const attempts = computeMaxAttempts(pendingRangeKey, pendingDifficultyKey);
  const cost = computeHintBaseCost(pendingRangeKey, pendingDifficultyKey);
  setupSummaryEl.textContent = `Up to ${attempts} attempts · Hints start at ${formatCoinAmount(cost)} 🪙`;
}

function wireSetupControls(){
  rangeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn || btn.dataset.range === pendingRangeKey) return;
    pendingRangeKey = btn.dataset.range;
    rangeSegmented.querySelectorAll(".segment").forEach((s) => {
      s.classList.toggle("active", s === btn);
      s.setAttribute("aria-selected", String(s === btn));
    });
    renderSetupSummary();
    playClickSound();
  });

  difficultySegmented.addEventListener("click", (e) => {
    const btn = e.target.closest(".segment");
    if (!btn || btn.dataset.difficulty === pendingDifficultyKey) return;
    pendingDifficultyKey = btn.dataset.difficulty;
    difficultySegmented.querySelectorAll(".segment").forEach((s) => {
      s.classList.toggle("active", s === btn);
      s.setAttribute("aria-selected", String(s === btn));
    });
    renderSetupSummary();
    playClickSound();
  });

  startGameBtn.addEventListener("click", () => {
    playClickSound();
    showGameScreenFor(pendingRangeKey, pendingDifficultyKey);
  });
}

/* =====================================================================
   Game flow
===================================================================== */
function startNewGame(chosenRangeKey, chosenDifficultyKey){
  rangeKey = chosenRangeKey;
  difficultyKey = chosenDifficultyKey;
  rangeMin = RANGES[rangeKey].min;
  rangeMax = RANGES[rangeKey].max;

  secretNumber = Math.floor(Math.random() * (rangeMax - rangeMin + 1)) + rangeMin;
  maxAttempts = computeMaxAttempts(rangeKey, difficultyKey);
  attemptsUsed = 0;
  hintsUsed = 0;
  guessedNumbers = new Set();
  gameActive = true;
  awaitingHint = false;
  awaitingResult = false;

  hintManager = createHintManager(secretNumber, rangeMin, rangeMax);

  hintLogEl.innerHTML = "";
  guessHistoryEl.innerHTML = "";
  guessInputEl.value = "";
  guessInputEl.min = String(rangeMin);
  guessInputEl.max = String(rangeMax);
  setFeedback(`Guess a number between ${rangeMin} and ${rangeMax}.`, "");

  hideCompletionOverlay();
  renderAll();
}

/* Parses and validates raw guess input. Returns { value } on success
   or { error } on failure — never mutates game state either way, so
   an invalid guess never consumes an attempt. */
function parseGuess(raw){
  const trimmed = String(raw ?? "").trim();
  if (trimmed === ""){
    return { error: "Enter a number first." };
  }
  if (!/^-?\d+$/.test(trimmed)){
    return { error: "Guesses must be a whole number." };
  }
  const value = Number(trimmed);
  if (value < rangeMin || value > rangeMax){
    return { error: `Guess must be between ${rangeMin} and ${rangeMax}.` };
  }
  if (guessedNumbers.has(value)){
    return { error: `You already guessed ${value} — try another number.` };
  }
  return { value };
}

function handleGuessSubmit(e){
  e.preventDefault();
  if (!gameActive || awaitingResult) return;

  const result = parseGuess(guessInputEl.value);
  if (result.error){
    setFeedback(result.error, "invalid");
    return;
  }

  const guess = result.value;
  guessedNumbers.add(guess);
  attemptsUsed += 1;
  guessInputEl.value = "";

  if (guess === secretNumber){
    appendGuessChip(guess, "correct");
    renderAttempts();
    renderScore();
    finishGame(true);
    return;
  }

  const direction = guess < secretNumber ? "higher" : "lower";
  appendGuessChip(guess, direction);
  setFeedback(
    direction === "higher" ? `${guess} is too low — go higher!` : `${guess} is too high — go lower!`,
    direction
  );
  renderAttempts();
  renderScore();

  if (attemptsUsed >= maxAttempts){
    finishGame(false);
  }
}

/* ---------------------------------------------------------------
   Hint — spends coins via the shared coin service first; the hint
   itself (and any UI change) only appears once that Firestore
   transaction has actually succeeded, so a failed/declined spend
   never reveals information for free.
--------------------------------------------------------------- */
async function handleHintClick(){
  if (!gameActive || awaitingHint || !hintManager || !hintManager.hasMoreHints()) return;

  const user = getCurrentUser();
  if (!user) return;

  const cost = hintManager.getNextCost(computeHintBaseCost(rangeKey, difficultyKey));

  awaitingHint = true;
  renderHintButton();

  try{
    await spendCoins(user.uid, cost, { reason: "Number Guessing hint", category: "hint" });
  }catch(err){
    awaitingHint = false;
    renderHintButton();
    if (err.code === "coins/insufficient-funds"){
      showBanner(`Not enough coins — you need ${err.needed} more.`);
    } else {
      console.error("Failed to spend coins on hint:", err);
      showBanner("Couldn't use the hint. Please try again.");
    }
    return;
  }

  // Firestore transaction confirmed — now it's safe to reveal the hint.
  const hint = hintManager.requestHint();
  hintsUsed = hintManager.getHintsUsedCount();
  appendHintLog(hint);
  renderHintsUsed();
  renderScore();
  playHintSound();

  awaitingHint = false;
  renderHintButton();

  recordMissionProgress(user.uid, "hints_used", 1).catch((err) => {
    console.error("Failed to record hint mission progress:", err);
  });
}

/* ---------------------------------------------------------------
   Completion — win or loss. Attempts/hints are already locked in by
   this point, so no further guesses or hints can affect the result.
--------------------------------------------------------------- */
async function finishGame(won){
  gameActive = false;
  awaitingResult = true;
  renderHintButton();
  renderGuessControls();

  const finalScore = computeLiveScore();
  const coinsEarned = won ? Math.max(MIN_COINS_REWARD, Math.round(finalScore / 8)) : 0;

  if (won){
    playWinSound();
    setFeedback(`🎉 Correct! The number was ${secretNumber}.`, "correct");
  } else {
    playLoseSound();
    setFeedback(`Out of attempts — the number was ${secretNumber}.`, "invalid");
  }

  const user = getCurrentUser();
  if (user){
    try{
      if (won){
        await addCoins(user.uid, coinsEarned, {
          reason: `Number Guessing win (${difficultyKey}, ${RANGES[rangeKey].label})`,
          category: "game-reward"
        });
      }
      await recordGameResult(user.uid, { gameKey: "guess", won });

      if (won){
        if (attemptsUsed === 1){
          await recordAchievementProgress(user.uid, "guess_first_try");
        }
        if (hintsUsed === 0){
          await recordAchievementProgress(user.uid, "guess_no_hint_wins");
        }
        if (difficultyKey === "hard"){
          await recordAchievementProgress(user.uid, "guess_hard_wins");
        }
        if (rangeKey === "1000"){
          await recordAchievementProgress(user.uid, "guess_range1000_wins");
        }
      }
    }catch(err){
      console.error("Failed to record Number Guessing result:", err);
      showBanner("Result saved locally, but syncing to your profile failed.");
    }
  }

  awaitingResult = false;
  showCompletionOverlay({ won, finalScore, coinsEarned });
}

function showCompletionOverlay({ won, finalScore, coinsEarned }){
  completionIconEl.textContent = won ? "🏆" : "💀";
  completionTitleEl.textContent = won ? "You Got It!" : "Out of Attempts";
  completionSubtitleEl.textContent = won
    ? `Solved in ${attemptsUsed} attempt${attemptsUsed === 1 ? "" : "s"}.`
    : `The number was ${secretNumber}.`;
  completionAttemptsEl.textContent = `${attemptsUsed} / ${maxAttempts}`;
  completionScoreEl.textContent = formatCoinAmount(finalScore);
  completionCoinsEl.textContent = `+${formatCoinAmount(coinsEarned)} 🪙`;
  completionOverlayEl.hidden = false;
  requestAnimationFrame(() => completionOverlayEl.classList.add("show"));
}
function hideCompletionOverlay(){
  completionOverlayEl.classList.remove("show");
  completionOverlayEl.hidden = true;
}

/* =====================================================================
   Wiring
===================================================================== */
function wireControls(){
  wireSetupControls();

  guessForm.addEventListener("submit", handleGuessSubmit);
  hintBtn.addEventListener("click", handleHintClick);

  restartBtn.addEventListener("click", () => {
    playClickSound();
    startNewGame(rangeKey, difficultyKey);
  });

  playAgainBtn.addEventListener("click", () => {
    playClickSound();
    startNewGame(rangeKey, difficultyKey);
  });
  changeSetupFromCompletionBtn.addEventListener("click", () => { playClickSound(); showSetupScreen(); });
}

/* =====================================================================
   Init — resolves DOM refs and wires everything up once.
===================================================================== */
export function init(){
  setupScreenEl = document.getElementById("setupScreen");
  gameScreenEl = document.getElementById("gameScreen");

  rangeSegmented = document.getElementById("rangeSegmented");
  difficultySegmented = document.getElementById("difficultySegmented");
  setupSummaryEl = document.getElementById("setupSummary");
  startGameBtn = document.getElementById("startGameBtn");

  gameTitleEl = document.getElementById("gameTitle");
  attemptsValueEl = document.getElementById("attemptsValue");
  scoreValueEl = document.getElementById("scoreValue");
  hintsUsedValueEl = document.getElementById("hintsUsedValue");

  hintBtn = document.getElementById("hintBtn");
  hintCostLabelEl = document.getElementById("hintCostLabel");
  hintLogEl = document.getElementById("hintLog");

  guessForm = document.getElementById("guessForm");
  guessInputEl = document.getElementById("guessInput");
  guessSubmitBtn = document.getElementById("guessSubmitBtn");
  guessFeedbackEl = document.getElementById("guessFeedback");
  guessHistoryEl = document.getElementById("guessHistory");

  restartBtn = document.getElementById("restartBtn");

  completionOverlayEl = document.getElementById("completionOverlay");
  completionIconEl = document.getElementById("completionIcon");
  completionTitleEl = document.getElementById("completionTitle");
  completionSubtitleEl = document.getElementById("completionSubtitle");
  completionAttemptsEl = document.getElementById("completionAttempts");
  completionScoreEl = document.getElementById("completionScore");
  completionCoinsEl = document.getElementById("completionCoins");
  playAgainBtn = document.getElementById("playAgainBtn");
  changeSetupFromCompletionBtn = document.getElementById("changeSetupFromCompletionBtn");

  renderSetupSummary();
  wireControls();
}
