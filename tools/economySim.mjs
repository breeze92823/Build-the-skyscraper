// Economy Monte Carlo for Build the Skyscraper: how long players of three kinds take to max every upgrade,
// purchases over time, gaps between purchases, milestones. It plays the economy from src/config.js (pit trips,
// gym, gear, passes, pets + eggs, spins, daily / playtime / offline rewards, events, Goals, floors sized to the
// room's bags, income-scaled floor / building bonuses). A model, not the game: re-run it before changing prices
// or multipliers. Usage (from Build-the-skyscraper/): node tools/economySim.mjs [runs=12] [casual|average|grinder]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// config.js reads import.meta.env (Vite): load a copy with it stubbed.
const tmp = path.join(os.tmpdir(), `skyscraper-config-${process.pid}.mjs`)
fs.writeFileSync(tmp, fs.readFileSync(path.join(here, '../src/config.js'), 'utf8').replace(/import\.meta\.env/g, '({})').replace(/typeof matchMedia === 'function' &&/, 'false &&'))
const C = { ...(await import(pathToFileURL(tmp).href)) }
fs.rmSync(tmp, { force: true })
// The sim's names for the config's numbers.
{
  C.FLOORS = { ...C.BUILDING_SCALE, floorSec: C.TOWER.floorIncome, buildingSec: C.TOWER.buildingIncome }
  const G = C.GOALS
  // A goal takes ~GOALS.minutes of play plus a little.
  C.GOALS = { every: G.minutes * 60 + 20, rewardSec: G.rewardSec, perDay: G.perDay, afterCap: G.afterCap, welcomeMult: G.welcome.mult, topUp: G.topUp, chestEvery: G.chestEvery, chest: { mult: G.chest.mult, time: G.chest.time } }
  C.PET_GYM = 0 // pets boost cash only
}
const { UPGRADES, STATS, GYM, SHOP, ROBOT_GEAR, ROBOT, PETS, EGGS, PET, RANKS, RANK_CASH_BONUS, TOWER, BUILDINGS, NEXT_BUILDING, INSIDE, ELEVATOR, LUCKY, COMBO, REWARDS, EVENTS, SPIN, PET_PASSES, OFFLINE, FLOORS, GOALS } = C

const PROFILES = {
  casual: { eff: 0.6, reps: 1.8, tripOverhead: 1.35, session: 30, label: 'Casual  (60% focus, 30 min/day)' },
  average: { eff: 0.75, reps: 2.2, tripOverhead: 1.25, session: 60, label: 'Average (75% focus, 1 h/day)' },
  grinder: { eff: 0.92, reps: 3, tripOverhead: 1.1, session: 180, label: 'Grinder (92% focus, 3 h/day)' },
}
const PIT_TO_CAGE = 87
const ROOF_WALK = 12
const rarityAvg = (() => { let s = 0, w = 0; for (const b of BUILDINGS) { s += b.chance * NEXT_BUILDING.rarities[b.rarity].bonus; w += b.chance } return s / w })()
const floorsOf = (n) => Math.min(FLOORS.floorsMax, FLOORS.floorsBase + n * FLOORS.floorsPer)
const tripsOf = (n) => Math.min(FLOORS.tripsMax, FLOORS.tripsBase + n * FLOORS.tripsPer)
const minNeed = (n, f) => Math.round(FLOORS.minBase * Math.pow(FLOORS.minGrowth, n) * (1 + f * FLOORS.floorGrowth))

