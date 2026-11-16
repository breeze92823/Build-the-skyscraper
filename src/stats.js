import { CREW, DAILY, EGGS, GIFT, PET, PETS, PET_PASSES, RANKS, RANK_CASH_BONUS, ROBOT, ROBOT_GEAR, SAVE, SHOP, SPIN, STATS, UPGRADES } from './config.js'

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
  gear: { owned: {}, on: null }, // Robot Gear: ids bought (-> true) and the one worn
  pets: [], // owned pets: { uid, id, tier (0 normal, 1 golden, 2 rainbow) }
  petEq: [], // uids of the pets out with you
  petSeen: {}, // pet id -> true once hatched (the egg panel shows the rest as silhouettes)
  petUid: 1,
  spins: { normal: SPIN.start, golden: 0, pity: 0 },
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
export const boosts = { eventCash: 1, eventGym: 1, eventBuild: 1, gearBuild: 1 } // gearBuild: Titan Armor's drop boost

// --- Derived -----------------------------------------------------------------------------
export const upgradeDef = (id) => UPGRADES.find((u) => u.id === id)
export const upgradeValue = (id) => upgradeDef(id).value(state.upgrades[id])
// --- Robot Gear: the worn piece's stats (no gear: x1 and +0) ---------------------------------
export const gearDef = (id) => ROBOT_GEAR.find((g) => g.id === id) ?? null
export const gearOn = () => gearDef(state.gear.on)
export const gearBlocks = () => gearOn()?.blocks ?? 1
export const gearBuild = () => (gearOn()?.build ?? 1) * boosts.gearBuild
export const capacity = () => Math.floor(STATS.capacity(state.strength) * (state.passes.bag2 ? 1.5 : 1)) + (gearOn()?.capacity ?? 0)
// The HUD shows walk speed x 3.6, so a gear's +N Walk Speed is N / 3.6 m/s.
export const walkSpeed = () => Math.min(ROBOT.maxWalk, STATS.walkSpeed(state.speed) + (gearOn()?.walk ?? 0) / 3.6)
export const bagFull = () => state.bag >= capacity()
// Blocks per second into the bag in the pit / out of it at the build.
export const grabRate = () => Math.max(STATS.minRate, (capacity() / STATS.fillTime) * upgradeValue('grab') * boosts.eventBuild)
export const buildRate = () => Math.max(STATS.minRate, (capacity() / STATS.buildTime) * upgradeValue('build') * boosts.eventBuild * gearBuild())
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
  return (1 + rankIndex() * RANK_CASH_BONUS + crewBonus()) * (state.passes.cash2 ? 2 : 1) * boosts.eventCash * (1 + petBonus())
}
export const gymMultiplier = (kind) => (kind === 'strength' ? (state.passes.str2 ? 2 : 1) : state.passes.spd2 ? 2 : 1) * boosts.eventGym * (1 + petBonus())

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

