/* =====================================================================
   Help Modal — shared wiring for every game's ❓ "How to Play" modal.
   Mirrors the Rock Paper Scissors rules-modal behavior exactly (same
   open/close via ❓ button and ✕ button, backdrop click, Escape key)
   so all games feel identical without each page re-implementing it.
===================================================================== */

import { playClickSound } from "./game-audio.js";

/**
 * Wires a ❓ Help button to open a modal, and its ✕ button / backdrop /
 * Escape key to close it.
 * @param {Object} ids
 * @param {string} ids.btnId      - id of the ❓ button that opens the modal
 * @param {string} ids.overlayId  - id of the .modal-overlay element
 * @param {string} ids.closeBtnId - id of the ✕ close button inside the modal
 */
export function initHelpModal({ btnId, overlayId, closeBtnId }){
  const btn = document.getElementById(btnId);
  const overlay = document.getElementById(overlayId);
  const closeBtn = document.getElementById(closeBtnId);
  if (!btn || !overlay || !closeBtn) return;

  function hide(){
    overlay.hidden = true;
  }

  btn.addEventListener("click", () => {
    playClickSound();
    overlay.hidden = false;
  });
  closeBtn.addEventListener("click", () => {
    playClickSound();
    hide();
  });
  // Clicking the dimmed backdrop (outside the modal box) also closes it.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) hide();
  });
}
