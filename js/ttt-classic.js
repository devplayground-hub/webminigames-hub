/* =====================================================================
   Tic Tac Toe — Classic Mode Controller
   3x3 board, PvP + PvC (minimax AI), score tracking, sound, animations,
   and the coin-locked Vanishing Mode variant (each move expires after
   5 turns). Talks to Firestore only through the shared coin/achievement
   services — no duplicate coin or achievement logic here.
===================================================================== */

import { checkWinner, isFull, getComputerMove } from "./ttt-core.js";
import { spendCoins } from "./coin-service.js";
import { recordGameResult, recordAchievementProgress } from "./achievement-service.js";
import { updateProfileData, arrayUnion } from "./data-store.js";
import { playMoveSound, playWinSound, playLoseSound, playDrawSound, playClickSound } from "./game-audio.js";
import { getCurrentUser, onProfileUpdate, hasUnlockedFeature, showBanner } from "./game-shared.js";

const VANISHING_FEATURE_ID = "ttt_vanishing_mode";
const VANISHING_COST = 40;
const VANISH_LIMIT = 5; // max marks allowed on the board at once in Vanishing Mode

/* =====================================================================
   STATE
===================================================================== */
let board = Array(9).fill(null);
let moveQueue = [];      // ordered list of currently-alive cell indices (oldest first)
let currentPlayer = "X";
let mode = "pvp";        // "pvp" | "pvc"
let difficulty = "medium";
let gameOver = false;
let computerThinking = false;
let scores = { X: 0, O: 0, draws: 0 };
let vanishingMode = false;
let vanishingUnlocked = false;

/* =====================================================================
   DOM refs (resolved lazily in init(), scoped to #classicScreen)
===================================================================== */
let boardEl, winLineEl, statusLineEl;
let scoreXEl, scoreOEl, scoreDrawsEl, scoreBoxXEl, scoreBoxOEl, labelXEl, labelOEl;
let restartBtn, resetScoreBtn;
let vanishingToggle, vanishingLockBadge, vanishingCostLabel;
let cellEls = [];

function markSVG(symbol){
  if (symbol === "X"){
    return `
      <svg class="mark mark-x" viewBox="0 0 100 100">
        <line x1="20" y1="20" x2="80" y2="80" />
        <line x1="80" y1="20" x2="20" y2="80" />
      </svg>`;
  }
  return `
    <svg class="mark mark-o" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="35" />
    </svg>`;
}

function buildBoardCells(){
  for (let i = 0; i < 9; i++){
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.dataset.index = String(i);
    cell.setAttribute("aria-label", `Cell ${i + 1}`);
    cell.addEventListener("click", () => handleCellClick(i));
    boardEl.appendChild(cell);
    cellEls.push(cell);
  }
}

function renderMark(index, symbol){
  const cell = cellEls[index];
  cell.innerHTML = markSVG(symbol);
  cell.classList.add("filled", "disabled");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cell.querySelector(".mark")?.classList.add("drawn");
    });
  });
}

function clearBoardDOM(){
  cellEls.forEach((cell) => {
    cell.innerHTML = "";
    cell.className = "cell";
  });
  winLineEl.hidden = true;
  winLineEl.style.width = "0px";
}

function highlightWinLine(line){
  line.forEach((i) => cellEls[i].classList.add("win-cell"));

  const [a, , c] = line;
  const cellA = cellEls[a].getBoundingClientRect();
  const cellC = cellEls[c].getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();

  const startX = cellA.left + cellA.width / 2 - boardRect.left;
  const startY = cellA.top + cellA.height / 2 - boardRect.top;
  const endX = cellC.left + cellC.width / 2 - boardRect.left;
  const endY = cellC.top + cellC.height / 2 - boardRect.top;

  const length = Math.hypot(endX - startX, endY - startY) + 20;
  const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);

  winLineEl.style.left = `${startX - 10}px`;
  winLineEl.style.top = `${startY}px`;
  winLineEl.style.transform = `rotate(${angle}deg)`;
  winLineEl.hidden = false;
  winLineEl.style.width = "0px";
  requestAnimationFrame(() => {
    winLineEl.style.width = `${length}px`;
  });
}

/* ---------------------------------------------------------------
   Vanishing Mode — each move disappears once 5 newer moves have
   been played after it. moveQueue tracks alive cells oldest-first;
   once it grows past VANISH_LIMIT the oldest one is removed from
   `board` and animated out, so every later checkWinner() call sees
   only cells that are still actually on the board.
--------------------------------------------------------------- */
function vanishCell(index){
  board[index] = null;
  const cell = cellEls[index];
  if (!cell) return;
  cell.classList.remove("about-to-vanish");
  cell.classList.add("vanishing");
  setTimeout(() => {
    // A restart between the timeout being scheduled and firing could have
    // already reset this cell — only clear it if it's still the same mark.
    if (cell.classList.contains("vanishing")){
      cell.innerHTML = "";
      cell.className = "cell";
    }
  }, 480);
}

