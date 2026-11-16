import { COARSE_POINTER } from '../config.js'
import { now, ready, setDucked, voice } from './core.js'
import { burst, crinkle, modal, rnd, tone, vary } from './synth.js'
import { cheer } from './finale.js'

// The Next Building reel (nextBuilding.js), synthesised like the rest (audio/synth.js): a
// whoosh and boom as the screen dims, a ratchet click for every building that rolls past the
// arrows (they slow down with the reel), a riser over the last stretch, a thunk when it
// locks, then the reveal: an impact, a bell chord that climbs with the rarity, confetti
// poppers, and for the rare ones a brass fanfare and a cheering crowd.

const BELL = [[0.5, 0.3, 1.2], [1, 1, 1.1], [1.19, 0.45, 0.8], [1.5, 0.3, 0.7], [2, 0.42, 0.6], [2.66, 0.22, 0.4]]
const CLICK = [[1, 1, 0.03], [2.43, 0.45, 0.016], [4.1, 0.2, 0.008]]
const GLOCK = [[1, 1, 1.2], [2.756, 0.32, 0.4], [5.404, 0.1, 0.16]]
const semi = (n) => Math.pow(2, n / 12)
const LITE = COARSE_POINTER
const go = (seconds, pri = 3) => ready() && voice(seconds, pri)

// The screen dims and the reel slides in.
export function open() {
  setDucked(true)
  if (!go(1.6, 4)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 280, f2: 2400, q: 0.9, a: 0.3, d: 0.3, gain: 0.2, verb: 0.2 })
  tone({ t: t + 0.32, f: 85, f2: 38, d: 0.45, gain: 0.4 })
  ;[0, 7, 12].forEach((n, i) => modal({ t: t + 0.34 + i * 0.05, f: 659 * semi(n), modes: BELL, gain: 0.05, verb: 0.4 }))
}

// One building passing the arrows; `slow` 0 (flying) .. 1 (crawling) makes it louder and lower.
let lastTick = 0
export function tick(slow = 0) {
  const ms = performance.now()
  if (ms - lastTick < (LITE ? 55 : 38)) return
  lastTick = ms
  if (!go(0.12, 1)) return
  const t = now()
  modal({ t, f: vary(1900 - slow * 500, 0.03), modes: CLICK, gain: 0.07 + slow * 0.06, strike: 0.25, pan: rnd(-0.1, 0.1) })
  if (slow > 0.45) tone({ t, f: 240, f2: 140, d: 0.04, gain: 0.05 + slow * 0.05 })
}

// Tension over the last stretch of the spin (call it `dur` s before land()).
export function riser(dur = 1.6) {
  if (!go(dur + 0.2, 3)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 500, f2: 3200, q: 1.4, a: dur * 0.9, d: 0.12, gain: 0.08 })
  tone({ t, type: 'sawtooth', f: 110, f2: 220, glide: dur, a: dur * 0.8, d: 0.15, gain: 0.03, lp: 900 })
}

// The reel locks on the pick.
export function land() {
  if (!go(0.5, 4)) return
  const t = now()
  tone({ t, f: 140, f2: 60, d: 0.14, gain: 0.32 })
  modal({ t, f: 520, modes: CLICK, gain: 0.16, strike: 0.3 })
}

// Confetti popper: the crack, the body, paper fluttering down.
function popper(t, pan) {
  burst({ t, type: 'highpass', f: 2800, q: 0.6, a: 0.0005, d: 0.012, gain: 0.4, pan, verb: 0.2 })
  burst({ t, f: 900, q: 0.9, a: 0.001, d: 0.05, gain: 0.2, pan })
  tone({ t, f: 170, f2: 60, d: 0.06, gain: 0.16, pan })
  crinkle({ t: t + 0.05, n: LITE ? 12 : 24, dur: 0.9, gain: 0.04, f0: 2500, f1: 8000, width: 0.9 })
}

// Brass-ish fanfare (detuned saws through a lowpass).
function fanfare(t, root) {
  const notes = [[0, 0.12], [0, 0.09], [0, 0.09], [7, 0.3], [4, 0.15], [7, 0.15], [12, 0.65]]
  let at = t
  for (const [n, len] of notes) {
    const f = root * semi(n)
    for (const det of LITE ? [0] : [-7, 7]) tone({ t: at, type: 'sawtooth', f, detune: det, a: 0.02, hold: len * 0.6, d: len * 0.7, gain: 0.032, lp: 2200, verb: 0.25 })
    tone({ t: at, type: 'triangle', f: f / 2, a: 0.02, hold: len * 0.5, d: len * 0.6, gain: 0.045 })
    at += len
  }
}

// The rarity pops: `level` 0 (common) .. 5 (mythic).
export function reveal(level = 0) {
  if (!go(level >= 4 ? 3.4 : 2.2, 6)) return
  const t = now()
  tone({ t, f: 92, f2: 34, d: 0.55 + level * 0.05, gain: 0.5 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 1300, d: 0.35, gain: 0.25 })
  burst({ t, noise: 'white', type: 'highpass', f: 4500, a: 0.002, d: 1 + level * 0.25, gain: 0.08 + level * 0.015, verb: 0.35 })
  const root = [392, 440, 494, 523, 587, 659][Math.min(5, level)]
  const chord = level >= 3 ? [0, 4, 7, 12, 16, 19] : [0, 4, 7, 12]
  chord.forEach((n, i) => modal({ t: t + 0.04 + i * 0.065, f: root * semi(n), modes: BELL, gain: 0.08, verb: 0.45 }))
  popper(t + 0.06, -0.55)
  popper(t + 0.12, 0.55)
  if (level >= 2) [0, 4, 7, 12, 16, 19, 24].slice(0, 3 + level).forEach((n, i) => modal({ t: t + 0.45 + i * 0.05, f: 1046 * semi(n), modes: GLOCK, gain: 0.05, verb: 0.35 }))
  if (level >= 4) fanfare(t + 0.4, root / 1.5)
  if (level >= 3) cheer(2 + level * 0.3, 0.5 + (level - 3) * 0.25)
}

// The screen clears.
export function close() {
  setDucked(false)
  if (!go(0.8, 2)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 2200, f2: 500, q: 0.9, a: 0.04, d: 0.35, gain: 0.1 })
}
