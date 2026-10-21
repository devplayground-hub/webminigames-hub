/* =====================================================================
   Memory Match — Core Logic
   Pure, DOM-free deck building + shuffling. Kept separate from the
   controller so the "how a deck is built" rule (including the 5x5
   bonus-star cell) lives in exactly one place.
===================================================================== */

/* 13 distinct glyphs — more than the 12 pairs the largest grid (5x5)
   ever needs, so there's always headroom without repeats. */
const SYMBOL_POOL = ["🎮", "🕹️", "👾", "🚀", "🛸", "🔥", "💎", "🏆", "🎯", "🍀", "⚡", "🎧", "🛡️"];

/* Reserved separately from SYMBOL_POOL so it can never collide with a
   pair glyph — it's not a pair, it's a one-off bonus. */
export const BONUS_SYMBOL = "⭐";

/** Fisher–Yates shuffle. Returns a new array; never mutates the input. */
export function shuffleArray(arr){
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ---------------------------------------------------------------
   Builds a fresh deck for a given grid size.
   4x4 = 16 cells = 8 pairs, evenly matchable.
   5x5 = 25 cells is odd, so pairs can't fill it evenly — the center
   cell instead becomes a one-off "bonus star": not part of matching,
   just an optional instant coin/score reward the player can claim.
   That keeps every grid size visually square while every pair still
   has exactly one match.
--------------------------------------------------------------- */
export function generateDeck(gridSize){
  const totalCells = gridSize * gridSize;
  const hasBonus = totalCells % 2 === 1;
  const pairCount = hasBonus ? (totalCells - 1) / 2 : totalCells / 2;
  const bonusIndex = hasBonus ? Math.floor(totalCells / 2) : null;

  if (pairCount > SYMBOL_POOL.length){
    throw new Error(`generateDeck: grid size ${gridSize} needs ${pairCount} pairs, only ${SYMBOL_POOL.length} symbols available.`);
  }

  const symbols = SYMBOL_POOL.slice(0, pairCount);
  const pairDeck = shuffleArray(symbols.flatMap((s) => [s, s]));

  const cells = [];
  let pos = 0;
  for (let i = 0; i < totalCells; i++){
    if (i === bonusIndex){
      cells.push({ type: "bonus", symbol: BONUS_SYMBOL, matched: false });
    } else {
      cells.push({ type: "pair", symbol: pairDeck[pos++], matched: false });
    }
  }

  return { gridSize, totalCells, pairCount, bonusIndex, cells };
}
