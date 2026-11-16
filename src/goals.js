import { GOALS, UPGRADES } from './config.js'
import * as S from './stats.js'

// Goals: one short personal goal at a time ("Place 340 blocks", "Help finish 2 floors", ...), shown on the HUD
// goal card. Every goal is SIZED TO THE PLAYER (about GOALS.minutes of play at their current pace: their recent
// income, bag and gym gain), so a brand-new player and a veteran both finish one every few minutes, and its cash
// reward is GOALS.rewardSec seconds of their own recent income. Precise: when the next upgrade is within reach
// (it costs at most GOALS.topUp x the reward more than you have), the reward becomes EXACTLY what it still costs,
// so finishing the goal lets you buy it right away. Every GOALS.chestEvery goals a chest adds a timed cash boost.
// Come-back loop: the first GOALS.perDay goals of a UTC day pay in full, later ones GOALS.afterCap of it until
// midnight; the first goal after GOALS.welcome.away s away pays GOALS.welcome.mult x.
// State: `state.goals` (saved; backend sanitize.ts sanitizeGoals): { kind, need, have, reward, done, day, today, seen }.

const DAY_MS = 86_400_000
const utcDay = (ms = Date.now()) => Math.floor(ms / DAY_MS)
// Rounds up to two significant digits (340, 1,200, 56K): goals read cleanly.
function nice(v) {
  if (!(v > 0)) return 1
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1))
  return Math.ceil(v / mag) * mag
}

const g = () => S.state.goals
let listener = null // fn(event): { kind: 'done', reward, topUp: { name, level } | null, chest: bool, welcome, bonus }
let welcome = false // this session's first goal pays the welcome-back bonus
let seenT = 0

// The cheapest next upgrade level you do not have yet: what a goal's reward tops you up to.
function nextUpgrade() {
  let best = null
  for (const u of UPGRADES) {
    const l = S.state.upgrades[u.id] ?? 0
    if (l >= u.max) continue
    const price = u.price(l)
    if (!best || price < best.price) best = { name: u.name, level: l + 1, price }
  }
  return best
}

// --- Kinds: how big a goal of this kind is for you right now (null = not available now) ---------------------
const secs = () => GOALS.minutes * 60
const KINDS = {
  place: {
    text: (n) => `Place ${S.commas(n)} blocks`,
    size: () => nice(Math.max(S.tripSize(), (S.recentIncome() / Math.max(1e-9, S.cashMultiplier())) * secs())),
  },
  earn: {
    text: (n) => `Earn $${S.short(n)} building`,
    size: () => nice(Math.max(10, S.recentIncome() * secs())),
  },
  floors: {
    text: (n) => `Help finish ${n} floor${n > 1 ? 's' : ''}`,
    size: () => GOALS.floors,
  },
  strength: {
    // About a minute of reps on the best pad you can use (plus walking there).
    text: (n) => `Train +${S.short(n)} Strength`,
    size: () => nice(S.bestGymMult() * S.gymMultiplier('strength') * GOALS.reps),
  },
  upgrade: {
    text: () => 'Buy an upgrade',
    // Only when one is within a few minutes of income.
    size: () => {
      const nx = nextUpgrade()
      return nx && nx.price <= S.state.cash + S.recentIncome() * secs() ? 1 : null
    },
  },
}

const baseReward = () => Math.max(GOALS.minReward, S.recentIncome() * GOALS.rewardSec)
const full = () => g().today < GOALS.perDay

function pick() {
  const st = g()
  const choices = []
  let total = 0
  for (const [kind, w] of Object.entries(GOALS.weights)) {
    if (kind === st.kind && Object.keys(GOALS.weights).length > 1) continue // never the same kind twice in a row
    const size = KINDS[kind]?.size()
    if (size == null) continue
    choices.push({ kind, size, w })
    total += w
  }
  let r = Math.random() * total
  const c = choices.find((x) => (r -= x.w) < 0) ?? choices[0]
  st.kind = c.kind
  st.need = c.size
  st.have = 0
  st.reward = Math.round(baseReward() * (full() ? 1 : GOALS.afterCap) * (welcome ? GOALS.welcome.mult : 1))
}