function updateAboutToVanishHighlight(){
  cellEls.forEach((c) => c.classList.remove("about-to-vanish"));
  if (vanishingMode && moveQueue.length === VANISH_LIMIT && !gameOver){
    cellEls[moveQueue[0]]?.classList.add("about-to-vanish");
  }
}

/* =====================================================================
   Status + scoreboard rendering
===================================================================== */
function playerLabel(symbol){
  if (mode === "pvc") return symbol === "X" ? "You" : "Computer";
  return `Player ${symbol}`;
}

function updateLabels(){
  labelXEl.textContent = mode === "pvc" ? "You (X)" : "Player X";
  labelOEl.textContent = mode === "pvc" ? "Computer (O)" : "Player O";
}

function updateStatus(){
  scoreBoxXEl.classList.toggle("active-turn", !gameOver && currentPlayer === "X");
  scoreBoxOEl.classList.toggle("active-turn", !gameOver && currentPlayer === "O");

  statusLineEl.className = "status-line";
  if (gameOver) return;

  if (computerThinking){
    statusLineEl.textContent = "Computer is thinking";
    statusLineEl.classList.add("thinking");
    return;
  }
  const prefix = vanishingMode ? "👻 " : "";
  statusLineEl.textContent = `${prefix}${playerLabel(currentPlayer)}'s turn`;
}

function renderScoreboard(){
  scoreXEl.textContent = scores.X;
  scoreOEl.textContent = scores.O;
  scoreDrawsEl.textContent = scores.draws;
}

/* =====================================================================
   Game flow
===================================================================== */
function handleCellClick(index){
  if (gameOver || board[index] || computerThinking) return;
  if (mode === "pvc" && currentPlayer === "O") return;

  placeMark(index, currentPlayer);
}

function placeMark(index, symbol){
  board[index] = symbol;
  moveQueue.push(index);
  renderMark(index, symbol);
  playMoveSound();

  // Winner is checked the instant a mark lands, using the board exactly
  // as it exists right now — a move that completes a line wins even if
  // one of its cells is about to expire on the following turn.
  const result = checkWinner(board);
  if (result){
    endGame(result);
    return;
  }

  if (vanishingMode){
    if (moveQueue.length > VANISH_LIMIT){
      vanishCell(moveQueue.shift());
    }
    // Board re-checked in case the (rare) fully-packed state still
    // occurred; vanishing keeps this effectively unreachable in practice.
    if (isFull(board)){
      endGame(null);
      return;
    }
  } else if (isFull(board)){
    endGame(null);
    return;
  }

  currentPlayer = currentPlayer === "X" ? "O" : "X";
  updateStatus();
  updateAboutToVanishHighlight();

  if (mode === "pvc" && currentPlayer === "O"){
    computerThinking = true;
    updateStatus();
    setTimeout(() => {
      if (gameOver) return;
      const move = getComputerMove(board, "O", "X", difficulty);
      computerThinking = false;
      if (move !== null && move !== undefined) placeMark(move, "O");
    }, 450 + Math.random() * 350);
  }
}

function endGame(result){
  gameOver = true;
  computerThinking = false;
  cellEls.forEach((c) => c.classList.remove("about-to-vanish"));

  if (result){
    highlightWinLine(result.line);
    scores[result.winner]++;

    if (mode === "pvc"){
      if (result.winner === "X"){
        statusLineEl.textContent = "🎉 You win!";
        statusLineEl.classList.add("win");
        playWinSound();
      } else {
        statusLineEl.textContent = "💻 Computer wins!";
        statusLineEl.classList.add("lose");
        playLoseSound();
      }
    } else {
      statusLineEl.textContent = `🏆 ${playerLabel(result.winner)} wins!`;
      statusLineEl.classList.add("win");
      playWinSound();
    }
  } else {
    scores.draws++;
    statusLineEl.textContent = "🤝 It's a draw!";
    playDrawSound();
  }

  scoreBoxXEl.classList.remove("active-turn");
  scoreBoxOEl.classList.remove("active-turn");
  renderScoreboard();
  reportResultToFirestore(result);
}

/* ---------------------------------------------------------------
   Firestore integration — lifetime stats + achievements + missions,
   plus the Vanishing Mode achievement when a decisive win happens
   while the variant is active.
   PvP is local pass-and-play, so any decisive win counts as a "win"
   for the signed-in player; in PvC only the human (X) winning counts.
--------------------------------------------------------------- */
async function reportResultToFirestore(result){
  const user = getCurrentUser();
  if (!user) return;

  const won = mode === "pvc"
    ? !!(result && result.winner === "X")
    : !!result;

  try{
    await recordGameResult(user.uid, { gameKey: "tic-tac-toe", won });
    if (vanishingMode && result){
      await recordAchievementProgress(user.uid, "vanishing_wins");
    }
  }catch(err){
    console.error("Failed to record game result:", err);
  }
}

