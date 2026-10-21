/* =====================================================================
   Tic Tac Toe — Ultimate Mode Controller
   Nine linked 3x3 boards arranged as a 3x3 meta-grid. The cell a player
   picks determines which board their opponent must play in next; if
   that board is already decided (won/drawn) or full, the opponent may
   play in any open board. Built on the same win-detection primitives
   as Classic mode (ttt-core.js) applied per sub-board and, for the
   overall winner, to the meta-board of sub-board results.
===================================================================== */

import { WIN_LINES, checkWinner, isFull, getAvailableMoves, getRandomMove } from "./ttt-core.js";
import { recordGameResult, recordAchievementProgress } from "./achievement-service.js";
import { playMoveSound, playWinSound, playLoseSound, playDrawSound, playClickSound } from "./game-audio.js";
import { getCurrentUser } from "./game-shared.js";

/* =====================================================================
   STATE
===================================================================== */
let boards = [];           // boards[b] = 3x3 array for sub-board b
let metaBoard = [];        // metaBoard[b] = null | "X" | "O" | "draw"
let activeBoardIndex = null; // null = any open board is playable
let currentPlayer = "X";
let mode = "pvp";
let difficulty = "medium";
let gameOver = false;
let computerThinking = false;
let scores = { X: 0, O: 0, draws: 0 };

/* =====================================================================
   DOM refs (resolved lazily in init(), scoped to #ultimateScreen)
===================================================================== */
let boardWrapEl, boardEl, winLineEl, statusLineEl;
let scoreXEl, scoreOEl, scoreDrawsEl, scoreBoxXEl, scoreBoxOEl, labelXEl, labelOEl;
let restartBtn, resetScoreBtn;
let miniBoardEls = [];
let miniCellEls = [];      // miniCellEls[b][c]
let overlayEls = [];

function markGlyph(symbol){
  return symbol === "X"
    ? `<svg class="mark mark-x" viewBox="0 0 100 100"><line x1="20" y1="20" x2="80" y2="80" /><line x1="80" y1="20" x2="20" y2="80" /></svg>`
    : `<svg class="mark mark-o" viewBox="0 0 100 100"><circle cx="50" cy="50" r="35" /></svg>`;
}

function buildBoard(){
  for (let b = 0; b < 9; b++){
    const miniBoard = document.createElement("div");
    miniBoard.className = "mini-board";
    miniBoard.dataset.board = String(b);

    const cells = [];
    for (let c = 0; c < 9; c++){
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "mini-cell";
      cell.dataset.board = String(b);
      cell.dataset.cell = String(c);
      cell.setAttribute("aria-label", `Board ${b + 1}, cell ${c + 1}`);
      cell.addEventListener("click", () => handleCellClick(b, c));
      miniBoard.appendChild(cell);
      cells.push(cell);
    }

    const overlay = document.createElement("div");
    overlay.className = "mini-board-overlay";
    miniBoard.appendChild(overlay);

    boardEl.appendChild(miniBoard);
    miniBoardEls.push(miniBoard);
    miniCellEls.push(cells);
    overlayEls.push(overlay);
  }
}

function resetBoardsState(){
  boards = Array.from({ length: 9 }, () => Array(9).fill(null));
  metaBoard = Array(9).fill(null);
  activeBoardIndex = null;
  currentPlayer = "X";
  gameOver = false;
  computerThinking = false;
}

function clearBoardDOM(){
  for (let b = 0; b < 9; b++){
    miniCellEls[b].forEach((cell) => {
      cell.innerHTML = "";
      cell.className = "mini-cell";
    });
    miniBoardEls[b].className = "mini-board";
    overlayEls[b].className = "mini-board-overlay";
    overlayEls[b].textContent = "";
  }
  winLineEl.hidden = true;
  winLineEl.style.width = "0px";
}

function renderMiniMark(b, c, symbol){
  const cell = miniCellEls[b][c];
  cell.innerHTML = markGlyph(symbol);
  cell.classList.add("filled", "disabled");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      cell.querySelector(".mark")?.classList.add("drawn");
    });
  });
}

function showBoardOverlay(b, value){
  const overlay = overlayEls[b];

  if (value === "draw"){
    overlay.innerHTML = `<span class="overlay-draw">—</span>`;
    overlay.classList.add("show", "draw");
  } else {
    // Reuses the exact same neon SVG mark used for individual cells
    // (just styled larger via CSS) so the big symbol matches the
    // game's existing X/O look rather than a plain text glyph.
    overlay.innerHTML = markGlyph(value);
    overlay.classList.add("show", `win-${value.toLowerCase()}`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.querySelector(".mark")?.classList.add("drawn");
      });
    });
  }

  // The mini-board is now permanently claimed: the small moves that
  // led to this result are hidden (via CSS, triggered by "decided")
  // so only the one large symbol reads at a glance, and every cell
  // in the board is marked inactive so it can never be clicked again.
  miniBoardEls[b].classList.add("decided", value === "draw" ? "drawn" : `won-${value.toLowerCase()}`);
  miniCellEls[b].forEach((cell) => { if (!cell.classList.contains("filled")) cell.classList.add("inactive"); });
}

