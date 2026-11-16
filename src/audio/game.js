import { COARSE_POINTER } from '../config.js'
import { A, now, ready, voice } from './core.js'
import { burst, modal, rnd, tone, vary } from './synth.js'

// Construction sounds, synthesised like the rest (audio/synth.js): stone blocks clacking
// into the bag, thudding onto the roof, the hoist motor and its arrival bell, gym clanks,
// the floor-complete fanfare and the cash register.

const STONE = [[1, 1, 0.05], [1.73, 0.55, 0.03], [2.61, 0.35, 0.02], [3.9, 0.18, 0.012]]
const STEEL = [[1, 1, 0.6], [2.76, 0.5, 0.35], [5.4, 0.25, 0.2], [8.9, 0.1, 0.12]]
const BELL = [[0.5, 0.3, 1.2], [1, 1, 1.1], [1.19, 0.45, 0.8], [1.5, 0.3, 0.7], [2, 0.42, 0.6], [2.66, 0.22, 0.4]]
const semi = (n) => Math.pow(2, n / 12)

const last = new Map()
function limit(name, ms) {
  const t = performance.now()
  if (t - (last.get(name) ?? -1e9) < ms) return false
  last.set(name, t)
  return true
}
const ok = (name, ms, seconds, pri = 1) => ready() && limit(name, ms) && voice(seconds, pri)

// A block landing in the bag: a short dry stone clack.
export function grab() {
  if (!ok('grab', 70, 0.12)) return
  const t = now()
  modal({ t, f: vary(620, 0.12), modes: STONE, gain: 0.16, strike: 0.08, pan: rnd(-0.2, 0.2) })
}

// A block set down on the roof: a heavier thud with grit.
export function place() {
  if (!ok('place', 90, 0.2)) return
  const t = now()
  tone({ t, f: vary(120, 0.1), f2: 60, d: 0.09, gain: 0.25 })
  modal({ t, f: vary(380, 0.1), modes: STONE, gain: 0.14, strike: 0.1 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 1800, d: 0.06, gain: 0.08 })
}

export function bagFull() {
  if (!ok('full', 600, 0.6, 2)) return
  const t = now()
  modal({ t, f: 880, modes: BELL, gain: 0.08, verb: 0.2 })
  modal({ t: t + 0.09, f: 1318, modes: BELL, gain: 0.08, verb: 0.2 })
}

// Hoist: motor whine up or down, then the arrival bell.
export function liftStart(up = true) {
  if (!ok('lift', 300, 1.6, 2)) return
  const t = now()
  burst({ t, type: 'lowpass', f: 300, q: 0.5, a: 0.02, d: 0.25, gain: 0.25 })
  modal({ t, f: 180, modes: STEEL, gain: 0.12, strike: 0.15 }) // gate clang
  tone({ t: t + 0.1, type: 'sawtooth', f: up ? 70 : 110, f2: up ? 130 : 60, glide: 1.2, a: 0.2, hold: 0.6, d: 0.6, gain: 0.05, lp: 500 })
}
export function liftArrive() {
  if (!ok('ding', 300, 1.6, 2)) return
  const t = now()
  modal({ t, f: 1318, modes: BELL, gain: 0.12, verb: 0.3 })
  modal({ t: t + 0.18, f: 1046, modes: BELL, gain: 0.12, verb: 0.3 })
  modal({ t: t + 0.35, f: 160, modes: STEEL, gain: 0.08, strike: 0.1 })
}

// One gym rep: the bar or the belt, plus a little grunt of effort.
export function rep(kind, mult = 1) {
  if (!ok('rep', 120, 0.4)) return
  const t = now()
  if (kind === 'strength') {
    modal({ t, f: vary(210, 0.05), modes: STEEL, gain: 0.12, strike: 0.12, decay: 0.4 })
    burst({ t, noise: 'pink', f: 600, q: 2, a: 0.02, d: 0.12, gain: 0.05 })
  } else {
    burst({ t, noise: 'brown', type: 'lowpass', f: 400, d: 0.08, gain: 0.18 })
    tone({ t, f: 90, f2: 60, d: 0.05, gain: 0.12 })
  }
  // Higher tiers sparkle a little.
  if (mult >= 10) modal({ t: t + 0.02, f: 2400 + Math.log10(mult) * 300, modes: [[1, 1, 0.3], [2.4, 0.3, 0.2]], gain: 0.03 })
}

// Floor complete: a rising arpeggio over a big thump and a cheer of bells.
export function floorDone(n = 1) {
  if (!ok('floor', 500, 2.4, 4)) return
  const t = now()
  tone({ t, f: 90, f2: 40, d: 0.35, gain: 0.4 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 900, d: 0.3, gain: 0.2 })
  const root = 523 * semi((n % 5) * 2)
  ;[0, 4, 7, 12].forEach((s, i) => modal({ t: t + 0.08 + i * 0.09, f: root * semi(s), modes: BELL, gain: 0.1, verb: 0.35 }))
  tone({ t: t + 0.44, type: 'triangle', f: root * 2, d: 0.6, gain: 0.06 })
}

