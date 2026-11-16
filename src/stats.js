import { COMBO, EGGS, GYM, LUCKY, PET, PETS, PET_PASSES, RANKS, RANK_CASH_BONUS, RARITIES, REWARDS, ROBOT, ROBOT_GEAR, SAVE, SHOP, SPIN, STATS, TOWER, UPGRADES } from './config.js'

// The local player's progress (the one thing that is saved), what it adds up to
// (capacity, walk speed, rates, multipliers, rank) and a tiny event bus the HUD,
// windows and world systems listen on. Mutate only through the helpers below so
// every change is announced.

const fresh = () => ({
  cash: 0,
  strength: STATS.startStrength,
  speed: STATS.startSpeed,
  totalBlocks: 0, // placed into towers (the rank XP)
  buildings: 0, // towers finished while you helped
  bag: 0, // blocks carried now
  upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])),
  passes: {}, // id -> true
  gymOwned: {}, // premium gym tier index -> true
  // Daily / Playtime / Free rewards as the browser keeps them (guests, offline): rewards.js. Signed-in
  // players' live on the server instead (it sends them; this copy is not used then).
  rewards: { streak: 0, last: -1, playDay: -1, playSec: 0, playClaimed: [], free: false },
  freeSteps: 0, // bit per Free Reward step ticked
  timed: [], // running timed boosts: { stat: 'cash' | 'strength' | 'speed', mult, left (s of play) }
  playtime: 0,
  tower: null, // the shared tower's progress (tower.js owns the shape of it)
  rankSeen: 0, // highest rank already celebrated
  gear: { owned: {}, on: null }, // Robot Gear: ids bought (-> true) and the one worn
  pets: [], // owned pets: { uid, id, tier (0 normal, 1 golden, 2 rainbow) }
  petEq: [], // uids of the pets out with you
  petSeen: {}, // pet id -> true once hatched (the egg panel shows the rest as silhouettes)
  petUid: 1,
  petSlots: 0, // extra pet slots bought (PET.extraSlots)
  spins: { normal: SPIN.start, golden: 0, pity: 0 },
  // Goals tracker (goals.js): the goal in progress, goals finished ever / on UTC day `day`, last played (ms).
  goals: { kind: '', need: 0, have: 0, reward: 0, done: 0, day: -1, today: 0, seen: 0 },
})
export const state = fresh()

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

// --- Multipliers that come from outside the save (world events) -----------------------
export const boosts = { eventCash: 1, eventGym: 1, eventBuild: 1, gearBuild: 1 } // gearBuild: Titan Armor's drop boost

// --- Derived -----------------------------------------------------------------------------
export const upgradeDef = (id) => UPGRADES.find((u) => u.id === id)
export const upgradeValue = (id) => upgradeDef(id).value(state.upgrades[id])
// --- Robot Gear: the worn piece's stats (no gear: x1 and +0) ---------------------------------
export const gearDef = (id) => ROBOT_GEAR.find((g) => g.id === id) ?? null
export const gearOn = () => gearDef(state.gear.on)
export const gearBlocks = () => gearOn()?.blocks ?? 1
export const gearBuild = () => (gearOn()?.build ?? 1) * boosts.gearBuild
// Capacity / walk speed at a given Strength / Speed (the offline reward previews "before > after").
export const capacityFor = (strength) => Math.floor(STATS.capacity(strength) * (state.passes.bag2 ? 1.5 : 1)) + (gearOn()?.capacity ?? 0)
export const capacity = () => capacityFor(state.strength)
// The HUD shows walk speed x 3.6, so a gear's +N Walk Speed is N / 3.6 m/s.
export const walkSpeedFor = (speed) => Math.min(ROBOT.maxWalk, STATS.walkSpeed(speed) + (gearOn()?.walk ?? 0) / 3.6)
export const walkSpeed = () => walkSpeedFor(state.speed)
export const bagFull = () => state.bag >= capacity()
// Blocks per second into the bag in the pit / out of it at the build.
export const grabRate = () => Math.max(STATS.minRate, (capacity() / STATS.fillTime) * upgradeValue('grab') * boosts.eventBuild)
export const buildRate = () => Math.max(STATS.minRate, (capacity() / STATS.buildTime) * upgradeValue('build') * upgradeValue('hands') * boosts.eventBuild * gearBuild())
export const buildRange = () => upgradeValue('range')
// Wide Trowel: every block out of the bag places this many blocks (stacks with the worn gear's).
export const trowelMul = () => upgradeValue('trowel')
// Blocks one full bag of yours places on the tower (capacity x the worn gear's blocks x Wide Trowel): the
// `trip` the shared tower sizes its floors to (backend tower.ts floorNeed, tower.js in local play).
export const tripSize = () => Math.max(1, capacity() * gearBlocks() * trowelMul())

