/* =====================================================================
   Rock Paper Scissors — Game Controller
   Owns the Mode Select screen and the Game screen (arena, moves,
   throw animation, scoring, streaks). Talks to Firestore only through
   the shared coin/achievement services — no duplicate coin or
   achievement logic here. Mirrors the structure of
   number-guessing-game.js so the two games stay easy to compare.
===================================================================== */

import { addCoins, formatCoinAmount } from "./coin-service.js";
import { recordGameResult, recordAchievementProgress } from "./achievement-service.js";
import { playClickSound, playMoveSound, playWinSound, playLoseSound, playDrawSound } from "./game-audio.js";
import { getCurrentUser } from "./game-shared.js";
import { MOVES, getMovesForMode, pickComputerMove, determineWinner, explainRound } from "./rps-rules.js";
import { buildMoveVisual } from "./rps-hand-icons.js";

/* =====================================================================
   Tunables
===================================================================== */
const COUNTDOWN_STEPS = ["Rock...", "Paper...", "Scissors...", "Shoot!"];
const STEP_MS = 750;                              // 4 steps * 750ms = 3000ms (3s) throw animation — the hand pumps once per step, just like the real "Rock, Paper, Scissors, Shoot!" hand game
const BASE_WIN_COINS = 8;
const EXTENDED_COIN_MULT = 1.25;
const STREAK_BONUS = { 3: 10, 5: 20 };
const BIG_STREAK_BONUS = 40;                       // every 10th win in a row (10, 20, 30...)

const MODE_META = {
  classic:  { title: "✊ Classic Mode", icon: "✊" },
  extended: { title: "🖖 Extended Mode", icon: "🖖" }
};

/* =====================================================================
   STATE
===================================================================== */
let mode = "classic";
let playerWins = 0;
let computerWins = 0;
let draws = 0;
let round = 0;
let currentStreak = 0;
let awaitingThrow = false;
let countdownTimer = null;
let countdownInterval = null;

/* =====================================================================
   DOM refs (resolved once in init())
===================================================================== */
let modeScreenEl, gameScreenEl;
let classicModeCard, extendedModeCard;
let gameTitleEl;
let playerWinsValueEl, computerWinsValueEl, drawsValueEl, streakValueEl, roundValueEl;
let playerStageEl, playerHandWrapEl, playerMoveNameEl;
let computerStageEl, computerHandWrapEl, computerMoveNameEl;
let statusTextEl, relationshipTextEl;
let movesGridEl;
let resetBtn;

/* Small hook so the page bootstrap (which owns the topbar back-button
   label + title) can stay in sync with screen changes made from here. */
const screenChangeListeners = [];
export function onScreenChange(fn){ screenChangeListeners.push(fn); }
function notifyScreenChange(name){ screenChangeListeners.forEach((fn) => fn(name)); }

export function showModeScreen(){
  modeScreenEl.classList.add("active");
  gameScreenEl.classList.remove("active");
  notifyScreenChange("mode");
}

export function showGameScreenFor(chosenMode){
  modeScreenEl.classList.remove("active");
  gameScreenEl.classList.add("active");
  startNewGame(chosenMode);
  notifyScreenChange("game");
}

/* =====================================================================
   Rendering
===================================================================== */
function renderGameTitle(){
  gameTitleEl.textContent = MODE_META[mode].title;
}
function renderStats(){
  playerWinsValueEl.textContent = String(playerWins);
  computerWinsValueEl.textContent = String(computerWins);
  drawsValueEl.textContent = String(draws);
  streakValueEl.textContent = String(currentStreak);
  roundValueEl.textContent = String(round);
}

function renderIdleHands(){
  playerHandWrapEl.innerHTML = buildMoveVisual("rock");
  computerHandWrapEl.innerHTML = buildMoveVisual("rock");
  playerMoveNameEl.textContent = MOVES.rock.label;
  computerMoveNameEl.textContent = MOVES.rock.label;
  playerStageEl.classList.remove("win", "lose", "draw", "throwing");
  computerStageEl.classList.remove("win", "lose", "draw", "throwing");
}