// Building complete: a fanfare and fireworks pops.
export function buildingDone() {
  if (!ok('building', 2000, 4, 5)) return
  const t = now()
  const notes = [0, 4, 7, 12, 7, 12, 16, 19]
  notes.forEach((s, i) => {
    tone({ t: t + i * 0.13, type: 'square', f: 392 * semi(s), d: 0.22, gain: 0.04, lp: 2400 })
    modal({ t: t + i * 0.13, f: 784 * semi(s), modes: BELL, gain: 0.06, verb: 0.3 })
  })
  for (let i = 0; i < (COARSE_POINTER ? 4 : 8); i++) firework(t + 1.1 + i * 0.3)
}
export function firework(t) {
  if (!ready()) return
  t = t ?? now()
  tone({ t, f: rnd(500, 900), f2: rnd(1600, 2600), glide: 0.35, d: 0.35, gain: 0.03 })
  burst({ t: t + 0.36, noise: 'white', type: 'lowpass', f: 1800, d: 0.35, gain: 0.25 })
  burst({ t: t + 0.4, noise: 'white', type: 'highpass', f: 4000, d: 0.5, gain: 0.05 })
}

// Rank up: a sparkly ascending run.
export function rankUp() {
  if (!ok('rank', 1000, 2, 4)) return
  const t = now()
  ;[0, 2, 4, 7, 9, 12, 16].forEach((s, i) => modal({ t: t + i * 0.06, f: 880 * semi(s), modes: BELL, gain: 0.07, verb: 0.4 }))
}

// Cash register for a reward.
export function cash() {
  if (!ok('cash', 150, 0.8, 2)) return
  const t = now()
  modal({ t, f: 2093, modes: BELL, gain: 0.08 })
  modal({ t: t + 0.07, f: 2637, modes: BELL, gain: 0.07 })
}

// Ground rumble while the finished tower sinks.
export function rumble() {
  if (!ok('rumble', 3000, 3.5, 3)) return
  const t = now()
  burst({ t, noise: 'brown', type: 'lowpass', f: 160, q: 0.4, a: 0.4, hold: 2.2, d: 0.9, gain: 0.6 })
}

// --- Upgrades ------------------------------------------------------------------------------------
const COIN = [[1, 1, 0.5], [1.504, 0.6, 0.36], [2.24, 0.45, 0.26], [2.71, 0.3, 0.18], [3.47, 0.22, 0.12], [4.03, 0.12, 0.08]]
const GLOCK = [[1, 1, 1.2], [2.756, 0.32, 0.4], [5.404, 0.1, 0.16]]

// n coins clinking down, brightest first (the lucky drop and the Golden Touch buy).
function coinSpill(t, n, spread, gain) {
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(i / n, 1.25) * spread + rnd(0, 0.015)
    modal({ t: at, f: rnd(2400, 4300), modes: COIN, gain: gain * (1 - (i / n) * 0.65), beat: 7, strike: 0.2, decay: rnd(0.5, 1), pan: rnd(-0.35, 0.35), verb: 0.08 })
  }
}

// A lucky drop (Fortune Luck / Golden Touch): a bright "ching" and a spill of coins, a longer
// one the more coins dropped.
export function lucky(coins = 3) {
  if (!ok('lucky', 220, 1.2, 3)) return
  const t = now()
  modal({ t, f: 2093, modes: BELL, gain: 0.1, verb: 0.25 })
  modal({ t: t + 0.07, f: 3136, modes: BELL, gain: 0.08, verb: 0.25 })
  coinSpill(t + 0.05, Math.min(COARSE_POINTER ? 3 : 5, 2 + Math.round(coins / 4)), 0.25 + Math.min(0.4, coins * 0.03), 0.07)
}

// Coin Combo climbing: one stepping tick per quarter of the bar (step 1..4), a fanfare at the top.
export function comboStep(step = 1, max = false) {
  if (!ok('combo', 150, 0.8, 2)) return
  const t = now()
  const f = 880 * semi((step - 1) * 3)
  modal({ t, f, modes: GLOCK, gain: 0.09, strike: 0.1, verb: 0.2 })
  modal({ t: t + 0.07, f: f * 1.5, modes: GLOCK, gain: 0.06, verb: 0.2 })
  if (max) {
    ;[0, 4, 7, 12, 16].forEach((s, i) => modal({ t: t + 0.12 + i * 0.055, f: 1046 * semi(s), modes: BELL, gain: 0.07, verb: 0.35 }))
    coinSpill(t + 0.15, COARSE_POINTER ? 3 : 5, 0.4, 0.06)
  }
}
// The combo ran out.
export function comboLost() {
  if (!ok('comboLost', 400, 0.5)) return
  const t = now()
  tone({ t, f: 520, f2: 240, glide: 0.25, d: 0.25, gain: 0.07, lp: 1800 })
}

