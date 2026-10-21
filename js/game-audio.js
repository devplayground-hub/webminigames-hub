/* =====================================================================
   Game Audio — Web Mini Games Hub
   Small, reusable sound-effect helper for game pages. Uses the Web
   Audio API to synthesize short tones — no audio files to host or
   load. Respects the sound on/off + volume settings from the
   Settings page (localStorage, via settings-service.js) automatically.
===================================================================== */

import { readLocalSettings } from "./settings-service.js";

let audioCtx = null;
function getAudioContext(){
  if (!audioCtx){
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
  }
  // Browsers suspend new AudioContexts until a user gesture; resume
  // defensively every time in case it got suspended.
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function currentVolume(){
  const settings = readLocalSettings();
  return settings.soundEnabled ? settings.soundVolume : 0;
}

function tone(freq, duration, { type = "sine", volumeScale = 1, delay = 0 } = {}){
  const vol = currentVolume() * volumeScale;
  if (vol <= 0) return;

  try{
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const startAt = ctx.currentTime + delay;
    gain.gain.setValueAtTime(vol * 0.3, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration);
  }catch(err){
    console.error("Sound playback failed:", err);
  }
}

function sequence(notes, noteDuration, options = {}){
  notes.forEach((freq, i) => tone(freq, noteDuration, { ...options, delay: i * noteDuration * 0.85 }));
}

/* ---------------------------------------------------------------
   Named effects
--------------------------------------------------------------- */
export function playMoveSound(){
  tone(520, 0.09, { type: "triangle" });
}

export function playClickSound(){
  tone(700, 0.05, { type: "square", volumeScale: 0.6 });
}

export function playWinSound(){
  sequence([523.25, 659.25, 783.99, 1046.5], 0.13, { type: "triangle" });
}

export function playLoseSound(){
  sequence([392, 349.23, 293.66], 0.16, { type: "sawtooth", volumeScale: 0.7 });
}

export function playDrawSound(){
  tone(300, 0.3, { type: "sawtooth", volumeScale: 0.5 });
}

/* ---------------------------------------------------------------
   Memory Match effects — appended here (not a separate audio module)
   so every game keeps sharing one sound system + one settings-driven
   volume/mute state.
--------------------------------------------------------------- */
export function playFlipSound(){
  tone(440, 0.07, { type: "triangle", volumeScale: 0.7 });
}

export function playMatchSound(){
  sequence([659.25, 987.77], 0.11, { type: "triangle" });
}

export function playMismatchSound(){
  tone(220, 0.18, { type: "sawtooth", volumeScale: 0.55 });
}

export function playShuffleSound(){
  sequence([392, 440, 494, 392], 0.06, { type: "square", volumeScale: 0.45 });
}

export function playHintSound(){
  tone(880, 0.12, { type: "sine", volumeScale: 0.6 });
}

export function playBonusSound(){
  sequence([523.25, 783.99, 1046.5], 0.1, { type: "sine", volumeScale: 0.7 });
}

export function playCompleteSound(){
  sequence([523.25, 659.25, 783.99, 1046.5, 1318.5], 0.12, { type: "triangle" });
}

/* ---------------------------------------------------------------
   Achievement unlock — a short bright fanfare, distinct from the
   plain win sound, used whenever the achievement toast appears.
--------------------------------------------------------------- */
export function playAchievementSound(){
  sequence([659.25, 880, 1046.5, 1318.5], 0.1, { type: "triangle" });
}

/* ---------------------------------------------------------------
   Notification System effects — shared by notification-service.js
   for its five toast types (success / warning / error / achievement
   / coin). Kept here so every sound in the app — game feedback and
   UI notifications alike — flows through one settings-aware engine.
--------------------------------------------------------------- */

/** Bright two-note "ding" — success / confirmation toasts. */
export function playSuccessSound(){
  sequence([784, 1046.5], 0.11, { type: "triangle", volumeScale: 0.8 });
}

/** Neutral, slightly tense two-note blip — warning toasts. */
export function playWarningSound(){
  sequence([622.25, 493.88], 0.13, { type: "square", volumeScale: 0.55 });
}

/** Low descending buzz — error toasts. Deliberately unpleasant but brief. */
export function playErrorSound(){
  sequence([311.13, 233.08], 0.16, { type: "sawtooth", volumeScale: 0.6 });
}

/** Bright metallic "cha-ching" — coin earned toasts. */
export function playCoinSound(){
  tone(1318.5, 0.05, { type: "square", volumeScale: 0.5 });
  tone(1760, 0.16, { type: "sine", volumeScale: 0.7, delay: 0.045 });
}