function rollDay() {
  const st = g()
  const d = utcDay()
  if (st.day !== d) {
    st.day = d
    st.today = 0
  }
}

function complete() {
  const st = g()
  rollDay()
  const isFull = full()
  // The reward: what was promised or what your income makes it now (whichever is more), then topped up to
  // exactly the next upgrade's price when that is close.
  let reward = Math.max(st.reward, Math.round(baseReward() * (isFull ? 1 : GOALS.afterCap) * (welcome ? GOALS.welcome.mult : 1)))
  let topUp = null
  const nx = isFull ? nextUpgrade() : null
  if (nx && nx.price > S.state.cash && nx.price - S.state.cash > reward && nx.price - S.state.cash <= reward * GOALS.topUp) {
    reward = Math.ceil(nx.price - S.state.cash)
    topUp = nx
  }
  S.addCash(reward)
  st.done++
  st.today++
  const chest = st.done % GOALS.chestEvery === 0
  if (chest) S.addTimed(GOALS.chest.stat, GOALS.chest.mult, GOALS.chest.time)
  const wasWelcome = welcome
  welcome = false
  listener?.({ kind: 'done', reward, topUp, chest, welcome: wasWelcome, bonus: !isFull })
  pick()
}

function progress(kind, n) {
  const st = g()
  if (st.kind !== kind || !(n > 0)) return
  st.have = Math.min(st.need, st.have + n)
  if (st.have >= st.need) complete()
}

// Call once after the save is loaded (and again after a hydrate).
export function initGoals() {
  const st = g()
  rollDay()
  // Back after a long break: the next goal pays the welcome-back bonus.
  welcome = st.seen > 0 && Date.now() - st.seen >= GOALS.welcome.away * 1000
  if (!st.kind || !KINDS[st.kind] || !(st.need > 0)) pick()
  else if (welcome) st.reward = Math.round(st.reward * GOALS.welcome.mult)
  st.seen = Date.now()
}

let wired = false
export function wireGoals() {
  if (wired) return
  wired = true
  S.on('placed', (n) => progress('place', n))
  S.on('earned', (n) => progress('earn', n))
  S.on('strength', (n) => progress('strength', n))
  S.on('upgrade', () => progress('upgrade', 1))
}
// main.js: a floor you helped on was finished.
export const floorHelped = () => progress('floors', 1)
export const onGoal = (fn) => (listener = fn)

// Every frame: the day rollover and the "last played" stamp (for the welcome-back bonus).
export function tickGoals(dt) {
  seenT += dt
  if (seenT < 15) return
  seenT = 0
  const st = g()
  st.seen = Date.now()
  const day = st.day
  rollDay()
  // A new day while playing: the current goal is re-priced at full reward.
  if (st.day !== day) st.reward = Math.max(st.reward, Math.round(baseReward()))
  // A goal that cannot be done any more (e.g. "Buy an upgrade" with everything maxed) is swapped.
  if (st.kind === 'upgrade' && KINDS.upgrade.size() == null && st.have < st.need) pick()
}

// What the HUD goal card shows.
export function goalView() {
  const st = g()
  const k = KINDS[st.kind]
  if (!k) return null
  const left = GOALS.perDay - st.today
  return {
    text: k.text(st.need),
    have: st.have,
    need: st.need,
    frac: Math.min(1, st.have / Math.max(1, st.need)),
    reward: st.reward,
    chest: GOALS.chestEvery - (st.done % GOALS.chestEvery), // goals until the next chest
    chestEvery: GOALS.chestEvery,
    tag: welcome ? `WELCOME BACK x${GOALS.welcome.mult}` : left > 0 ? `${left} LEFT TODAY` : 'BONUS 25%',
    bonus: left <= 0,
    resetIn: left <= 0 ? Math.max(0, (utcDay() + 1) * DAY_MS - Date.now()) / 1000 : 0,
  }
}
// Dev: finish the goal in progress.
export const __finishGoal = () => progress(g().kind, g().need)