// --- Recent income: what your building has been paying lately ($/s, averaged over TOWER.incomeTau s) --------
// Floor / building rewards and Goals are measured in seconds of it, so they are worth the same to a brand-new
// player and to a veteran. Earnings from building only (placed blocks, lucky drops), never from rewards.
const income = { rate: 0, acc: 0 }
export const noteEarned = (n) => {
  if (!(n > 0)) return
  income.acc += n
  emit('earned', n) // Goals: "Earn $N building"
}
// Every frame.
export function tickIncome(dt) {
  if (!(dt > 0)) return
  const a = 1 - Math.exp(-dt / TOWER.incomeTau)
  income.rate += (income.acc / dt - income.rate) * a
  income.acc = 0
}
// $/s; never below half of what a bag a minute would pay you now (a fresh session starts at 0).
export const recentIncome = () => Math.max(income.rate, (tripSize() * cashMultiplier()) / 120)

// --- Coin Combo: placing blocks without a break fills the combo, which multiplies cash --------
const combo = { t: 0, idle: 0 } // t = 0..1 how full, idle = s since the last block
export const comboMax = () => upgradeValue('combo')
export const comboFill = () => combo.t
// Current cash multiplier from the combo (1 until the upgrade is bought).
export const comboMul = () => 1 + (comboMax() - 1) * combo.t
// Call every frame: `building` is true while blocks are going into the tower.
export function tickCombo(dt, building) {
  if (building) {
    combo.idle = 0
    combo.t = Math.min(1, combo.t + dt / COMBO.ramp)
  } else {
    combo.idle += dt
    if (combo.idle > COMBO.grace) combo.t = Math.max(0, combo.t - (dt / COMBO.ramp) * COMBO.drain)
  }
}
export const comboReset = () => {
  combo.t = 0
  combo.idle = 0
}

// --- Lucky drops: Fortune Luck chance per placed block, Golden Touch coins per drop ---------------
export const luckChance = () => upgradeValue('fortune') / 100
export const luckCoins = () => upgradeValue('golden')
export const coinCash = () => LUCKY.coinValue * cashMultiplier()
// Rolls the lucky drops for `blocks` placed blocks: { drops, coins, cash } (stochastic rounding,
// so big batches stay cheap and small ones still feel random).
export function rollLucky(blocks) {
  const want = blocks * luckChance()
  let drops = Math.floor(want)
  if (Math.random() < want - drops) drops++
  if (!drops) return null
  const coins = drops * luckCoins()
  return { drops, coins, cash: Math.round(coins * coinCash()) }
}
export const liftSpeed = () => upgradeValue('lift')
export const muscle = () => STATS.muscle(state.strength)

export function rankIndex(blocks = state.totalBlocks) {
  let i = 0
  while (i + 1 < RANKS.length && blocks >= RANKS[i + 1].at) i++
  return i
}
export const rank = () => RANKS[rankIndex()]
export const nextRank = () => RANKS[rankIndex() + 1] ?? null