// Wide Trowel: the extra blocks it lays scraping and clacking down beside the first.
export function placeWide(mult = 1.5) {
  if (mult <= 1 || !ok('wide', 120, 0.25)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 2200, f2: 900, q: 1.2, a: 0.01, d: 0.12, gain: 0.07 }) // trowel scrape
  const n = Math.min(3, Math.ceil(mult) - 1)
  for (let i = 0; i < n; i++) modal({ t: t + 0.04 + i * 0.045, f: vary(480 + i * 90, 0.08), modes: STONE, gain: 0.1, strike: 0.08, pan: rnd(-0.25, 0.25) })
}

// Lightning Hands: a quick electric crackle riding on the placing.
export function handsZap() {
  if (!ok('hands', 260, 0.3)) return
  const t = now()
  for (let i = 0; i < 5; i++) burst({ t: t + rnd(0, 0.1), type: 'highpass', f: rnd(3000, 6500), q: 0.8, a: 0.0004, d: rnd(0.004, 0.012), gain: rnd(0.05, 0.1), pan: rnd(-0.4, 0.4) })
  tone({ t, type: 'sawtooth', f: 900, f2: 2200, glide: 0.07, d: 0.08, gain: 0.025, lp: 3500 })
}

// Buying an upgrade: a level-up chime with a flavour for what it is (the shared buy sound's
// till drawer is not used here, the button press already clicked).
export function upgrade(id) {
  if (!ok('upgrade', 120, 1.4, 3)) return
  const t = now()
  const chime = (base) => {
    modal({ t: t + 0.02, f: base, modes: BELL, gain: 0.1, verb: 0.3 })
    modal({ t: t + 0.12, f: base * semi(7), modes: BELL, gain: 0.1, verb: 0.3 })
    modal({ t: t + 0.22, f: base * semi(12), modes: BELL, gain: 0.09, verb: 0.35 })
  }
  switch (id) {
    case 'grab': // blocks clacking into a bag
      for (let i = 0; i < 4; i++) modal({ t: t + i * 0.05, f: vary(560 + i * 60, 0.08), modes: STONE, gain: 0.14, strike: 0.08 })
      chime(880)
      break
    case 'build': // hammer taps
      for (let i = 0; i < 3; i++) {
        tone({ t: t + i * 0.07, f: 150, f2: 70, d: 0.07, gain: 0.2 })
        modal({ t: t + i * 0.07, f: 420 + i * 40, modes: STEEL, gain: 0.07, strike: 0.15 })
      }
      chime(988)
      break
    case 'range': // a sonar ping going out
      tone({ t, f: 700, f2: 1400, glide: 0.18, d: 0.3, gain: 0.08 })
      modal({ t: t + 0.12, f: 1400, modes: GLOCK, gain: 0.07, verb: 0.45 })
      chime(784)
      break
    case 'lift': // gate clang and a motor sweep
      modal({ t, f: 180, modes: STEEL, gain: 0.12, strike: 0.15 })
      tone({ t: t + 0.05, type: 'sawtooth', f: 90, f2: 220, glide: 0.35, d: 0.3, gain: 0.04, lp: 600 })
      chime(740)
      break
    case 'golden': // a golden ring over a coin spill
      modal({ t, f: 1568, modes: BELL, gain: 0.12, verb: 0.4 })
      coinSpill(t + 0.05, COARSE_POINTER ? 3 : 5, 0.35, 0.08)
      chime(1046)
      break
    case 'fortune': // a sparkling lucky run
      ;[0, 4, 7, 12, 16, 19].forEach((s, i) => modal({ t: t + i * 0.05, f: 1046 * semi(s), modes: GLOCK, gain: 0.07, verb: 0.4 }))
      break
    case 'combo': // stepping coin clinks
      ;[0, 3, 5, 8].forEach((s, i) => modal({ t: t + i * 0.07, f: 1318 * semi(s), modes: COIN, gain: 0.1, beat: 7, strike: 0.2, verb: 0.1 }))
      chime(1175)
      break
    case 'trowel': // scrape and a stone thud
      burst({ t, noise: 'pink', type: 'bandpass', f: 2400, f2: 800, q: 1.2, a: 0.01, d: 0.18, gain: 0.09 })
      tone({ t: t + 0.12, f: 120, f2: 60, d: 0.1, gain: 0.25 })
      modal({ t: t + 0.12, f: 380, modes: STONE, gain: 0.14, strike: 0.1 })
      chime(932)
      break
    case 'hands': // electric crackle and a rising whoosh
      for (let i = 0; i < 9; i++) burst({ t: t + rnd(0, 0.2), type: 'highpass', f: rnd(3000, 7000), q: 0.8, a: 0.0004, d: rnd(0.004, 0.014), gain: rnd(0.06, 0.12), pan: rnd(-0.5, 0.5) })
      tone({ t, type: 'sawtooth', f: 300, f2: 1800, glide: 0.25, d: 0.2, gain: 0.04, lp: 3000 })
      chime(1109)
      break
    default:
      chime(880)
  }
}