/* ---------------------------------------------------------------
   Which boards are currently clickable, and highlighting them.
--------------------------------------------------------------- */
function isBoardPlayable(b){
  if (metaBoard[b]) return false;
  return activeBoardIndex === null || activeBoardIndex === b;
}

function updateBoardHighlights(){
  for (let b = 0; b < 9; b++){
    miniBoardEls[b].classList.toggle("playable", !gameOver && isBoardPlayable(b));
  }
}

function clearBoardHighlights(){
  miniBoardEls.forEach((el) => el.classList.remove("playable"));
}

/* ---------------------------------------------------------------
   Overall (meta) winner — same WIN_LINES applied to sub-board
   results, careful to never let three "draw" entries look like a win.
--------------------------------------------------------------- */
function checkMetaWinner(meta){
  for (const line of WIN_LINES){
    const [a, b, c] = line;
    const va = meta[a];
    if (va && va !== "draw" && va === meta[b] && va === meta[c]){
      return { winner: va, line };
    }
  }
  return null;
}

function highlightMetaWinLine(line){
  line.forEach((i) => miniBoardEls[i].classList.add("meta-win-board"));

  const [a, , c] = line;
  const cellA = miniBoardEls[a].getBoundingClientRect();
  const cellC = miniBoardEls[c].getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();

  const startX = cellA.left + cellA.width / 2 - boardRect.left;
  const startY = cellA.top + cellA.height / 2 - boardRect.top;
  const endX = cellC.left + cellC.width / 2 - boardRect.left;
  const endY = cellC.top + cellC.height / 2 - boardRect.top;

  const length = Math.hypot(endX - startX, endY - startY) + 30;
  const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);

  winLineEl.style.left = `${startX - 15}px`;
  winLineEl.style.top = `${startY}px`;
  winLineEl.style.transform = `rotate(${angle}deg)`;
  winLineEl.hidden = false;
  winLineEl.style.width = "0px";
  requestAnimationFrame(() => {
    winLineEl.style.width = `${length}px`;
  });
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
  const boardHint = activeBoardIndex === null ? "any open board" : `board ${activeBoardIndex + 1}`;
  statusLineEl.textContent = `${playerLabel(currentPlayer)}'s turn — play in ${boardHint}`;
}

function renderScoreboard(){
  scoreXEl.textContent = scores.X;
  scoreOEl.textContent = scores.O;
  scoreDrawsEl.textContent = scores.draws;
}

/* =====================================================================
   Game flow
===================================================================== */
function handleCellClick(b, c){
  if (gameOver || computerThinking) return;
  if (mode === "pvc" && currentPlayer === "O") return;
  if (!isBoardPlayable(b) || boards[b][c]) return;

  placeMark(b, c, currentPlayer);
}

function placeMark(b, c, symbol){
  boards[b][c] = symbol;
  renderMiniMark(b, c, symbol);
  playMoveSound();

  if (!metaBoard[b]){
    const subResult = checkWinner(boards[b]);
    if (subResult){
      metaBoard[b] = symbol;
      showBoardOverlay(b, symbol);
    } else if (isFull(boards[b])){
      metaBoard[b] = "draw";
      showBoardOverlay(b, "draw");
    }
  }

  const metaResult = checkMetaWinner(metaBoard);
  if (metaResult){
    endGame(metaResult);
    return;
  }
  if (metaBoard.every((v) => v)){
    endGame(null);
    return;
  }

  // Official forwarding rule: the cell chosen sends the opponent to the
  // matching board index, unless that board is already decided — then
  // they get a free choice among any open board.
  activeBoardIndex = metaBoard[c] ? null : c;
  currentPlayer = symbol === "X" ? "O" : "X";
  updateStatus();
  updateBoardHighlights();

  if (mode === "pvc" && currentPlayer === "O"){
    computerThinking = true;
    updateStatus();
    setTimeout(() => {
      if (gameOver) return;
      const move = getUltimateComputerMove(difficulty);
      computerThinking = false;
      if (move) placeMark(move.board, move.cell, "O");
    }, 500 + Math.random() * 400);
  }
}

function endGame(result){
  gameOver = true;
  computerThinking = false;
  activeBoardIndex = null;
  clearBoardHighlights();

  if (result){
    highlightMetaWinLine(result.line);
    scores[result.winner]++;

    if (mode === "pvc"){
      if (result.winner === "X"){
        statusLineEl.textContent = "🎉 You win the Ultimate board!";
        statusLineEl.classList.add("win");
        playWinSound();
      } else {
        statusLineEl.textContent = "💻 Computer wins the Ultimate board!";
        statusLineEl.classList.add("lose");
        playLoseSound();
      }
    } else {
      statusLineEl.textContent = `🏆 ${playerLabel(result.winner)} wins the Ultimate board!`;
      statusLineEl.classList.add("win");
      playWinSound();
    }
  } else {
    scores.draws++;
    statusLineEl.textContent = "🤝 It's an overall draw!";
    playDrawSound();
  }

  scoreBoxXEl.classList.remove("active-turn");
  scoreBoxOEl.classList.remove("active-turn");
  renderScoreboard();
  reportResultToFirestore(result);
}