export function cashMultiplier() {
  return (1 + rankIndex() * RANK_CASH_BONUS) * (state.passes.cash2 ? 2 : 1) * boosts.eventCash * (1 + petBonus()) * timedMul('cash')
}
// Pets boost cash only (config PETS): never gym gains.
export const gymMultiplier = (kind) => (kind === 'strength' ? (state.passes.str2 ? 2 : 1) : state.passes.spd2 ? 2 : 1) * boosts.eventGym * timedMul(kind)

// What a rep is worth with no event or running boost on: the 2x pass (offline training).
export const gymBaseMultiplier = (kind) => (kind === 'strength' ? (state.passes.str2 ? 2 : 1) : state.passes.spd2 ? 2 : 1)
// The multiplier of the best gym pad you may use (a premium pad you bought, a pad you won, or one your
// finished buildings opened): same rule as gym.js tierUnlocked.
export function bestGymMult() {
  let best = 1
  GYM.tiers.forEach((t, i) => {
    if (state.gymOwned[i] || (t.price == null && state.buildings >= t.need)) best = Math.max(best, t.mult)
  })
  return best
}

// --- Timed boosts (reward prizes): x mult on cash / Strength gains / Speed gains for a while of play ---
// Several can be held; per stat only the biggest one counts and ticks down, the rest wait their turn.
export function timedMul(stat) {
  let m = 1
  for (const b of state.timed) if (b.stat === stat && b.left > 0 && b.mult > m) m = b.mult
  return m
}
// The held boosts, biggest first per stat: [{ stat, mult, left, active }] (active = the one running).
export function timedList() {
  const list = [...state.timed].sort((a, b) => (a.stat === b.stat ? b.mult - a.mult : a.stat < b.stat ? -1 : 1))
  return list.map((b, i) => ({ stat: b.stat, mult: b.mult, left: b.left, active: i === 0 || list[i - 1].stat !== b.stat }))
}
// The same stat and multiplier again adds its time.
export function addTimed(stat, mult, seconds) {
  const same = state.timed.find((b) => b.stat === stat && b.mult === mult)
  if (same) same.left += seconds
  else {
    state.timed.push({ stat, mult, left: seconds })
    if (state.timed.length > REWARDS.timedMax) state.timed.sort((a, b) => b.mult * b.left - a.mult * a.left).length = REWARDS.timedMax
  }
  emit('timed', { stat, mult, added: true })
}
// Every frame of play. Emits 'timed' { stat, mult, ended: true } when one runs out.
export function tickTimed(dt) {
  if (!state.timed.length) return
  const top = {}
  for (const b of state.timed) if (!top[b.stat] || b.mult > top[b.stat].mult) top[b.stat] = b
  for (const b of Object.values(top)) b.left -= dt
  const ended = state.timed.filter((b) => b.left <= 0)
  if (!ended.length) return
  state.timed = state.timed.filter((b) => b.left > 0)
  for (const b of ended) emit('timed', { stat: b.stat, mult: b.mult, ended: true })
}

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
  if (pay) {
    const cash = n * cashMultiplier() * comboMul()
    addCash(cash)
    noteEarned(cash)
  }
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
// One pet's boost (0.2 = +20% cash), with its Golden / Rainbow tier.
export const petPower = (p) => petDef(p.id).bonus * PET.tiers[p.tier ?? 0].mult
export const petSlots = () => PET.slots + (state.passes.slots ? 2 : 0) + state.petSlots
// The Pets window's +1 SLOT: the next slot's cash price, or null when all are bought.
export const nextSlotPrice = () => PET.extraSlots[state.petSlots] ?? null
export function buyPetSlot() {
  const price = nextSlotPrice()
  if (price == null) return { max: true }
  if (!spend(price)) return { need: price - state.cash }
  state.petSlots++
  emit('pets', null)
  return { done: true }
}
// What SELL pays for a pet: its egg's price x the rarity's share x its tier's multiplier.
export function petSellValue(p) {
  const def = petDef(p.id)
  const egg = def.egg ? eggDef(def.egg) : null
  const share = PET.sell[RARITIES[def.rarity]?.level ?? 0] ?? 0.1
  return Math.max(1, Math.round((egg?.price ?? PET.sellLimited) * share * PET.tiers[p.tier ?? 0].mult))
}
export function sellPet(uid) {
  const p = state.pets.find((q) => q.uid === uid)
  if (!p) return 0
  const value = petSellValue(p)
  state.pets = state.pets.filter((q) => q.uid !== uid)
  state.petEq = state.petEq.filter((u) => u !== uid)
  addCash(value)
  emit('pets', null)
  return value
}
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

