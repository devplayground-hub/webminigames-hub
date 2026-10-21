/* =====================================================================
   Hint Manager — Web Mini Games Hub
   Pure, reusable, framework-free hint logic for the Number Guessing
   game (or any future "guess the number" mode). Knows nothing about
   Firestore, coins, or the DOM — it just knows the secret number and
   how to hand out truthful, non-repeating hints plus their costs.

   Usage:
     const hm = createHintManager(secretNumber, rangeMin, rangeMax);
     hm.getNextCost(baseCost)   -> coin cost of the NEXT hint
     hm.requestHint()           -> { id, label, text } and marks it used
     hm.hasMoreHints()          -> false once every hint is exhausted
     hm.getHintsUsedCount()     -> number of hints spent so far
     hm.reset(secret, min, max) -> reuse the same instance for a new round
===================================================================== */

/* ---------------------------------------------------------------
   Small, self-contained number helpers. Kept local so this module
   has zero dependencies and can be dropped into any project as-is.
--------------------------------------------------------------- */
function isPrime(n){
  if (!Number.isInteger(n) || n < 2) return false;
  if (n <= 3) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6){
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/* Ordered pool of one-time hint types. "narrow" is intentionally not
   in here — it's the repeatable fallback once these run out. */
const HINT_TYPE_ORDER = ["parity", "primality", "div3", "div5", "midpoint"];

/* Range narrowing stops shrinking once the window is this small —
   any smaller and the hint would basically hand over the answer. */
const MIN_NARROW_WINDOW = 3;

export function createHintManager(secret, rangeMin, rangeMax){
  const state = {
    secret: null,
    min: 0,
    max: 0,
    usedTypes: new Set(),
    hintsUsedCount: 0,
    narrowLo: 0,
    narrowHi: 0
  };

  function reset(nextSecret, nextMin, nextMax){
    state.secret = nextSecret;
    state.min = nextMin;
    state.max = nextMax;
    state.usedTypes = new Set();
    state.hintsUsedCount = 0;
    state.narrowLo = nextMin;
    state.narrowHi = nextMax;
  }
  reset(secret, rangeMin, rangeMax);

  function narrowWindowExhausted(){
    return (state.narrowHi - state.narrowLo) <= MIN_NARROW_WINDOW;
  }

  /** True while at least one truthful, non-repeated hint remains. */
  function hasMoreHints(){
    const oneTimeLeft = HINT_TYPE_ORDER.some((t) => !state.usedTypes.has(t));
    return oneTimeLeft || !narrowWindowExhausted();
  }

  /** Coin cost of the NEXT hint: base, then doubles every time after. */
  function getNextCost(baseCost){
    return Math.round(baseCost * Math.pow(2, state.hintsUsedCount));
  }

  function buildParityHint(){
    const even = state.secret % 2 === 0;
    return { id: "parity", label: "Even / Odd", text: `The number is ${even ? "even" : "odd"}.` };
  }

  function buildPrimalityHint(){
    if (state.secret === 1){
      return { id: "primality", label: "Prime / Composite", text: "The number is neither prime nor composite — it's 1." };
    }
    const prime = isPrime(state.secret);
    return { id: "primality", label: "Prime / Composite", text: `The number is ${prime ? "prime" : "composite"}.` };
  }

  function buildDiv3Hint(){
    const yes = state.secret % 3 === 0;
    return { id: "div3", label: "Divisible by 3", text: `The number is ${yes ? "" : "NOT "}divisible by 3.` };
  }

  function buildDiv5Hint(){
    const yes = state.secret % 5 === 0;
    return { id: "div5", label: "Divisible by 5", text: `The number is ${yes ? "" : "NOT "}divisible by 5.` };
  }

  function buildMidpointHint(){
    const midpoint = (state.min + state.max) / 2;
    let comparison;
    if (state.secret > midpoint) comparison = `higher than the midpoint (${midpoint})`;
    else if (state.secret < midpoint) comparison = `lower than the midpoint (${midpoint})`;
    else comparison = `exactly the midpoint (${midpoint})`;
    return { id: "midpoint", label: "Higher / Lower than Midpoint", text: `The number is ${comparison}.` };
  }

  function buildNarrowHint(){
    // Shrink the current window to roughly half its size while always
    // keeping it inside the previous window AND containing the secret.
    // Deterministic on purpose — a hint's job is to be reliably true,
    // not to add noise.
    const currentWidth = state.narrowHi - state.narrowLo;
    const targetWidth = Math.max(MIN_NARROW_WINDOW, Math.floor(currentWidth / 2));

    let lo = Math.max(state.narrowLo, state.secret - targetWidth);
    let hi = Math.min(state.narrowHi, lo + targetWidth);
    lo = Math.max(state.narrowLo, hi - targetWidth);

    // Safety clamps: the window must always contain the secret.
    lo = Math.min(lo, state.secret);
    hi = Math.max(hi, state.secret);

    state.narrowLo = lo;
    state.narrowHi = hi;

    return { id: "narrow", label: "Range Narrowing", text: `The number is between ${state.narrowLo} and ${state.narrowHi} (inclusive).` };
  }

  const BUILDERS = {
    parity: buildParityHint,
    primality: buildPrimalityHint,
    div3: buildDiv3Hint,
    div5: buildDiv5Hint,
    midpoint: buildMidpointHint,
    narrow: buildNarrowHint
  };

  /** Hands out the next hint, spending it and marking it used. Throws if none remain. */
  function requestHint(){
    if (!hasMoreHints()){
      throw new Error("No hints remaining.");
    }

    const nextType = HINT_TYPE_ORDER.find((t) => !state.usedTypes.has(t));
    const type = nextType || "narrow";
    const hint = BUILDERS[type]();

    state.usedTypes.add(type);
    state.hintsUsedCount += 1;

    return hint;
  }

  function getHintsUsedCount(){
    return state.hintsUsedCount;
  }

  return {
    reset,
    hasMoreHints,
    getNextCost,
    requestHint,
    getHintsUsedCount
  };
}
