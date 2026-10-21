# Web Mini Games Hub — Project Structure

```
webminigames/
├── index.html              ← Auth page (Login / Sign Up / Guest) — the entry point
├── hub.html                 ← Dashboard, shown after sign-in
├── profile.html             ← User profile page
│
├── css/
│   ├── style.css             (styles for index.html)
│   ├── hub.css                (styles for hub.html)
│   └── profile.css            (styles for profile.html)
│
├── js/
│   ├── firebase-init.js      ← Firebase app init — put your real config here
│   ├── auth-service.js       ← All Firebase Auth + Firestore profile logic (no DOM code)
│   ├── catalog.js             ← Shared data: achievements list, avatar catalog
│   ├── settings-service.js     ← Theme/background catalogs, DOM theming, audio, localStorage + Firestore settings sync
│   ├── coin-service.js          ← Coin add/spend (atomic), animated coin UI helpers
│   ├── missions-service.js       ← Daily missions: 24h reset, progress tracking, atomic coin rewards
│   ├── achievement-service.js     ← Milestone tracking across all games + animated unlock toasts
│   ├── notification-service.js     ← Reusable toast system: success / warning / error /
│   │                                  achievement unlock / coin earned — icons, animation, sound
│   ├── game-audio.js               ← Reusable sound-effect helper (Web Audio, respects sound settings)
│   ├── auth.js                 (index.html's page controller)
│   ├── hub.js                   (hub.html's page controller)
│   ├── profile.js                (profile.html's page controller)
│   └── settings.js                (settings.html's page controller)
│
├── games/
│   ├── tic-tac-toe.html       ← Fully playable: PvP + PvC (minimax AI), score, sound, animations
│   ├── memory.html            ← placeholder stub
│   ├── rps.html                ← placeholder stub
│   └── number-guessing.html    ← placeholder stub
│
└── docs/
    └── firebase-setup-guide.md   (step-by-step Firebase console setup)
```

## Notification system (`js/notification-service.js`)

One reusable toast module used everywhere in the app. It's self-contained — import a function
and call it, no markup or CSS setup required:

```js
import {
  notifySuccess,
  notifyWarning,
  notifyError,
  notifyAchievement,
  notifyCoinEarned
} from "./notification-service.js";

notifySuccess("Profile saved", "Your changes are live.");
notifyWarning("Low on coins", "You need 20 more to buy this.");
notifyError("Couldn't save", "Check your connection and try again.");
notifyAchievement({ icon: "🥇", title: "First Win", desc: "Win your first game.", reward: 50 });
notifyCoinEarned(50, "Daily mission completed");
```

Each type gets its own icon, accent color, entrance/exit animation, auto-dismiss progress bar
(pauses on hover), and a settings-aware sound effect (via `game-audio.js` — respects the
sound on/off + volume settings from the Settings page). Toasts stack top-right, cap at 4
visible at once, and queue the rest so a burst of events never gets silently dropped.

`achievement-service.js`'s `showAchievementToast(s)` — already called from every game page and
the hub/profile/settings pages whenever an achievement unlocks — now renders through this same
system, so achievement unlocks share one consistent toast stack and sound engine with everything
else instead of duplicating their own CSS/DOM.

## Why it's organized this way

- **HTML files stay at the root.** Keeping `index.html`, `hub.html`, and `profile.html` at the top level means your redirects (`window.location.href = "hub.html"`, etc.) keep working exactly as they already do in the code — no path changes needed there.
- **`css/` and `js/` separate styles from logic** — standard convention, makes it obvious where to look when editing either.
- **`js/` files import each other by relative path** (e.g. `hub.js` does `import { db } from "./firebase-init.js"`). Since all six JS files live together in the same folder, none of those import statements needed to change — only the `<script src="...">` and `<link href="...">` tags in the three HTML files were updated to point into `css/` and `js/`.
- **`games/`** holds one file per game. Right now these are just placeholder pages with a "coming soon" message and a link back to the hub, so the dashboard's "Play Now" buttons don't 404. Replace each one with the real game as it's built.
- **`docs/`** holds project documentation that isn't part of the running app itself (currently just the Firebase setup guide).

## If you add more games or pages later

- A new game → drop it in `games/`, then add an entry to the `GAMES` array in `js/hub.js` (icon, title, description, category, and `href: "games/your-game.html"`).
- A new top-level page (e.g. a leaderboard) → put the `.html` at the root, its stylesheet in `css/`, its script in `js/`.
- Shared data (like achievements or avatars) → add it to `js/catalog.js` and import it wherever needed, rather than duplicating arrays across files.

## Performance & accessibility refactor (latest pass)

- **Deduplicated shared state.** `js/ttt-shared.js` was a near-exact copy of
  `js/game-shared.js`. It's gone — `game-shared.js` is now the single source
  of truth for auth/profile/coin-pill/banner/sound-toggle state, and
  `ttt-classic.js` / `ttt-ultimate.js` import from it directly.
- **Deduplicated the game-page boot sequence.** `tic-tac-toe.js`, `memory.js`,
  `rps.js`, and `number-guessing.js` each used to carry their own copy of the
  same ~35-line "auth guard → subscribe to profile → diff achievements →
  reflect coins → reconcile settings" block. That logic now lives once in
  **`js/game-page.js`** (`bootGamePage()`), and every game controller just
  calls it.
- **Lazy-loaded Tic Tac Toe's variants.** `ttt-classic.js` and
  `ttt-ultimate.js` used to be imported unconditionally, even though a
  session usually only plays one. `tic-tac-toe.js` now `import()`s each
  variant on demand, the first time the player actually selects it.
- **Trimmed the font payload.** Every page requested Poppins weight 300,
  which nothing in the CSS actually uses — removed from all 10 pages.
- **Accessibility: skip links + main landmarks.** Every page now has a
  keyboard-focusable "Skip to main content" link and an `id="main-content"`
  on its `<main>`, so keyboard/screen-reader users can bypass the topbar
  nav. (Icon-only controls, form labels, reduced-motion support, and toast
  `role="alert"`/`role="status"` were already solid and didn't need changes.)
- **Images:** the project has no raster images (no `<img>` tags, no
  background-image assets) — everything is CSS gradients/emoji — so there
  was nothing to compress.
- **Not yet touched:** `hub.js`, `profile.js`, and `settings.js`
  each have their own profile-listener + achievement-diff block similar to
  the one extracted into `game-page.js`, but interleaved with page-specific
  rendering (dashboard cards, avatar picker, theme picker). Worth factoring
  out later, but riskier to do without a live environment to test against.

## Running it

Same as before — these are ES modules, so you still need to serve the folder over `http://`, not open files directly (`file://`). See `docs/firebase-setup-guide.md`, Step 7, for the Live Server / `npx serve` instructions.
