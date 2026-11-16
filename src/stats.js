import { CREW, DAILY, GIFT, RANK_CASH_BONUS, RANKS, SAVE, SHOP, STATS, UPGRADES } from './config.js'

// The local player's progress (the one thing that is saved), what it adds up to
// (capacity, walk speed, rates, multipliers, rank) and a tiny event bus the HUD,
// windows and world systems listen on. Mutate only through the helpers below so
// every change is announced.

export const state = {
  cash: 0,
  strength: STATS.startStrength,
  speed: STATS.startSpeed,
  totalBlocks: 0, // placed into towers (the rank XP)
  buildings: 0, // towers finished while you helped
  bag: 0, // blocks carried now
  upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
  passes: {}, // id -> true
  gymOwned: {}, // premium gym tier index -> true
  crew: [], // worker names
  daily: { day: '', streak: 0 }, // last claimed day (YYYY-MM-DD) and how many in a row
  giftIn: GIFT.every, // s of play until the free gift
  playtime: 0,
  tower: null, // the shared tower's progress (tower.js owns the shape of it)
  rankSeen: 0, // highest rank already celebrated
}

// --- Events ------------------------------------------------------------------------------
const listeners = new Map()
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set())
  listeners.get(name).add(fn)
  return () => listeners.get(name).delete(fn)
}
export function emit(name, data) {
  const set = listeners.get(name)
  if (set) for (const fn of set) fn(data)
}

// --- Multipliers that come from outside the save (world events, crew) -----------------------
export const boosts = { eventCash: 1, eventGym: 1, eventBuild: 1 }

// --- Derived -----------------------------------------------------------------------------
export const upgradeDef = (id) => UPGRADES.find((u) => u.id === id)
export const upgradeValue = (id) => upgradeDef(id).value(state.upgrades[id])
export const capacity = () => Math.floor(STATS.capacity(state.strength) * (state.passes.bag2 ? 1.5 : 1))
export const walkSpeed = () => STATS.walkSpeed(state.speed)
export const bagFull = () => state.bag >= capacity()
// Blocks per second into the bag in the pit / out of it at the build.
export const grabRate = () => Math.max(STATS.minRate, (capacity() / STATS.fillTime) * upgradeValue('grab') * boosts.eventBuild)
export const buildRate = () => Math.max(STATS.minRate, (capacity() / STATS.buildTime) * upgradeValue('build') * boosts.eventBuild)
export const buildRange = () => upgradeValue('range')
export const liftSpeed = () => upgradeValue('lift')
export const muscle = () => STATS.muscle(state.strength)
export const crewBonus = () => Math.min(state.crew.length, CREW.max) * CREW.bonus

export function rankIndex(blocks = state.totalBlocks) {
  let i = 0
  while (i + 1 < RANKS.length && blocks >= RANKS[i + 1].at) i++
  return i
}
export const rank = () => RANKS[rankIndex()]
export const nextRank = () => RANKS[rankIndex() + 1] ?? null

export function cashMultiplier() {
  return (1 + rankIndex() * RANK_CASH_BONUS + crewBonus()) * (state.passes.cash2 ? 2 : 1) * boosts.eventCash
}
export const gymMultiplier = (kind) => (kind === 'strength' ? (state.passes.str2 ? 2 : 1) : state.passes.spd2 ? 2 : 1) * boosts.eventGym

// --- Mutations ---------------------------------------------------------------------------
export function addCash(n) {
  if (!n) return
  state.cash = Math.max(0, state.cash + n)
  emit('cash', n)
}
export function spend(n) {
  if (state.cash < n) return false
  state.cash -= n
  emit('cash', -n)
  return true
}
export function addStat(kind, n) {
  state[kind] += n
  emit(kind, n)
}
export function setBag(n) {
  const before = state.bag
  state.bag = Math.max(0, Math.min(capacity(), n))
  if (state.bag !== before) emit('bag', state.bag - before)
}
// Blocks that went into the tower from you: rank XP and cash.
export function placedBlocks(n, { pay = true } = {}) {
  const before = rankIndex()
  state.totalBlocks += n
  emit('placed', n)
  if (pay) addCash(n * cashMultiplier())
  const after = rankIndex()
  if (after > before && after > state.rankSeen) {
    state.rankSeen = after
    emit('rankUp', after)
  }
}
export function buyUpgrade(id) {
  const def = upgradeDef(id)
  const level = state.upgrades[id]
  if (level >= def.max) return { max: true }
  const price = def.price(level)
  if (!spend(price)) return { need: price - state.cash }
  state.upgrades[id]++
  emit('upgrade', id)
  return { done: true }
}
export function buyPass(id) {
  const def = SHOP.passes.find((p) => p.id === id)
  if (state.passes[id]) return { owned: true }
  if (!spend(def.price)) return { need: def.price - state.cash }
  state.passes[id] = true
  emit('pass', id)
  return { done: true }
}

// --- Daily rewards -----------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10)
function dayDiff(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}
// { canClaim, index (0..6 of today's reward), streak }
export function dailyStatus() {
  const d = state.daily
  const t = today()
  if (d.day === t) return { canClaim: false, index: (d.streak - 1) % DAILY.length, streak: d.streak }
  const keep = d.day && dayDiff(d.day, t) === 1
  const streak = keep ? d.streak : 0
  return { canClaim: true, index: streak % DAILY.length, streak }
}
export function claimDaily() {
  const s = dailyStatus()
  if (!s.canClaim) return null
  const reward = DAILY[s.index]
  state.daily = { day: today(), streak: s.streak + 1 }
  grant(reward)
  emit('daily', reward)
  return reward
}
export function grant(reward) {
  if (reward.cash) addCash(reward.cash)
  if (reward.strength) addStat('strength', reward.strength)
  if (reward.speed) addStat('speed', reward.speed)
}

// --- Save / load ------------------------------------------------------------------------------
const SAVED = ['cash', 'strength', 'speed', 'totalBlocks', 'buildings', 'bag', 'upgrades', 'passes', 'gymOwned', 'crew', 'daily', 'giftIn', 'playtime', 'tower', 'rankSeen']
export function load() {
  try {
    const raw = localStorage.getItem(SAVE.key)
    if (!raw) return false
    const data = JSON.parse(raw)
    for (const k of SAVED) {
      if (data[k] === undefined) continue
      if (k === 'upgrades') Object.assign(state.upgrades, data.upgrades)
      else state[k] = data[k]
    }
    state.rankSeen = Math.max(state.rankSeen, rankIndex())
    return true
  } catch {
    return false
  }
}
export function save() {
  try {
    const out = {}
    for (const k of SAVED) out[k] = state[k]
    localStorage.setItem(SAVE.key, JSON.stringify(out))
  } catch {
    // Storage blocked or full: this session only.
  }
}
export function resetSave() {
  try {
    localStorage.removeItem(SAVE.key)
  } catch {
    // Ignore.
  }
}

// --- Number formatting -----------------------------------------------------------------------------
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
export function short(n) {
  n = Math.floor(n)
  if (n < 1000) return String(n)
  let i = 0
  let v = n
  while (v >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 100 ? Math.floor(v) : Math.floor(v * 100) / 100}${SUFFIXES[i]}`
}
export const commas = (n) => Math.floor(n).toLocaleString('en-US')
export function clock(s) {
  s = Math.max(0, Math.ceil(s))
  const m = Math.floor(s / 60)
  const ss = s % 60
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${m}:${String(ss).padStart(2, '0')}`
}
