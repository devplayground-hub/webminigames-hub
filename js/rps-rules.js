/* =====================================================================
   RPS Rules — Web Mini Games Hub
   Pure data + pure functions, no DOM. Defines every move, what beats
   what, and the flavor verb used in the round explanation, for both
   Classic (3 moves) and Extended (7 moves) modes.

   Extended mode's 7 moves form a complete round-robin: each move
   beats exactly 3 of the other 6 and loses to the other 3, so no
   match-up is ever ambiguous or randomly decided.
===================================================================== */

export const MOVES = {
  rock:     { id: "rock",     label: "Rock",     verb: "crushes",    beats: ["scissors", "lizard", "fire"] },
  paper:    { id: "paper",    label: "Paper",     verb: "covers",     beats: ["rock", "spock", "water"] },
  scissors: { id: "scissors", label: "Scissors",  verb: "cuts",       beats: ["paper", "lizard", "fire"] },
  lizard:   { id: "lizard",   label: "Lizard",    verb: "poisons",    beats: ["spock", "paper", "water"] },
  spock:    { id: "spock",    label: "Spock",     verb: "vaporizes",  beats: ["scissors", "rock", "fire"] },
  fire:     { id: "fire",     label: "Fire",      verb: "burns",      beats: ["paper", "lizard", "water"] },
  water:    { id: "water",    label: "Water",     verb: "erodes",     beats: ["rock", "scissors", "spock"] }
};

export const CLASSIC_MOVE_IDS = ["rock", "paper", "scissors"];
export const EXTENDED_MOVE_IDS = ["rock", "paper", "scissors", "lizard", "spock", "fire", "water"];

export function getMovesForMode(mode){
  return (mode === "extended" ? EXTENDED_MOVE_IDS : CLASSIC_MOVE_IDS).map((id) => MOVES[id]);
}

/** Picks a random legal move for the computer, given the active mode. */
export function pickComputerMove(mode){
  const pool = mode === "extended" ? EXTENDED_MOVE_IDS : CLASSIC_MOVE_IDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Determines the round outcome from the player's perspective.
 * Returns "win" | "lose" | "draw".
 */
export function determineWinner(playerMove, computerMove){
  if (playerMove === computerMove) return "draw";
  return MOVES[playerMove].beats.includes(computerMove) ? "win" : "lose";
}

/**
 * Builds the human-readable relationship explanation for a completed
 * round, e.g. "Spock vaporizes Scissors" or "Water erodes Fire".
 * Always describes it from winner -> loser, regardless of who won.
 */
export function explainRound(playerMove, computerMove, result){
  if (result === "draw"){
    return `Both chose ${MOVES[playerMove].label} — it's a draw!`;
  }
  const winnerId = result === "win" ? playerMove : computerMove;
  const loserId = result === "win" ? computerMove : playerMove;
  const winner = MOVES[winnerId];
  const loser = MOVES[loserId];
  return `${winner.label} ${winner.verb} ${loser.label}.`;
}