function renderMoveButtonsEnabled(enabled){
  movesGridEl.querySelectorAll(".move-btn").forEach((btn) => {
    btn.disabled = !enabled;
  });
}

function renderMovesGrid(){
  const moveList = getMovesForMode(mode);
  movesGridEl.className = mode === "extended" ? "moves-grid extended" : "moves-grid";
  movesGridEl.innerHTML = moveList.map((move) => `
    <button class="move-btn" type="button" data-move="${move.id}" aria-label="Play ${move.label}">
      <span class="move-btn-icon">${buildMoveVisual(move.id)}</span>
      <span class="move-btn-label">${move.label}</span>
    </button>
  `).join("");
}

function setStatus(message, type){
  statusTextEl.textContent = message;
  statusTextEl.className = `status-text ${type || ""}`.trim();
}

/* =====================================================================
   Round flow
===================================================================== */
function startNewGame(chosenMode){
  mode = chosenMode === "extended" ? "extended" : "classic";
  playerWins = 0;
  computerWins = 0;
  draws = 0;
  round = 0;
  currentStreak = 0;
  awaitingThrow = false;
  clearTimeout(countdownTimer);
  clearInterval(countdownInterval);

  renderGameTitle();
  renderMovesGrid();
  renderStats();
  renderIdleHands();
  setStatus("Pick a move to begin", "");
  relationshipTextEl.textContent = "";
  renderMoveButtonsEnabled(true);
}

function handleMoveClick(playerMove){
  if (awaitingThrow) return; // no spamming/double rounds while a throw is in flight
  awaitingThrow = true;
  playClickSound();

  const computerMove = pickComputerMove(mode); // chosen internally now, revealed only after the animation
  renderMoveButtonsEnabled(false);

  movesGridEl.querySelectorAll(".move-btn").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.move === playerMove);
  });

  renderIdleHands(); // both hands reset to the default Rock pose before the throw
  playerStageEl.classList.add("throwing");
  computerStageEl.classList.add("throwing");

  let stepIndex = 0;
  setStatus(COUNTDOWN_STEPS[0], "countdown");
  playMoveSound();

  countdownInterval = setInterval(() => {
    stepIndex += 1;
    if (stepIndex < COUNTDOWN_STEPS.length){
      setStatus(COUNTDOWN_STEPS[stepIndex], "countdown");
      playMoveSound();
    }
  }, STEP_MS);

  countdownTimer = setTimeout(() => {
    clearInterval(countdownInterval);
    revealMoves(playerMove, computerMove);
  }, COUNTDOWN_STEPS.length * STEP_MS);
}

function revealMoves(playerMove, computerMove){
  playerStageEl.classList.remove("throwing");
  computerStageEl.classList.remove("throwing");

  playerHandWrapEl.innerHTML = buildMoveVisual(playerMove);
  computerHandWrapEl.innerHTML = buildMoveVisual(computerMove);
  playerMoveNameEl.textContent = MOVES[playerMove].label;
  computerMoveNameEl.textContent = MOVES[computerMove].label;

  const result = determineWinner(playerMove, computerMove); // "win" | "lose" | "draw" — from the player's side

  playerStageEl.classList.add(result === "win" ? "win" : result === "lose" ? "lose" : "draw");
  computerStageEl.classList.add(result === "win" ? "lose" : result === "lose" ? "win" : "draw");

  if (result === "win"){
    setStatus("YOU WIN", "win");
    playWinSound();
  } else if (result === "lose"){
    setStatus("COMPUTER WINS", "lose");
    playLoseSound();
  } else {
    setStatus("DRAW", "draw");
    playDrawSound();
  }
  relationshipTextEl.textContent = explainRound(playerMove, computerMove, result);

  applyRoundResult(result);

  // The round is fully resolved on-screen; unlock the buttons for the
  // next throw immediately. Coin/achievement syncing continues in the
  // background and never blocks gameplay.
  awaitingThrow = false;
  renderMoveButtonsEnabled(true);
  movesGridEl.querySelectorAll(".move-btn").forEach((btn) => btn.classList.remove("selected"));

  syncRoundResult(result).catch((err) => {
    console.error("Failed to sync Rock Paper Scissors result:", err);
  });
}

