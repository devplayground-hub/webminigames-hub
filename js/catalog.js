/* =====================================================================
   Shared Catalogs — Web Mini Games Hub
   Single source of truth for achievements and avatars so the hub
   dashboard and the profile page never drift out of sync.
===================================================================== */

/* ---------------------------------------------------------------
   Achievements
   `type` + `target` drive the generic threshold engine in
   achievement-service.js — recordAchievementProgress(uid, type)
   checks every achievement of that type and unlocks any whose
   target has been reached. "welcome" has no type/target because
   it's granted directly via unlockAchievement() on signup rather
   than tracked as a running count.
--------------------------------------------------------------- */
export const ACHIEVEMENTS = [
  { id: "welcome",       title: "Welcome Aboard",    desc: "Join Web Mini Games Hub",                         icon: "🎉", reward: 25 },
  { id: "first_win",     title: "First Win",         desc: "Win your first game",                             icon: "🥇", type: "wins",             target: 1,   reward: 20 },
  { id: "wins_10",       title: "10 Wins",           desc: "Win 10 games across any game",                    icon: "🏅", type: "wins",             target: 10,  reward: 50 },
  { id: "wins_50",       title: "50 Wins",           desc: "Win 50 games across any game",                    icon: "🏆", type: "wins",             target: 50,  reward: 150 },
  { id: "games_100",     title: "100 Games Played",  desc: "Play 100 games total",                            icon: "🎮", type: "games_played",     target: 100, reward: 75 },
  { id: "memory_master", title: "Memory Master",     desc: "Clear a Memory Match board with zero mismatches", icon: "🧠", type: "memory_perfect",   target: 1,   reward: 40 },
  { id: "lucky_guesser", title: "Lucky Guesser",     desc: "Guess the number correctly on your very first try", icon: "🍀", type: "guess_first_try",  target: 1,   reward: 30 },
  { id: "sharp_shooter", title: "Sharp Shooter",     desc: "Win a Number Guessing round without using any hints", icon: "🎯", type: "guess_no_hint_wins", target: 1,   reward: 25 },
  { id: "precision_master", title: "Precision Master", desc: "Win a Number Guessing round on Hard difficulty",   icon: "🎖️", type: "guess_hard_wins",   target: 1,   reward: 50 },
  { id: "range_master",  title: "Range Master",      desc: "Win a Number Guessing round in the 1–1000 range",    icon: "📏", type: "guess_range1000_wins", target: 1, reward: 40 },
  { id: "ultimate_champion", title: "Ultimate Champion", desc: "Win a game of Ultimate Tic Tac Toe",          icon: "🌌", type: "ultimate_wins",    target: 1,   reward: 40 },
  { id: "vanishing_victor",  title: "Vanishing Victor", desc: "Win a game with Vanishing Mode active",        icon: "👻", type: "vanishing_wins",   target: 1,   reward: 35 },
  { id: "shuffle_survivor",  title: "Shuffle Survivor", desc: "Clear a board in Memory Match's Shuffle Mode", icon: "🔀", type: "shuffle_wins",     target: 1,   reward: 35 },
  { id: "rps_streak_3",      title: "3 Win Streak",     desc: "Win 3 Rock Paper Scissors rounds in a row",   icon: "🔥", type: "rps_streak_3",     target: 1,   reward: 20 },
  { id: "rps_streak_5",      title: "5 Win Streak",     desc: "Win 5 Rock Paper Scissors rounds in a row",   icon: "⚡", type: "rps_streak_5",     target: 1,   reward: 35 },
  { id: "rps_extended_winner", title: "Extended Mode Winner", desc: "Win a round in Rock Paper Scissors Extended Mode", icon: "🖖", type: "rps_extended_win", target: 1, reward: 30 }
];

/* ---------------------------------------------------------------
   Avatars
   Emoji-based so no Firebase Storage bucket/upload flow is needed —
   selecting one is a plain Firestore write. The first 5 are free
   (unlocked for every new profile in auth-service.js); the rest are
   purchased with coins from the profile page.
--------------------------------------------------------------- */
export const AVATARS = [
  { id: "default",    emoji: "🎮", name: "Player",    cost: 0 },
  { id: "ninja",      emoji: "🥷", name: "Ninja",     cost: 0 },
  { id: "robot",      emoji: "🤖", name: "Robot",     cost: 0 },
  { id: "alien",      emoji: "👽", name: "Alien",     cost: 0 },
  { id: "wizard",     emoji: "🧙", name: "Wizard",    cost: 0 },

  { id: "ghost",      emoji: "👻", name: "Ghost",     cost: 100 },
  { id: "astronaut",  emoji: "🧑‍🚀", name: "Astronaut", cost: 150 },
  { id: "dragon",     emoji: "🐉", name: "Dragon",    cost: 150 },
  { id: "phoenix",    emoji: "🔥", name: "Phoenix",   cost: 175 },
  { id: "unicorn",    emoji: "🦄", name: "Unicorn",   cost: 200 },
  { id: "vampire",    emoji: "🧛", name: "Vampire",   cost: 200 },
  { id: "king",       emoji: "👑", name: "Royalty",   cost: 300 }
];

export const FREE_AVATAR_IDS = AVATARS.filter(a => a.cost === 0).map(a => a.id);

/* ---------------------------------------------------------------
   Daily Missions
   `type` groups missions by the kind of event that advances them —
   recordMissionProgress(uid, type, amount) in missions-service.js
   bumps every mission that matches, so more missions of the same
   type can be added later without touching the tracking call sites.
--------------------------------------------------------------- */
export const DAILY_MISSIONS = [
  { id: "play_3_games",   title: "Play 3 Games",   icon: "🎮", type: "games_played", target: 3,   reward: 15 },
  { id: "win_2_games",    title: "Win 2 Games",    icon: "🏆", type: "games_won",    target: 2,   reward: 20 },
  { id: "earn_100_coins", title: "Earn 100 Coins", icon: "💰", type: "coins_earned", target: 100, reward: 25 },
  { id: "use_1_hint",     title: "Use a Hint",     icon: "💡", type: "hints_used",   target: 1,   reward: 10 }
];
