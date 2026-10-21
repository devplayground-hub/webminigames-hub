/* =====================================================================
   Tic Tac Toe — Core Game Logic
   Pure, DOM-free 3x3 primitives shared by Classic mode (ttt-classic.js)
   and, per sub-board, by Ultimate mode (ttt-ultimate.js). Keeping this
   isolated means both modes stay in sync on the rules and neither file
   re-implements win detection or the minimax AI.
===================================================================== */

export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

/** Returns { winner, line } for a 3x3 board array, or null. */
export function checkWinner(board){
  for (const line of WIN_LINES){
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]){
      return { winner: board[a], line };
    }
  }
  return null;
}

/** True once every cell of a 3x3 board array is filled (used to detect a draw). */
export function isFull(board){
  return board.every((cell) => cell !== null);
}

/** Indices of every still-empty cell on a 3x3 board array. */
export function getAvailableMoves(board){
  return board.reduce((acc, cell, i) => { if (!cell) acc.push(i); return acc; }, []);
}

/* ---------------------------------------------------------------
   Minimax AI — perfect play at "hard". 3x3 is tiny, so a plain
   (unpruned) minimax is instant; no need for alpha-beta here.
--------------------------------------------------------------- */
function minimax(board, depth, isMaximizing, aiSymbol, humanSymbol){
  const result = checkWinner(board);
  if (result){
    if (result.winner === aiSymbol) return 10 - depth;
    if (result.winner === humanSymbol) return depth - 10;
  }
  if (isFull(board)) return 0;

  const moves = getAvailableMoves(board);
  if (isMaximizing){
    let best = -Infinity;
    for (const move of moves){
      board[move] = aiSymbol;
      best = Math.max(best, minimax(board, depth + 1, false, aiSymbol, humanSymbol));
      board[move] = null;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves){
    board[move] = humanSymbol;
    best = Math.min(best, minimax(board, depth + 1, true, aiSymbol, humanSymbol));
    board[move] = null;
  }
  return best;
}

/** Minimax-optimal move for aiSymbol on the given 3x3 board (never loses). */
export function getBestMove(board, aiSymbol, humanSymbol){
  let bestScore = -Infinity;
  let bestMove = null;
  for (const move of getAvailableMoves(board)){
    board[move] = aiSymbol;
    const score = minimax(board, 0, false, aiSymbol, humanSymbol);
    board[move] = null;
    if (score > bestScore){
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

/** Picks any legal move at random — used for "easy" and half of "medium" difficulty. */
export function getRandomMove(board){
  const moves = getAvailableMoves(board);
  return moves[Math.floor(Math.random() * moves.length)];
}

/**
 * Chooses the computer's move for a given difficulty:
 *  - easy:   always random
 *  - medium: 50/50 coin flip between optimal and random, so the AI is
 *            beatable but not careless
 *  - hard:   always the minimax-optimal move (unbeatable)
 */
export function getComputerMove(board, aiSymbol, humanSymbol, difficulty){
  if (difficulty === "easy") return getRandomMove(board);
  if (difficulty === "medium") return Math.random() < 0.5
    ? getBestMove(board, aiSymbol, humanSymbol)
    : getRandomMove(board);
  return getBestMove(board, aiSymbol, humanSymbol); // hard = unbeatable
}