// --- Pets ----------------------------------------------------------------------------------
export const petDef = (id) => PETS.find((p) => p.id === id)
export const eggDef = (id) => EGGS.find((e) => e.id === id)
// One pet's boost (0.2 = +20% cash and gym gains), with its Golden / Rainbow tier.
export const petPower = (p) => petDef(p.id).bonus * PET.tiers[p.tier ?? 0].mult
export const petSlots = () => PET.slots + (state.passes.slots ? 2 : 0)
export const petBonus = () => {
  let b = 0
  for (const uid of state.petEq) {
    const p = state.pets.find((q) => q.uid === uid)
    if (p) b += petPower(p)
  }
  return b
}
export const petFree = () => PET.storage - state.pets.length
export const isEquipped = (uid) => state.petEq.includes(uid)
// How many eggs one Multi hatch opens (the best hatching pass you own).
export const multiCount = () => PET_PASSES.reduce((n, p) => (p.multi && state.passes[p.id] ? Math.max(n, p.multi) : n), 1)
// `force` lets a prize (spin wheel) go past full storage.
export function addPet(id, tier = 0, { force = false } = {}) {
  if (!force && state.pets.length >= PET.storage) return null
  const p = { uid: state.petUid++, id, tier }
  state.pets.push(p)
  state.petSeen[id] = true
  // A free slot fills itself with the new pet, so a first hatch does something right away.
  if (state.petEq.length < petSlots()) state.petEq.push(p.uid)
  emit('pets', p)
  return p
}
export function equipPet(uid) {
  if (isEquipped(uid)) {
    state.petEq = state.petEq.filter((u) => u !== uid)
  } else {
    if (state.petEq.length >= petSlots()) return false
    state.petEq.push(uid)
  }
  emit('pets', null)
  return true
}
export function equipBest() {
  state.petEq = [...state.pets].sort((a, b) => petPower(b) - petPower(a)).slice(0, petSlots()).map((p) => p.uid)
  emit('pets', null)
}
export function unequipAll() {
  state.petEq = []
  emit('pets', null)
}
export function deletePet(uid) {
  state.pets = state.pets.filter((p) => p.uid !== uid)
  state.petEq = state.petEq.filter((u) => u !== uid)
  emit('pets', null)
}
// Stacks of the same pet + tier, strongest first: [{ id, tier, list: [pet...] }].
export function petStacks() {
  const map = new Map()
  for (const p of state.pets) {
    const k = `${p.id}|${p.tier}`
    if (!map.has(k)) map.set(k, { id: p.id, tier: p.tier, list: [] })
    map.get(k).list.push(p)
  }
  return [...map.values()].sort((a, b) => petPower(b.list[0]) - petPower(a.list[0]))
}
// Pet Merge machine: PET.merge of the same pet (unequipped ones used first) -> one of the next tier.
export function mergePets(id, tier) {
  if (tier >= PET.tiers.length - 1) return null
  const same = state.pets.filter((p) => p.id === id && p.tier === tier)
  if (same.length < PET.merge) return null
  const wasOut = same.some((p) => isEquipped(p.uid))
  const use = same.sort((a, b) => Number(isEquipped(a.uid)) - Number(isEquipped(b.uid))).slice(0, PET.merge)
  const gone = new Set(use.map((p) => p.uid))
  state.pets = state.pets.filter((p) => !gone.has(p.uid))
  state.petEq = state.petEq.filter((u) => !gone.has(u))
  const p = { uid: state.petUid++, id, tier: tier + 1 }
  state.pets.push(p)
  if (wasOut || state.petEq.length < petSlots()) state.petEq.push(p.uid)
  emit('pets', p)
  return p
}
// Rolls one pet out of an egg (Lucky Eggs doubles Epic and Legendary).
export function rollEgg(eggId) {
  const egg = eggDef(eggId)
  const pets = PETS.filter((p) => p.egg === eggId)
  const w = egg.odds.map((o, i) => o * (state.passes.lucky && (pets[i].rarity === 'epic' || pets[i].rarity === 'legendary') ? PET.luck : 1))
  let r = Math.random() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < w.length; i++) {
    r -= w[i]
    if (r < 0) return pets[i]
  }
  return pets[0]
}
// The odds the egg panel shows (%), with Lucky Eggs applied.
export function eggOdds(eggId) {
  const egg = eggDef(eggId)
  const pets = PETS.filter((p) => p.egg === eggId)
  const w = egg.odds.map((o, i) => o * (state.passes.lucky && (pets[i].rarity === 'epic' || pets[i].rarity === 'legendary') ? PET.luck : 1))
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((v) => (v / sum) * 100)
}
export function buyPetPass(id) {
  const def = PET_PASSES.find((p) => p.id === id)
  if (state.passes[id]) return { owned: true }
  if (!spend(def.price)) return { need: def.price - state.cash }
  state.passes[id] = true
  emit('pass', id)
  return { done: true }
}

// --- Spin wheel ----------------------------------------------------------------------------
export const spinScale = () => 1 + state.buildings * SPIN.scale
export function addSpins(kind, n) {
  state.spins[kind] += n
  emit('spins', kind)
}

// Robot Gear: buying wears it straight away. Returns { done } | { need } | { owned }.
export function buyGear(id) {
  const def = gearDef(id)
  if (!def) return {}
  if (state.gear.owned[id]) return { owned: true }
  if (!spend(def.price)) return { need: def.price - state.cash }
  state.gear.owned[id] = true
  state.gear.on = id
  emit('gear', id)
  return { done: true }
}
// Wear an owned piece (null / the worn one again: take it off).
export function wearGear(id) {
  if (id && !state.gear.owned[id]) return false
  state.gear.on = id && state.gear.on !== id ? id : null
  if (state.bag > capacity()) state.bag = capacity()
  emit('gear', state.gear.on)
  return true
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
const SAVED = ['cash', 'strength', 'speed', 'totalBlocks', 'buildings', 'bag', 'upgrades', 'passes', 'gymOwned', 'crew', 'daily', 'giftIn', 'playtime', 'tower', 'rankSeen', 'pets', 'petEq', 'petSeen', 'petUid', 'spins', 'gear']
export function load() {
  try {
    const raw = localStorage.getItem(SAVE.key)
    if (!raw) return false
    const data = JSON.parse(raw)
    for (const k of SAVED) {
      if (data[k] === undefined) continue
      if (k === 'upgrades') Object.assign(state.upgrades, data.upgrades)
      else if (k === 'gear') state.gear = { owned: { ...data.gear?.owned }, on: data.gear?.owned?.[data.gear?.on] ? data.gear.on : null }
      else if (k === 'spins') Object.assign(state.spins, data.spins)
      else state[k] = data[k]
    }
    state.rankSeen = Math.max(state.rankSeen, rankIndex())
    // Drop pets whose kind no longer exists and equipped uids that point nowhere.
    state.pets = state.pets.filter((p) => petDef(p.id))
    state.petEq = state.petEq.filter((u) => state.pets.some((p) => p.uid === u))
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