async function reportResultToFirestore(result){
  const user = getCurrentUser();
  if (!user) return;

  const won = mode === "pvc"
    ? !!(result && result.winner === "X")
    : !!result;

  try{
    await recordGameResult(user.uid, { gameKey: "tic-tac-toe", won });
    if (result){
      await recordAchievementProgress(user.uid, "ultimate_wins");
    }
  }catch(err){
    console.error("Failed to record game result:", err);
  }
}

/* ---------------------------------------------------------------
   Heuristic computer opponent. A full game-tree minimax over nine
   linked boards is far too large to search live in the browser, so
   this evaluates each candidate move on: does it win the sub-board,
   does it block the opponent's sub-board win, simple positional
   preference (center board/cell), and — on Hard — whether the move
   would forward the opponent into a board they could win immediately.
--------------------------------------------------------------- */
function getUltimateComputerMove(diff){
  const candidateBoards = activeBoardIndex !== null
    ? [activeBoardIndex]
    : metaBoard.map((v, i) => (v ? null : i)).filter((i) => i !== null);

  if (!candidateBoards.length) return null;

  if (diff === "easy"){
    const b = candidateBoards[Math.floor(Math.random() * candidateBoards.length)];
    return { board: b, cell: getRandomMove(boards[b]) };
  }

  let best = null;
  let bestScore = -Infinity;
  for (const b of candidateBoards){
    for (const cell of getAvailableMoves(boards[b])){
      const score = evaluateMove(b, cell, diff) + (diff === "medium" ? Math.random() * 3 : 0);
      if (score > bestScore){
        bestScore = score;
        best = { board: b, cell };
      }
    }
  }
  return best || { board: candidateBoards[0], cell: getRandomMove(boards[candidateBoards[0]]) };
}

function wouldWinSubBoard(b, cell, symbol){
  const backup = boards[b][cell];
  boards[b][cell] = symbol;
  const result = checkWinner(boards[b]);
  boards[b][cell] = backup;
  return !!result;
}

function evaluateMove(b, cell, diff){
  let score = 0;

  if (wouldWinSubBoard(b, cell, "O")) score += 60;
  if (wouldWinSubBoard(b, cell, "X")) score += 25; // blocks the human's win in this sub-board
  if (cell === 4) score += 3;   // center of a sub-board
  if (b === 4) score += 2;      // center sub-board is strategically strong

  if (diff === "hard"){
    // Discourage sending the opponent into a board where they'd win instantly.
    const forwardBoard = cell;
    if (!metaBoard[forwardBoard]){
      const opponentCanWin = getAvailableMoves(boards[forwardBoard])
        .some((fc) => wouldWinSubBoard(forwardBoard, fc, "X"));
      if (opponentCanWin) score -= 45;
    }
  }

  return score;
}

/* =====================================================================
   Controls
===================================================================== */
function restartRound(){
  resetBoardsState();
  clearBoardDOM();
  updateStatus();
  updateBoardHighlights();
  playClickSound();
}

function resetScore(){
  scores = { X: 0, O: 0, draws: 0 };
  renderScoreboard();
}

function wireControls(){
  restartBtn.addEventListener("click", restartRound);
  resetScoreBtn.addEventListener("click", () => { resetScore(); playClickSound(); });
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
   Init
===================================================================== */
export function init(){
  const screen = document.getElementById("ultimateScreen");
  boardWrapEl = screen.querySelector("#ultimateBoardWrap");
  boardEl = screen.querySelector("#ultimateBoard");
  winLineEl = screen.querySelector("#ultimateWinLine");
  statusLineEl = screen.querySelector("#ultimateStatusLine");
  scoreXEl = screen.querySelector("#ultimateScoreX");
  scoreOEl = screen.querySelector("#ultimateScoreO");
  scoreDrawsEl = screen.querySelector("#ultimateScoreDraws");
  scoreBoxXEl = screen.querySelector("#ultimateScoreBoxX");
  scoreBoxOEl = screen.querySelector("#ultimateScoreBoxO");
  labelXEl = screen.querySelector("#ultimateLabelX");
  labelOEl = screen.querySelector("#ultimateLabelO");
  restartBtn = screen.querySelector("#ultimateRestartBtn");
  resetScoreBtn = screen.querySelector("#ultimateResetScoreBtn");

  resetBoardsState();
  buildBoard();
  wireControls();
  updateLabels();
  updateStatus();
  renderScoreboard();
  updateBoardHighlights();
}

export function onEnter(){
  // Exported for symmetry with ttt-classic.js / future needs.
}
