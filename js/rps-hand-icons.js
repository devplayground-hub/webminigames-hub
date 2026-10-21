/* =====================================================================
   RPS Move Icons — Web Mini Games Hub
   Every move (Classic and Extended) renders as a single emoji badge,
   so the visuals stay simple and consistent across the whole game.
===================================================================== */

// One emoji per move, covering both the Classic (rock/paper/scissors) and
// Extended (+ lizard/spock, or the fire/water variant) rule sets.
const MOVE_ICONS = {
  rock: "✊🏻",
  paper: "🖐🏻",
  scissors: "✌🏻",
  lizard: "🦎",
  spock: "🖖",
  fire: "🔥",
  water: "💧"
};

/**
 * Wraps a move's emoji in a `role="img"` span with an accessible label,
 * so screen readers announce the move name instead of just an emoji glyph.
 * Unknown move ids fall back to a "❔" placeholder rather than throwing.
 */
export function buildIconVisual(move){
  const emoji = MOVE_ICONS[move] || "❔";
  return `<span class="icon-visual" role="img" aria-label="${move}">${emoji}</span>`;
}

/** Returns the emoji visual for any move. */
export function buildMoveVisual(move){
  return buildIconVisual(move);
}