function run(profileName, seed, opt = {}) {
  const P = { ...PROFILES[profileName], ...opt }
  let rnd = seed >>> 0
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296)
  const s = {
    cash: 0, strength: STATS.startStrength, speed: STATS.startSpeed, totalBlocks: 0, buildings: 0,
    up: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])), passes: {}, gymOwned: {}, gearOwned: {}, gearOn: null,
    pets: [], petSlots: 0, timed: [], spins: SPIN.start, gspins: 0,
  }
  const tw = { n: 0, floor: 0, frac: 0, down: 0 }
  let t = 0, dayPlay = 0, day = 0, playClaimed = new Set(), dailyStreak = 0
  let income = 0 // EMA of $/s
  let goalT = 0, goalsToday = 0, goalsDone = 0, eggBudget = 0
  const milestones = {}
  const mark = (k) => { if (milestones[k] == null) milestones[k] = t }
  const buys = [] // times of purchases (for motivation gaps)
  const curve = [] // [t, $/s]

  const U = (id) => UPGRADES.find((u) => u.id === id)
  const gear = () => ROBOT_GEAR.find((g) => g.id === s.gearOn) ?? null
  const rankIdx = () => { let i = 0; while (i + 1 < RANKS.length && s.totalBlocks >= RANKS[i + 1].at) i++; return i }
  const petPower = (p) => PETS.find((d) => d.id === p.id).bonus * PET.tiers[p.tier].mult
  const slots = () => PET.slots + (s.passes.slots ? 2 : 0) + s.petSlots
  const petBonus = (list = s.pets, sl = slots()) => list.map(petPower).sort((a, b) => b - a).slice(0, sl).reduce((a, b) => a + b, 0)
  const timedMul = (stat) => s.timed.reduce((m, b) => (b.stat === stat && b.left > 0 && b.mult > m ? b.mult : m), 1)
  const evAt = (time) => {
    const cyc = Math.floor(time / (EVENTS.length + EVENTS.gap))
    if (time - cyc * (EVENTS.length + EVENTS.gap) < EVENTS.gap) return null
    return EVENTS.list[((cyc * 2654435761 + seed) >>> 0) % EVENTS.list.length]
  }
  const cashMul = (o = {}) => (1 + rankIdx() * RANK_CASH_BONUS) * ((o.passes ?? s.passes).cash2 ? 2 : 1) * (o.ev?.cash ?? 1) * (1 + (o.pb ?? petBonus())) * timedMul('cash')
  const gymBase = (kind) => (kind === 'strength' ? (s.passes.str2 ? 2 : 1) : s.passes.spd2 ? 2 : 1) * (1 + petBonus() * (C.PET_GYM ?? 1))
  const gymMul = (kind, o = {}) => gymBase(kind) * (o.ev?.gym ?? 1) * timedMul(kind)
  const bestTier = () => { let b = 0; GYM.tiers.forEach((tr, i) => { if ((tr.need != null && s.buildings >= tr.need) || s.gymOwned[i]) b = Math.max(b, tr.mult) }); return b }

  function trip(o = {}) {
    const up = o.up ?? s.up
    const g = o.gear !== undefined ? o.gear : gear()
    const passes = o.passes ?? s.passes
    const str = o.strength ?? s.strength
    const spd = o.speed ?? s.speed
    const ev = o.ev ?? null
    const val = (id) => U(id).value(up[id])
    const cap = Math.floor(STATS.capacity(str) * (passes.bag2 ? 1.5 : 1)) + (g?.capacity ?? 0)
    const evB = ev?.build ?? 1
    const grab = Math.max(STATS.minRate, (cap / STATS.fillTime) * val('grab') * evB)
    const build = Math.max(STATS.minRate, (cap / STATS.buildTime) * val('build') * val('hands') * evB * (g?.build ?? 1))
    const walk = Math.min(ROBOT.maxWalk, STATS.walkSpeed(spd) + (g?.walk ?? 0) / 3.6) * STATS.sprintMul
    const height = (tw.floor + 0.5) * TOWER.floorHeight
    const ride = ELEVATOR.board + ELEVATOR.doors * 2 + height / val('lift')
    const fillT = cap / grab, buildT = cap / build
    const time = (fillT + buildT + (2 * PIT_TO_CAGE + 2 * ROOF_WALK) / walk + 2 * ride) * P.tripOverhead
    const placed = cap * (g?.blocks ?? 1) * val('trowel')
    const avgT = buildT <= COMBO.ramp ? buildT / (2 * COMBO.ramp) : (COMBO.ramp / 2 + (buildT - COMBO.ramp)) / buildT
    const combo = 1 + (val('combo') - 1) * avgT
    const cm = cashMul({ passes, ev, pb: o.pb })
    const lucky = placed * (val('fortune') / 100) * val('golden') * LUCKY.coinValue * cm
    return { time, placed, cash: placed * cm * combo * (C.CASH_PER_BLOCK ?? 1) + lucky * (C.CASH_PER_BLOCK ?? 1), cap }
  }
  const rate = (o) => { const r = trip(o); return r.cash / r.time }

  function gymValue(kind) {
    const add = P.reps * bestTier() * gymMul(kind) * 600
    return Math.max(0, rate(kind === 'strength' ? { strength: s.strength + add } : { speed: s.speed + add }) - rate())
  }
  function eggGain(e) {
    const ps = PETS.filter((p) => p.egg === e.id)
    const before = petBonus()
    let sum = 0
    for (let k = 0; k < ps.length; k++) sum += (e.odds[k] / 100) * (petBonus([...s.pets, { id: ps[k].id, tier: 0 }]) - before)
    return rate({ pb: before + sum }) - rate()
  }
  function candidates() {
    const list = []
    const base = rate()
    for (const u of UPGRADES) {
      if (s.up[u.id] >= u.max) continue
      list.push({ kind: 'up', id: u.id, price: u.price(s.up[u.id]), gain: rate({ up: { ...s.up, [u.id]: s.up[u.id] + 1 } }) - base })
    }
    for (const g of ROBOT_GEAR) {
      if (s.gearOwned[g.id] || g.spot === 'limited') continue
      const gain = Math.max(0, rate({ gear: g }) - base)
      if (gain > 0) list.push({ kind: 'gear', id: g.id, price: g.price, gain })
    }
    for (const p of SHOP.passes) {
      if (s.passes[p.id]) continue
      let gain = rate({ passes: { ...s.passes, [p.id]: true } }) - base
      if (p.id === 'str2') gain = Math.max(gain, gymValue('strength') * 0.8)
      if (p.id === 'spd2') gain = Math.max(gain, gymValue('speed') * 0.5)
      list.push({ kind: 'pass', id: p.id, price: p.price, gain })
    }
    GYM.tiers.forEach((tr, i) => {
      if (tr.price == null || s.gymOwned[i] || tr.mult <= bestTier()) return
      list.push({ kind: 'gym', id: i, price: tr.price, gain: gymValue('strength') * (tr.mult / bestTier() - 1) })
    })
    for (const e of EGGS) if (e.price <= eggBudget) list.push({ kind: 'egg', id: e.id, price: e.price, gain: eggGain(e) * 1.5 })
    const sp = PET.extraSlots[s.petSlots]
    if (sp != null) list.push({ kind: 'slot', price: sp, gain: rate({ pb: petBonus(s.pets, slots() + 1) }) - base })
    if (!s.passes.slots) list.push({ kind: 'pass', id: 'slots', price: PET_PASSES.find((x) => x.id === 'slots').price, gain: rate({ pb: petBonus(s.pets, slots() + 2) }) - base })
    return list
  }
  function hatch(e) {
    const ps = PETS.filter((p) => p.egg === e.id)
    let r = rand() * 100, k = 0
    while (k < ps.length - 1 && r >= e.odds[k]) { r -= e.odds[k]; k++ }
    addPet(ps[k].id, 0)
  }
  function addPet(id, tier) {
    s.pets.push({ id, tier })
    for (let changed = true; changed;) {
      changed = false
      const groups = {}
      for (const p of s.pets) (groups[p.id + ':' + p.tier] ??= []).push(p)
      for (const [k, g] of Object.entries(groups)) {
        const tr = +k.split(':')[1]
        if (g.length >= PET.merge && tr < PET.tiers.length - 1) {
          const gone = new Set(g.slice(0, PET.merge))
          s.pets = s.pets.filter((p) => !gone.has(p))
          s.pets.push({ id: g[0].id, tier: tr + 1 })
          changed = true
        }
      }
    }
    if (s.pets.length > PET.storage) { s.pets.sort((a, b) => petPower(b) - petPower(a)); s.pets.length = PET.storage }
  }
  function buy(c) {
    s.cash -= c.price
    if (c.kind !== 'egg') buys.push(t)
    if (c.kind === 'up') { s.up[c.id]++; mark('first_upgrade'); if (s.up[c.id] >= U(c.id).max) mark('max_' + c.id) }
    else if (c.kind === 'gear') { s.gearOwned[c.id] = true; s.gearOn = c.id; mark('gear_' + c.id) }
    else if (c.kind === 'pass') s.passes[c.id] = true
    else if (c.kind === 'gym') { s.gymOwned[c.id] = true; mark('gym_' + GYM.tiers[c.id].label) }
    else if (c.kind === 'egg') { eggBudget -= c.price; hatch(EGGS.find((e) => e.id === c.id)); tick(PET.hatchTime) }
    else if (c.kind === 'slot') s.petSlots++
  }
  // The cheapest next upgrade / gear the player is saving for (what a goal's "precise" top-up aims at).
  function nextTarget() {
    const list = candidates().filter((c) => c.gain > 0 && c.kind !== 'egg').sort((a, b) => b.gain / b.price - a.gain / a.price)
    return list[0] ?? null
  }
  function shop() {
    for (let guard = 0; guard < 500; guard++) {
      let list = candidates().filter((c) => c.gain > 0)
      if (!list.length) break
      // A real player saves only for what is within ~30 min of income; otherwise the cheapest useful thing.
      const near = list.filter((c) => c.price <= s.cash + Math.max(income, 1) * 1800)
      list = near.length ? near : [list.sort((a, b) => a.price - b.price)[0]]
      list.sort((a, b) => b.gain / b.price - a.gain / a.price)
      const best = list[0]
      const pick = best.price <= s.cash ? best : list.find((c) => c.price <= s.cash && c.gain / c.price >= 0.5 * (best.gain / best.price))
      if (!pick) break
      buy(pick)
    }
    // Upgrades with no modelled income value (Build Range, late Grab / Build levels): bought when affordable,
    // cheapest first, keeping ~10 min of income for the next useful buy.
    for (let g = 0; g < 200; g++) {
      const open = UPGRADES.filter((u) => s.up[u.id] < u.max).sort((a, b) => a.price(s.up[a.id]) - b.price(s.up[b.id]))[0]
      if (!open || open.price(s.up[open.id]) > s.cash - income * 600) break
      buy({ kind: 'up', id: open.id, price: open.price(s.up[open.id]) })
    }
  }
  const allMaxed = () => UPGRADES.every((u) => s.up[u.id] >= u.max)

  function tick(sec) {
    t += sec
    dayPlay += sec
    const top = {}
    for (const b of s.timed) if (!top[b.stat] || b.mult > top[b.stat].mult) top[b.stat] = b
    for (const b of Object.values(top)) b.left -= sec
    s.timed = s.timed.filter((b) => b.left > 0)
    for (const pr of REWARDS.play) if (!playClaimed.has(pr.at) && dayPlay >= pr.at * 60) { playClaimed.add(pr.at); grant(pr) }
    // Goals: one finishes every GOALS.every s of play; full reward for the first perDay each day.
    if (GOALS) {
      goalT += sec
      while (goalT >= GOALS.every) {
        goalT -= GOALS.every
        const full = goalsToday < GOALS.perDay
        goalsToday++
        goalsDone++
        let reward = income * GOALS.rewardSec * (full ? 1 : GOALS.afterCap) * (goalsToday === 1 && day > 0 ? GOALS.welcomeMult : 1)
        // Precise: tops up to the next purchase when it is within reach.
        const tg = full ? nextTarget() : null
        if (tg && tg.price > s.cash && tg.price - s.cash <= reward * GOALS.topUp) reward = Math.max(reward, tg.price - s.cash)
        s.cash += reward
        if (goalsDone % GOALS.chestEvery === 0) s.timed.push({ stat: 'cash', mult: GOALS.chest.mult, left: GOALS.chest.time })
      }
    }
    if (dayPlay >= P.session * 60) newDay()
  }
  function newDay() {
    // Offline training for the time away (OFFLINE.perMinute x best pad x passes/pets).
    const away = Math.min(OFFLINE.max, 86400 - P.session * 60) / 60
    const g = away * OFFLINE.perMinute * bestTier()
    s.strength += g * gymBase('strength')
    s.speed += g * gymBase('speed')
    day++
    dayPlay = 0
    goalsToday = 0
    playClaimed = new Set()
    grant(REWARDS.daily[dailyStreak % REWARDS.daily.length])
    dailyStreak++
  }
  function grant(r) {
    if (r.kind === 'cash') s.cash += r.amount
    else if (r.kind === 'boost') s.timed.push({ stat: r.stat, mult: r.mult, left: r.time * 60 })
    else if (r.kind === 'gear') {
      const g = ROBOT_GEAR.find((x) => x.id === r.gear)
      if (s.gearOwned[g.id]) s.cash += g.price * REWARDS.dupeGear
      else { s.gearOwned[g.id] = true; if (rate({ gear: g }) > rate()) s.gearOn = g.id }
    } else if (r.kind === 'egg') hatch(EGGS.find((e) => e.id === r.egg))
  }
  function spin() {
    const golden = s.gspins > 0
    golden ? s.gspins-- : s.spins--
    const wheel = golden ? SPIN.golden : SPIN.normal
    let r = rand() * 100, i = 0
    while (i < wheel.length - 1 && r >= wheel[i].chance) { r -= wheel[i].chance; i++ }
    const w = wheel[i]
    const scale = 1 + s.buildings * SPIN.scale
    if (w.kind === 'cash') s.cash += w.amount * scale
    else if (w.kind === 'gym') { if (s.gymOwned[w.tier] || (GYM.tiers[w.tier].need != null && s.buildings >= GYM.tiers[w.tier].need)) s.cash += SPIN.dupeCash * scale; else { s.gymOwned[w.tier] = true; mark('gym_' + GYM.tiers[w.tier].label + '(spin)') } }
    else if (w.kind === 'pet') addPet(w.pet, w.gold ?? 0)
    else if (w.kind === 'golden') s.gspins++
  }

  grant(REWARDS.daily[0]); dailyStreak = 1
  grant(REWARDS.free)
  const LIMIT = (P.limitH ?? 400) * 3600
  let nextCurve = 0
  while (!allMaxed() && t < LIMIT) {
    while (s.spins + s.gspins > 0) spin()
    shop()
    if (allMaxed()) break
    const ev = evAt(t)
    if (tw.down > 0) {
      const g = (INSIDE.base * INSIDE.mult * bestTier() / INSIDE.every) * tw.down
      s.strength += g * gymMul('strength', { ev })
      s.speed += g * gymMul('speed', { ev })
      tick(tw.down / P.eff)
      tw.down = 0
      continue
    }
    const r0 = rate({ ev })
    const gain = P.reps * bestTier() * gymMul('strength', { ev }) * 60
    const sGain = P.reps * bestTier() * gymMul('speed', { ev }) * 60
    const dStr = (rate({ ev, strength: s.strength + gain }) - r0) * 900 - r0 * 60
    const dSpd = (rate({ ev, speed: s.speed + sGain }) - r0) * 900 - r0 * 60
    if (t > 300 && Math.max(dStr, dSpd) > 0) {
      if (dStr >= dSpd) s.strength += gain; else s.speed += sGain
      tick(60 / P.eff)
      continue
    }
    const tr = trip({ ev })
    // The floor is sized to the room's bags: tripsOf(n) of them (the room = players like you), at least minNeed.
    const need = Math.max(minNeed(tw.n, tw.floor), tripsOf(tw.n) * tr.placed * (1 + tw.floor * FLOORS.floorGrowth))
    const share = tr.placed / need // of a floor, from this trip of yours (the others add the same per trip)
    let cash = tr.cash
    s.totalBlocks += tr.placed
    tw.frac += 1 / tripsOf(tw.n) * Math.min(1, tripsOf(tw.n) * share)
    if (tw.frac >= 1 - 1e-9) {
      tw.frac = 0
      tw.floor++
      mark('first_floor')
      cash += income * FLOORS.floorSec + tw.floor * TOWER.floorBonus * cashMul({ ev })
      if (tw.floor >= floorsOf(tw.n)) {
        s.buildings++
        mark('building_' + s.buildings)
        cash += (income * FLOORS.buildingSec + (tw.n + 1) * TOWER.buildingBonus * cashMul({ ev })) * rarityAvg
        s.spins += SPIN.perBuilding
        tw.n++; tw.floor = 0
        tw.down = INSIDE.time + TOWER.sinkTime + NEXT_BUILDING.spin + NEXT_BUILDING.hold
      }
    }
    s.cash += cash
    eggBudget += cash * (P.eggShare ?? 0.3)
    const dt = tr.time / P.eff
    const a = 1 - Math.exp(-dt / 120)
    income += (tr.cash / dt - income) * a
    tick(dt)
    if (t >= nextCurve) { curve.push([t, tr.cash / tr.time, s.strength, tr.placed, s.buildings]); nextCurve += +(process.env.CURVE ?? 1800) }
  }
  const upPct = UPGRADES.reduce((a, u) => a + s.up[u.id] / u.max, 0) / UPGRADES.length
  return { t, done: allMaxed(), milestones, s, tw, buys, curve, upPct, day }
}