// A LIMITED gear piece's stock and countdown: { left, stock, endsIn (s) }, or null.
export function limitedStatus(def, t = Date.now()) {
  const L = def?.limited
  if (!L) return null
  const win = L.hours * 3600e3
  const start = Math.floor(t / win) * win
  const frac = (t - start) / win
  const left = Math.max(L.floor, Math.round(L.stock - (L.stock - L.floor) * Math.pow(frac, 0.6)))
  return { left, stock: L.stock, endsIn: (start + win - t) / 1000 }
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

// --- Reward prizes (rewards.js decides WHEN; this grants WHAT) ------------------------------------
// def: a REWARDS entry. Returns what it became: { kind, cash?, gear?, dupe?, egg?, stat?, mult?, time? }.
// An egg is only reported (petUi hatches it with the show).
export function grantReward(def) {
  if (def.kind === 'cash') {
    const cash = rewardCash(def)
    addCash(cash)
    return { kind: 'cash', cash }
  }
  // Free upgrade levels (Invite Friends): `levels` more of one upgrade, or of every upgrade (id 'all'),
  // never past the upgrade's max. Returns { kind: 'upgrade', ups: [{ id, name, levels (gained) }] }.
  if (def.kind === 'upgrade') {
    const ups = []
    for (const u of UPGRADES) {
      if (def.id !== 'all' && def.id !== u.id) continue
      const before = state.upgrades[u.id] ?? 0
      const after = Math.min(u.max, before + (def.levels ?? 1))
      if (after === before) continue
      state.upgrades[u.id] = after
      ups.push({ id: u.id, name: u.name, levels: after - before })
      emit('upgrade', u.id)
    }
    return { kind: 'upgrade', ups }
  }
  if (def.kind === 'boost') {
    addTimed(def.stat, def.mult, def.time * 60)
    return { kind: 'boost', stat: def.stat, mult: def.mult, time: def.time }
  }
  if (def.kind === 'gear') {
    const g = gearDef(def.gear)
    if (!g) return { kind: 'none' }
    if (state.gear.owned[g.id]) {
      const cash = Math.round(g.price * REWARDS.dupeGear)
      addCash(cash)
      return { kind: 'gear', gear: g.id, dupe: true, cash }
    }
    state.gear.owned[g.id] = true
    emit('gearOwned', g.id)
    return { kind: 'gear', gear: g.id }
  }
  if (def.kind === 'egg') return { kind: 'egg', egg: def.egg }
  return { kind: 'none' }
}
// The cash a prize pays right now: `scale` prizes (Invite Friends) grow with the buildings you
// finished, like the spin wheel's (x (1 + buildings * SPIN.scale)); the REWARDS ones are flat.
export const rewardCash = (def) => (def.scale ? Math.round(def.amount * (1 + state.buildings * SPIN.scale)) : def.amount)
// A prize that is a list (several things at once): grants each, returns the results in order.
export const grantRewards = (prize) => (Array.isArray(prize) ? prize : [prize]).map(grantReward)
// Dev helper (__game.give): cash / strength / speed straight in.
export function grant(reward) {
  if (reward.cash) addCash(reward.cash)
  if (reward.strength) addStat('strength', reward.strength)
  if (reward.speed) addStat('speed', reward.speed)
}

// --- Save / load ------------------------------------------------------------------------------
// The browser save (SAVE.key) is where guests and offline play keep their progress; signed-in
// players' progress also lives on the server (net.js sends snapshot() and hydrates from it).
const SAVED = ['cash', 'strength', 'speed', 'totalBlocks', 'buildings', 'bag', 'upgrades', 'passes', 'gymOwned', 'playtime', 'tower', 'rankSeen', 'pets', 'petEq', 'petSeen', 'petUid', 'petSlots', 'spins', 'gear', 'timed', 'rewards', 'freeSteps', 'goals']
const OWNER_KEY = `${SAVE.key}.owner`

// Merges a saved object (the browser save or a server doc) into `state`.
function apply(data) {
  for (const k of SAVED) {
    if (data[k] === undefined || data[k] === null) continue
    if (k === 'upgrades') Object.assign(state.upgrades, data.upgrades)
    else if (k === 'gear') state.gear = { owned: { ...data.gear?.owned }, on: data.gear?.owned?.[data.gear?.on] ? data.gear.on : null }
    else if (k === 'spins') Object.assign(state.spins, data.spins)
    else if (k === 'goals') state.goals = { ...state.goals, ...(typeof data.goals === 'object' ? data.goals : {}) }
    else if (k === 'rewards') state.rewards = { ...state.rewards, ...data.rewards, playClaimed: Array.isArray(data.rewards.playClaimed) ? [...data.rewards.playClaimed] : [] }
    else if (k === 'timed') state.timed = Array.isArray(data.timed) ? data.timed.filter((b) => b && b.left > 0 && b.mult > 1).map((b) => ({ stat: b.stat, mult: b.mult, left: b.left })) : []
    else state[k] = data[k]
  }
  state.rankSeen = Math.max(state.rankSeen, rankIndex())
  // Drop pets whose kind no longer exists and equipped uids that point nowhere.
  state.pets = state.pets.filter((p) => petDef(p.id))
  state.petEq = state.petEq.filter((u) => state.pets.some((p) => p.uid === u))
  state.petUid = Math.max(state.petUid, ...state.pets.map((p) => p.uid + 1))
  state.bag = Math.max(0, Math.min(state.bag, capacity()))
}
export function load() {
  try {
    const raw = localStorage.getItem(SAVE.key)
    if (!raw) return false
    apply(JSON.parse(raw))
    return true
  } catch {
    return false
  }
}
// The saved fields as a plain object (what net.js sends as `saveProgress`).
export function snapshot() {
  const out = {}
  for (const k of SAVED) out[k] = state[k]
  return out
}
// A server doc replaces the local progress (reset first, so nothing stale from this browser survives).
export function hydrate(doc) {
  if (!doc || typeof doc !== 'object') return false
  resetState()
  apply(doc)
  return true
}
// Back to a brand-new player (what an account with no save of its own starts from).
export function resetState() {
  Object.assign(state, fresh())
}
export function save() {
  try {
    localStorage.setItem(SAVE.key, JSON.stringify(snapshot()))
  } catch {
    // Storage blocked or full: this session only.
  }
}
// Whose progress the browser save holds: '' = a guest's (or not yet synced), else the account id.
// A different account that signs in on this browser never inherits it.
export function saveOwner() {
  try {
    return localStorage.getItem(OWNER_KEY) || ''
  } catch {
    return ''
  }
}
export function setSaveOwner(id) {
  try {
    if (id) localStorage.setItem(OWNER_KEY, id)
    else localStorage.removeItem(OWNER_KEY)
  } catch {
    // Storage blocked: ownership is not tracked this session.
  }
}
export function resetSave() {
  try {
    localStorage.removeItem(SAVE.key)
    localStorage.removeItem(OWNER_KEY)
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