/* =====================================================================
   Vanishing Mode — coin-locked unlock
===================================================================== */
function renderVanishingToggle(){
  vanishingToggle.classList.toggle("on", vanishingMode);
  vanishingToggle.setAttribute("aria-checked", String(vanishingMode));
  vanishingToggle.classList.toggle("locked", !vanishingUnlocked);
  vanishingLockBadge.hidden = vanishingUnlocked;
  if (!vanishingUnlocked){
    vanishingCostLabel.textContent = `Unlock for ${VANISHING_COST} 🪙`;
  }
}

async function handleVanishingToggleClick(){
  const user = getCurrentUser();
  if (!user) return;

  if (!vanishingUnlocked){
    playClickSound();
    try{
      await spendCoins(user.uid, VANISHING_COST, {
        reason: "Unlocked Vanishing Mode (Tic Tac Toe)",
        category: "feature"
      });
      await updateProfileData(user.uid, {
        unlockedFeatures: arrayUnion(VANISHING_FEATURE_ID)
      });
      showBanner("👻 Vanishing Mode unlocked!", "success");
      // vanishingUnlocked flips true via the live profile listener
      // (onProfileUpdate below), which re-renders the toggle for us.
    }catch(err){
      if (err.code === "coins/insufficient-funds"){
        showBanner(`Not enough coins — you need ${err.needed} more.`);
      } else {
        console.error("Failed to unlock Vanishing Mode:", err);
        showBanner("Couldn't unlock Vanishing Mode. Please try again.");
      }
    }
    return;
  }

  vanishingMode = !vanishingMode;
  renderVanishingToggle();
  resetScore();
  restartRound();
  playClickSound();
}

/* =====================================================================
   Controls
===================================================================== */
function restartRound(){
  board = Array(9).fill(null);
  moveQueue = [];
  currentPlayer = "X";
  gameOver = false;
  computerThinking = false;
  clearBoardDOM();
  updateStatus();
  playClickSound();
}

function resetScore(){
  scores = { X: 0, O: 0, draws: 0 };
  renderScoreboard();
}

function wireControls(){
  restartBtn.addEventListener("click", restartRound);
  resetScoreBtn.addEventListener("click", () => { resetScore(); playClickSound(); });
  vanishingToggle.addEventListener("click", handleVanishingToggleClick);
}

/** Called by the bootstrap's Setup screen right before this screen is
 *  shown — applies the chosen Player-vs-Player/Computer mode (and, for
 *  PvC, difficulty), then starts a fresh round with the score reset. */
export function applyConfig({ mode: newMode, difficulty: newDifficulty }){
  mode = newMode;
  if (newDifficulty) difficulty = newDifficulty;
  updateLabels();
  resetScore();
  restartRound();
}

/* =====================================================================
   Init — called once by the page bootstrap; the screen may be hidden
   the whole time, so DOM is built once and just toggled via CSS.
===================================================================== */
export function init(){
  const screen = document.getElementById("classicScreen");
  boardEl = screen.querySelector("#classicBoard");
  winLineEl = screen.querySelector("#classicWinLine");
  statusLineEl = screen.querySelector("#classicStatusLine");
  scoreXEl = screen.querySelector("#classicScoreX");
  scoreOEl = screen.querySelector("#classicScoreO");
  scoreDrawsEl = screen.querySelector("#classicScoreDraws");
  scoreBoxXEl = screen.querySelector("#classicScoreBoxX");
  scoreBoxOEl = screen.querySelector("#classicScoreBoxO");
  labelXEl = screen.querySelector("#classicLabelX");
  labelOEl = screen.querySelector("#classicLabelO");
  restartBtn = screen.querySelector("#classicRestartBtn");
  resetScoreBtn = screen.querySelector("#classicResetScoreBtn");
  vanishingToggle = screen.querySelector("#vanishingToggle");
  vanishingLockBadge = screen.querySelector("#vanishingLockBadge");
  vanishingCostLabel = screen.querySelector("#vanishingCostLabel");

  buildBoardCells();
  wireControls();
  updateLabels();
  updateStatus();
  renderScoreboard();
  renderVanishingToggle();

  onProfileUpdate(() => {
    const nowUnlocked = hasUnlockedFeature(VANISHING_FEATURE_ID);
    if (nowUnlocked !== vanishingUnlocked){
      vanishingUnlocked = nowUnlocked;
      renderVanishingToggle();
    }
  });
}

/** Called by the bootstrap whenever this screen becomes visible again. */
export function onEnter(){
  // Nothing time-sensitive to refresh right now, but exported for symmetry
  // with ttt-ultimate.js and future needs (e.g. re-measuring the win line).
}