// ---------------------------------------------------------------- report
const fmt$ = (n) => (n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n) + '')
const h = (sec) => (sec < 3600 ? (sec / 60).toFixed(0) + 'm' : (sec / 3600).toFixed(1) + 'h')
const RUNS = +(process.argv[2] ?? 20)
const only = process.argv[3]
const costs = UPGRADES.map((u) => { let c = 0; for (let l = 0; l < u.max; l++) c += u.price(l); return c })
console.log('Max-all upgrades cost: $' + fmt$(costs.reduce((a, b) => a + b, 0)), ' per upgrade:', UPGRADES.map((u, i) => `${u.id} ${fmt$(costs[i])}`).join(', '))
for (const name of Object.keys(PROFILES)) {
  if (only && only !== name) continue
  const rs = []
  for (let i = 0; i < RUNS; i++) rs.push(run(name, 12345 + i * 7919))
  const med = (arr) => { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
  const ts = rs.map((r) => r.t).sort((a, b) => a - b)
  const P = PROFILES[name]
  console.log(`\n${P.label}: maxed ${Math.round((rs.filter((r) => r.done).length / RUNS) * 100)}%  median ${h(med(ts))} (p10 ${h(ts[Math.floor(RUNS * 0.1)])}, p90 ${h(ts[Math.floor(RUNS * 0.9)])}) = ~${Math.ceil(med(ts) / 60 / P.session)} days; upgrades ${Math.round(med(rs.map((r) => r.upPct)) * 100)}%`)
  const ms = {}
  for (const k of new Set(rs.flatMap((r) => Object.keys(r.milestones)))) {
    const v = rs.map((r) => r.milestones[k]).filter((x) => x != null)
    ms[k] = { m: med(v), p: v.length / RUNS }
  }
  console.log('   ' + Object.entries(ms).sort((a, b) => a[1].m - b[1].m).filter(([k]) => !/^building_(\d+)$/.test(k) || [1, 3, 8, 15, 25, 50, 100].includes(+k.split('_')[1])).map(([k, v]) => `${k}@${h(v.m)}${v.p < 1 ? `(${Math.round(v.p * 100)}%)` : ''}`).join(', '))
  const r = rs[0]
  console.log('   curve (t: $/s, str, per-trip, bld): ' + r.curve.slice(0, 40).map((c) => `${h(c[0])}: ${fmt$(c[1])}/s ${fmt$(c[2])} ${fmt$(c[3])} b${c[4]}`).join(' | '))
  // Gaps between purchases by stage (motivation): median and max gap in each window.
  const win = [[0, 3600], [3600, 5 * 3600], [5 * 3600, 15 * 3600], [15 * 3600, 30 * 3600], [30 * 3600, 60 * 3600], [60 * 3600, 400 * 3600]]
  const gaps = win.map(([a, b]) => {
    const g = []
    for (const rr of rs) { const bs = rr.buys.filter((x) => x >= a && x < b); for (let i = 1; i < bs.length; i++) g.push(bs[i] - bs[i - 1]) }
    if (!g.length) return `${h(a)}-${h(b)}: -`
    g.sort((x, y) => x - y)
    return `${h(a)}-${h(b)}: med ${h(g[Math.floor(g.length / 2)])} p90 ${h(g[Math.floor(g.length * 0.9)])}`
  })
  console.log('   gaps between buys: ' + gaps.join(' | '))
  const early = [60, 300, 600, 900, 1800, 3600].map((T) => `${h(T)}:${med(rs.map((r) => r.buys.filter((x) => x <= T).length))}`)
  console.log('   purchases by: ' + early.join(' '))
}