function applyRoundResult(result){
  round += 1;
  if (result === "win"){
    playerWins += 1;
    currentStreak += 1;
  } else if (result === "lose"){
    computerWins += 1;
    currentStreak = 0;
  } else {
    draws += 1;
  }
  renderStats();
}

/* ---------------------------------------------------------------
   Coins + achievements — fire-and-forget so a slow/unavailable
   backend never blocks the next round. Every completed round counts
   as one "game" for lifetime statistics and missions, matching the
   pattern every other game page uses.
--------------------------------------------------------------- */
async function syncRoundResult(result){
  const user = getCurrentUser();
  if (!user) return;

  const won = result === "win";

  if (won){
    const base = Math.round(BASE_WIN_COINS * (mode === "extended" ? EXTENDED_COIN_MULT : 1));
    await addCoins(user.uid, base, {
      reason: `Rock Paper Scissors win (${mode})`,
      category: "game-reward"
    });

    if (STREAK_BONUS[currentStreak]){
      await addCoins(user.uid, STREAK_BONUS[currentStreak], {
        reason: `${currentStreak}-win streak bonus`,
        category: "game-reward"
      });
    } else if (currentStreak > 0 && currentStreak % 10 === 0){
      await addCoins(user.uid, BIG_STREAK_BONUS, {
        reason: `${currentStreak}-win streak bonus`,
        category: "game-reward"
      });
    }
  }

  await recordGameResult(user.uid, { gameKey: "rps", won });

  if (won){
    if (currentStreak === 3) await recordAchievementProgress(user.uid, "rps_streak_3");
    if (currentStreak === 5) await recordAchievementProgress(user.uid, "rps_streak_5");
    if (mode === "extended") await recordAchievementProgress(user.uid, "rps_extended_win");
  }
}

/* =====================================================================
   Wiring
===================================================================== */
function wireControls(){
  classicModeCard.addEventListener("click", () => {
    playClickSound();
    showGameScreenFor("classic");
  });
  extendedModeCard.addEventListener("click", () => {
    playClickSound();
    showGameScreenFor("extended");
  });

  movesGridEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".move-btn");
    if (!btn || btn.disabled) return;
    handleMoveClick(btn.dataset.move);
  });

  resetBtn.addEventListener("click", () => {
    playClickSound();
    startNewGame(mode);
  });
}

/* =====================================================================
   Init — resolves DOM refs and wires everything up once.
===================================================================== */
export function init(){
  modeScreenEl = document.getElementById("modeScreen");
  gameScreenEl = document.getElementById("gameScreen");

  classicModeCard = document.getElementById("classicModeCard");
  extendedModeCard = document.getElementById("extendedModeCard");

  gameTitleEl = document.getElementById("gameTitle");
  playerWinsValueEl = document.getElementById("playerWinsValue");
  computerWinsValueEl = document.getElementById("computerWinsValue");
  drawsValueEl = document.getElementById("drawsValue");
  streakValueEl = document.getElementById("streakValue");
  roundValueEl = document.getElementById("roundValue");

  playerStageEl = document.getElementById("playerStage");
  playerHandWrapEl = document.getElementById("playerHandWrap");
  playerMoveNameEl = document.getElementById("playerMoveName");
  computerStageEl = document.getElementById("computerStage");
  computerHandWrapEl = document.getElementById("computerHandWrap");
  computerMoveNameEl = document.getElementById("computerMoveName");

  statusTextEl = document.getElementById("statusText");
  relationshipTextEl = document.getElementById("relationshipText");

  movesGridEl = document.getElementById("movesGrid");
  resetBtn = document.getElementById("resetBtn");

  renderIdleHands();
  wireControls();
}
