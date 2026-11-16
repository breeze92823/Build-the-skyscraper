import { COARSE_POINTER } from '../config.js'
import { A, now, ready, voice } from './core.js'
import { burst, crinkle, modal, rnd, tone, vary } from './synth.js'

// Robot Gear sounds, synthesised like the rest: servo whine (a filtered sawtooth gliding
// with a band of noise for the gear teeth), armour plates locking on (struck steel + a
// pneumatic hiss), the power-up chord, the transform ratchet, the Titan ground slam and
// four continuous loops on the engine bus (truck diesel, jet roar, boot thrusters, dropship
// rotors) whose level and pitch the game sets every frame.

const STEEL = [[1, 1, 0.5], [2.76, 0.5, 0.3], [5.4, 0.25, 0.18], [8.9, 0.1, 0.1]]
const PLATE = [[1, 1, 0.22], [1.58, 0.6, 0.16], [2.31, 0.4, 0.1], [3.7, 0.2, 0.07]]
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
function buzz(pattern) {
  if (!COARSE_POINTER) return
  try {
    navigator.vibrate?.(pattern)
  } catch {
    // Not allowed in this frame.
  }
}

// A servo motor: up = rising whine.
export function servo(up = true, len = 0.35, t) {
  if (!ok('servo', 60, len + 0.1)) return
  t = t ?? now()
  const f0 = vary(up ? 180 : 420, 0.08)
  const f1 = up ? f0 * 2.4 : f0 * 0.45
  tone({ t, type: 'sawtooth', f: f0, f2: f1, glide: len, a: 0.02, hold: len * 0.6, d: len * 0.4, gain: 0.035, lp: 2200 })
  burst({ t, noise: 'white', f: up ? 1400 : 2600, f2: up ? 3200 : 1100, q: 4, a: 0.02, hold: len * 0.5, d: len * 0.5, gain: 0.05 })
}

// A pneumatic hiss (seals locking).
export function hiss(t, gain = 0.07) {
  if (!ready()) return
  burst({ t: t ?? now(), noise: 'white', type: 'highpass', f: 3200, a: 0.006, d: 0.32, gain })
}

// One armour piece locking into place; i rises the pitch through a suit-up.
export function lockIn(i = 0) {
  if (!ok('lock', 45, 0.4)) return
  const t = now()
  modal({ t, f: vary(300 * semi(Math.min(i, 14) * 0.7), 0.04), modes: PLATE, gain: 0.15, strike: 0.25, beat: 6 })
  tone({ t, f: 140, f2: 60, d: 0.07, gain: 0.18 })
  burst({ t: t + 0.01, f: 5200, q: 1.5, d: 0.012, gain: 0.12 }) // latch click
  if (i % 3 === 0) hiss(t + 0.04, 0.04)
}

// Suit-up begins: a beam hum rising under a servo.
export function suitStart() {
  if (!ok('suitStart', 400, 1.6, 3)) return
  const t = now()
  tone({ t, type: 'triangle', f: 110, f2: 440, glide: 1.2, a: 0.2, hold: 0.8, d: 0.5, gain: 0.08, lp: 1800 })
  tone({ t, type: 'sine', f: 55, f2: 110, glide: 1.2, a: 0.2, hold: 0.8, d: 0.5, gain: 0.16 })
  burst({ t, noise: 'pink', f: 400, f2: 2400, q: 1.2, a: 0.4, hold: 0.6, d: 0.4, gain: 0.08 })
  servo(true, 0.5, t + 0.05)
}

// Fully suited: a power chord with a bright shimmer.
export function powerUp() {
  if (!ok('powerUp', 600, 2.2, 4)) return
  const t = now()
  tone({ t, f: 80, f2: 45, d: 0.35, gain: 0.35 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 1200, d: 0.25, gain: 0.18 })
  ;[0, 7, 12, 16, 19].forEach((s, i) => {
    tone({ t: t + i * 0.035, type: 'sawtooth', f: 196 * semi(s), d: 0.9, a: 0.01, gain: 0.022, lp: 2600 })
    modal({ t: t + 0.12 + i * 0.05, f: 784 * semi(s), modes: BELL, gain: 0.05, verb: 0.35 })
  })
  tone({ t: t + 0.1, f: 1200, f2: 3600, glide: 0.5, d: 0.5, gain: 0.025 })
  buzz([30, 30, 60])
}

// Taking the gear off: a falling servo and a release hiss.
export function powerDown() {
  if (!ok('powerDown', 300, 1, 2)) return
  const t = now()
  servo(false, 0.45, t)
  hiss(t + 0.3, 0.08)
  tone({ t: t + 0.05, f: 300, f2: 90, glide: 0.5, d: 0.5, gain: 0.05, type: 'triangle' })
}

// Robot <-> vehicle, timed to the piece-by-piece animation (`dur` s): a crouch with a deep
// servo, a long run of ratchets and plate clanks rising (folding out) or falling (folding in)
// over two motors, pneumatic hisses, then the final lock-down clunk.
export function transform(toVehicle = true, dur = 1.1) {
  if (!ok('transform', 300, dur + 0.6, 4)) return
  const t = now()
  tone({ t, type: 'sawtooth', f: toVehicle ? 70 : 140, f2: toVehicle ? 140 : 60, glide: dur * 0.8, a: 0.05, hold: dur * 0.5, d: dur * 0.3, gain: 0.05, lp: 700 })
  servo(toVehicle, dur * 0.35, t + 0.02)
  servo(!toVehicle, dur * 0.3, t + dur * 0.45)
  const n = 22
  for (let i = 0; i < n; i++) {
    const k = toVehicle ? i : n - 1 - i
    const at = t + 0.1 + (i / n) * dur * 0.8 + rnd(0, 0.012)
    if (i % 3 === 0) modal({ t: at, f: vary(260 + k * 22, 0.06), modes: PLATE, gain: 0.1, strike: 0.25, beat: 6 })
    else modal({ t: at, f: vary(900 + k * 60, 0.05), modes: PLATE, gain: 0.06, strike: 0.2 })
    burst({ t: at, f: 4200 + k * 120, q: 2, d: 0.01, gain: 0.05 })
    if (i % 7 === 3) hiss(at + 0.02, 0.05)
  }
  const end = t + dur * 0.95
  modal({ t: end, f: 150, modes: STEEL, gain: 0.2, strike: 0.25, beat: 4, verb: 0.2 })
  tone({ t: end, f: 110, f2: 42, d: 0.25, gain: 0.32 })
  burst({ t: end, noise: 'brown', type: 'lowpass', f: 500, d: 0.2, gain: 0.25 })
  hiss(end + 0.04, 0.07)
  buzz([20, 30, 20, 30, 50])
}

// The vehicle comes alive: a diesel starter crank and rev, or a jet spooling up.
export function engineStart(kind = 'truck') {
  if (!ok('engineStart', 500, 1.6, 3)) return
  const t = now()
  if (kind === 'jet') {
    tone({ t, f: 400, f2: 2600, glide: 1.1, a: 0.2, hold: 0.4, d: 0.5, gain: 0.035 })
    burst({ t, noise: 'pink', f: 300, f2: 2200, q: 0.7, a: 0.5, hold: 0.3, d: 0.5, gain: 0.2, sweep: 1.0 })
    return
  }
  for (let i = 0; i < 4; i++) {
    tone({ t: t + i * 0.09, type: 'square', f: 28, f2: 34, d: 0.07, gain: 0.08, lp: 300 })
    burst({ t: t + i * 0.09, noise: 'brown', type: 'lowpass', f: 300, d: 0.06, gain: 0.12 })
  }
  tone({ t: t + 0.38, type: 'sawtooth', f: 40, f2: 110, glide: 0.3, a: 0.03, hold: 0.15, d: 0.4, gain: 0.09, lp: 700 })
  burst({ t: t + 0.38, noise: 'brown', type: 'lowpass', f: 600, a: 0.03, d: 0.5, gain: 0.2 })
  if (kind === 'truck') horn(t + 0.85, 0.35)
}

// Air horn (two detuned saw reeds).
export function horn(t, len = 0.5) {
  if (!ready()) return
  t = t ?? now()
  for (const f of [233, 277]) tone({ t, type: 'sawtooth', f, a: 0.02, hold: len, d: 0.12, gain: 0.025, lp: 1800 })
}

// Shifting up: the engine note dips with a clunk of the gearbox.
export function gearShift() {
  if (!ok('shift', 500, 0.4)) return
  const t = now()
  modal({ t, f: 320, modes: PLATE, gain: 0.05, strike: 0.1 })
  tone({ t, type: 'sawtooth', f: 120, f2: 70, glide: 0.12, d: 0.15, gain: 0.04, lp: 500 })
  hiss(t + 0.05, 0.03)
}

// Tyres screeching through a hard turn.
export function skid(level = 1) {
  if (!ok('skid', 260, 0.5)) return
  const t = now()
  burst({ t, noise: 'white', f: vary(2400, 0.1), q: 6, a: 0.04, hold: 0.15, d: 0.2, gain: 0.05 * level })
  tone({ t, f: vary(1150, 0.05), f2: 1050, a: 0.04, hold: 0.12, d: 0.18, gain: 0.012 * level })
}

// Springs bottoming out: a vehicle (or a giant robot) landing hard.
export function suspension(size = 1) {
  if (!ok('susp', 200, 0.5)) return
  const t = now()
  tone({ t, f: 70, f2: 35, d: 0.2, gain: 0.25 * Math.min(1.5, size) })
  modal({ t: t + 0.01, f: 210, modes: STEEL, gain: 0.08, strike: 0.15 })
  burst({ t: t + 0.03, noise: 'white', f: 3000, q: 4, d: 0.12, gain: 0.03 })
}

// A gauntlet zap while working (an electric crackle).
export function zap() {
  if (!ok('zap', 140, 0.25)) return
  const t = now()
  tone({ t, type: 'square', f: vary(1400, 0.2), f2: 300, glide: 0.08, d: 0.08, gain: 0.025, lp: 4000 })
  burst({ t, noise: 'white', type: 'highpass', f: 3000, d: 0.06, gain: 0.05 })
}

// A little robot chirp now and then (the suit's computer).
export function chirp() {
  if (!ok('chirp', 2500, 0.4)) return
  const t = now()
  const n = 2 + Math.floor(Math.random() * 3)
  for (let i = 0; i < n; i++) tone({ t: t + i * 0.07, type: 'square', f: vary(1300 + Math.random() * 900, 0.05), d: 0.05, gain: 0.012, lp: 3500 })
}

// Thrusters kicking in mid-air (a burst under the steady roar).
export function boost() {
  if (!ok('boost', 300, 0.6)) return
  const t = now()
  burst({ t, noise: 'pink', f: 500, f2: 1800, q: 0.8, a: 0.03, d: 0.35, gain: 0.16 })
  tone({ t, f: 90, f2: 60, d: 0.12, gain: 0.15 })
}

// Titan Armor: the dropship arrives (a doppler whoosh).
export function shipIn() {
  if (!ok('shipIn', 1000, 2.4, 3)) return
  const t = now()
  burst({ t, noise: 'pink', f: 300, f2: 1400, q: 0.8, a: 1.2, d: 0.9, gain: 0.25, sweep: 1.6 })
  tone({ t, f: 90, f2: 160, glide: 1.6, a: 1.0, d: 0.8, gain: 0.08, type: 'triangle' })
}
// The pod released: a falling whistle.
export function podFall() {
  if (!ok('podFall', 800, 1.4, 3)) return
  const t = now()
  tone({ t, f: 2400, f2: 500, glide: 1.0, a: 0.05, d: 1.0, gain: 0.04 })
  burst({ t, noise: 'white', f: 3000, f2: 900, q: 3, a: 0.1, d: 0.9, gain: 0.06 })
}
// The pod hits the ground: a huge thud, shattered rock and ringing metal.
export function slam() {
  if (!ok('slam', 800, 2.4, 5)) return
  const t = now()
  tone({ t, f: 75, f2: 28, d: 0.7, gain: 0.6 })
  burst({ t, noise: 'brown', type: 'lowpass', f: 500, f2: 120, a: 0.004, d: 0.9, gain: 0.7 })
  burst({ t, noise: 'white', type: 'bandpass', f: 1800, q: 0.7, a: 0.002, d: 0.35, gain: 0.25 })
  modal({ t: t + 0.01, f: 140, modes: STEEL, gain: 0.25, strike: 0.3, beat: 5, verb: 0.4 })
  for (let i = 0; i < (COARSE_POINTER ? 4 : 9); i++) modal({ t: t + 0.08 + rnd(0, 0.6), f: rnd(700, 2400), modes: PLATE, gain: 0.04, strike: 0.1 })
  buzz([60, 40, 90])
}

// A heavy mech footstep: a deep thud, a clank of the foot plate and a short servo.
export function stomp(size = 1.4) {
  if (!ok('stomp', 140, 0.5)) return
  const t = now()
  const k = Math.min(1.6, size)
  tone({ t, f: vary(85 / k, 0.06), f2: 38 / k, d: 0.22, gain: 0.22 * k })
  burst({ t, noise: 'brown', type: 'lowpass', f: 420, d: 0.16, gain: 0.22 * k })
  modal({ t: t + 0.01, f: vary(240 / k, 0.06), modes: PLATE, gain: 0.07, strike: 0.12 })
  if (Math.random() < 0.4) servo(Math.random() < 0.5, 0.18, t + 0.05)
}
// A robotic claw planting: a light metal tap with a hydraulic tick.
export function clawStep() {
  if (!ok('claw', 110, 0.2)) return
  const t = now()
  modal({ t, f: vary(900, 0.1), modes: PLATE, gain: 0.05, strike: 0.15 })
  burst({ t: t + 0.02, noise: 'white', type: 'highpass', f: 4200, d: 0.05, gain: 0.03 })
}
// Welding while the robotic arms build: a crackling hiss.
export function weld() {
  if (!ok('weld', 120, 0.25)) return
  const t = now()
  burst({ t, noise: 'white', type: 'highpass', f: vary(3800, 0.2), a: 0.004, d: 0.12, gain: 0.05 })
  burst({ t: t + rnd(0.02, 0.06), f: vary(6000, 0.2), q: 3, d: 0.02, gain: 0.05 })
}
// Flying gear lifting off: a rising whoosh with a thump.
export function liftoff() {
  if (!ok('liftoff', 400, 0.9, 2)) return
  const t = now()
  tone({ t, f: 70, f2: 40, d: 0.2, gain: 0.25 })
  burst({ t, noise: 'pink', f: 400, f2: 2600, q: 0.9, a: 0.04, d: 0.5, gain: 0.22 })
  hiss(t + 0.02, 0.06)
}

// --- Climbing (Spider Arms) -------------------------------------------------------------------------
const GLASS = [[1, 1, 0.3], [2.32, 0.5, 0.2], [4.25, 0.28, 0.12], [6.63, 0.14, 0.08]]
// Latching onto the wall: claws bite in, a heavy clamp and a hiss.
export function latch() {
  if (!ok('latch', 400, 0.8, 3)) return
  const t = now()
  for (let i = 0; i < 4; i++) modal({ t: t + i * 0.03, f: vary(1800, 0.1), modes: GLASS, gain: 0.05, strike: 0.2 })
  modal({ t: t + 0.08, f: 190, modes: STEEL, gain: 0.18, strike: 0.25, beat: 5 })
  tone({ t: t + 0.08, f: 95, f2: 45, d: 0.2, gain: 0.25 })
  hiss(t + 0.12, 0.07)
  servo(true, 0.25, t)
  buzz([25, 20, 25])
}
// One claw biting the glass facade: a hard tick, a short glassy ring and a hydraulic tick.
export function clawGlass(pan = 0) {
  if (!ok('clawGlass', 70, 0.35)) return
  const t = now()
  modal({ t, f: vary(2200, 0.12), modes: GLASS, gain: 0.07, strike: 0.25, pan })
  burst({ t, f: 6000, q: 2, d: 0.01, gain: 0.07, pan })
  tone({ t: t + 0.02, f: 160, f2: 90, d: 0.05, gain: 0.08 })
}
// Letting go / kicking off the wall: claws spring open with a hiss and a whoosh.
export function release() {
  if (!ok('release', 300, 0.7, 2)) return
  const t = now()
  for (let i = 0; i < 3; i++) modal({ t: t + i * 0.025, f: vary(1300, 0.1), modes: PLATE, gain: 0.05, strike: 0.15 })
  hiss(t + 0.02, 0.08)
  burst({ t: t + 0.05, noise: 'pink', f: 500, f2: 2000, q: 0.8, a: 0.03, d: 0.3, gain: 0.14 })
}
// Hauling over the roof edge: a straining servo, a heavy clank, a little chime of arrival.
export function mantle() {
  if (!ok('mantle', 600, 1.4, 3)) return
  const t = now()
  tone({ t, type: 'sawtooth', f: 90, f2: 200, glide: 0.5, a: 0.05, hold: 0.25, d: 0.3, gain: 0.05, lp: 900 })
  servo(true, 0.4, t + 0.05)
  modal({ t: t + 0.55, f: 170, modes: STEEL, gain: 0.2, strike: 0.25 })
  tone({ t: t + 0.55, f: 100, f2: 45, d: 0.2, gain: 0.28 })
  ;[0, 4, 7].forEach((st, i) => modal({ t: t + 0.7 + i * 0.07, f: 1046 * semi(st), modes: BELL, gain: 0.05, verb: 0.3 }))
}

// vol (0..1) scales a one-shot: other players' parachutes and landings play quieter with distance.
// --- Parachute -----------------------------------------------------------------------------------
// The rip: the pack's pin clicks out with a hiss, the pilot chute whips away, the canopy unfurls
// in a long rustle of nylon and snaps open with a deep FWUMP (timed to parachute.js: `snap` s in).
export function chuteDeploy(snap = 0.5, vol = 1) {
  if (!ok('chuteDeploy', 600, snap + 1.2, 4)) return
  const t = now()
  burst({ t, f: 5200, q: 1.5, d: 0.012, gain: 0.14 * vol }) // the pin
  modal({ t, f: 620, modes: PLATE, gain: 0.06 * vol, strike: 0.15 })
  hiss(t + 0.01, 0.06 * vol)
  burst({ t: t + 0.04, noise: 'pink', f: 700, f2: 2800, q: 0.9, a: 0.02, d: 0.28, gain: 0.2 * vol }) // pilot chute whip
  crinkle({ t: t + 0.12, n: 70, dur: snap, gain: 0.1 * vol, f0: 900, f1: 5200, width: 0.7 }) // nylon unfurling
  burst({ t: t + 0.15, noise: 'pink', type: 'lowpass', f: 900, f2: 2200, a: snap * 0.7, d: 0.2, gain: 0.12 * vol })
  const s = t + snap
  tone({ t: s, f: 92, f2: 38, d: 0.34, gain: 0.42 * vol })
  burst({ t: s, noise: 'brown', type: 'lowpass', f: 700, f2: 160, a: 0.004, d: 0.4, gain: 0.5 * vol })
  burst({ t: s, noise: 'pink', f: 380, q: 0.8, a: 0.003, d: 0.22, gain: 0.32 * vol, verb: 0.2 })
  crinkle({ t: s, n: 26, dur: 0.18, gain: 0.16 * vol, f0: 1500, f1: 6500, width: 0.8 }) // the cells slapping full
  burst({ t: s + 0.05, noise: 'white', type: 'highpass', f: 2600, d: 0.3, gain: 0.05 * vol })
  if (vol >= 1) buzz([18, 30, 70])
}

// Toggles pulled for the landing flare: a quick creak and the canopy biting the air.
export function chuteFlare(vol = 1) {
  if (!ok('chuteFlare', 800, 0.6, 2)) return
  const t = now()
  burst({ t, noise: 'pink', f: 500, f2: 260, q: 0.9, a: 0.05, d: 0.35, gain: 0.16 * vol })
  crinkle({ t, n: 14, dur: 0.25, gain: 0.07 * vol, f0: 1200, f1: 4000, width: 0.5 })
}

// Touchdown: boots hit the dirt, then the canopy sighs out its air and folds down in a rustle.
export function chuteLand(vol = 1) {
  if (!ok('chuteLand', 600, 1.6, 3)) return
  const t = now()
  tone({ t, f: 85, f2: 40, d: 0.2, gain: 0.3 * vol })
  burst({ t, noise: 'brown', type: 'lowpass', f: 480, d: 0.22, gain: 0.32 * vol })
  burst({ t: t + 0.12, noise: 'pink', type: 'lowpass', f: 1400, f2: 300, a: 0.06, d: 0.9, gain: 0.16 * vol }) // air leaving the cells
  crinkle({ t: t + 0.15, n: 55, dur: 0.95, gain: 0.08 * vol, f0: 700, f1: 3800, width: 0.8 })
  burst({ t: t + 0.95, noise: 'brown', type: 'lowpass', f: 380, d: 0.25, gain: 0.14 * vol }) // the canopy lands in a heap
}

// --- Robot Gear superhero landing ------------------------------------------------------------------
// The hit: a ground-shaking boom, the crack of the ground giving way, the armour ringing, the leg
// rams compressing (a falling hydraulic groan + a blast of hiss) and rubble pattering down after.
// p = 0..1 how hard.
export function impactLand(p = 0.5, vol = 1) {
  if (!ok('impactLand', 500, 2.2, 5)) return
  const t = now()
  tone({ t, f: 78, f2: 26, d: 0.65 + p * 0.3, gain: (0.45 + p * 0.2) * vol })
  burst({ t, noise: 'brown', type: 'lowpass', f: 600, f2: 110, a: 0.003, d: 0.8 + p * 0.4, gain: (0.55 + p * 0.2) * vol })
  burst({ t, noise: 'white', type: 'bandpass', f: 2200, q: 0.8, a: 0.001, d: 0.22, gain: (0.22 + p * 0.1) * vol }) // the ground cracking
  modal({ t: t + 0.005, f: 130, modes: STEEL, gain: 0.22 * vol, strike: 0.3, beat: 5, verb: 0.35 })
  modal({ t: t + 0.02, f: vary(420, 0.05), modes: PLATE, gain: 0.08 * vol, strike: 0.15 })
  tone({ t: t + 0.03, type: 'sawtooth', f: 240, f2: 70, glide: 0.3, a: 0.01, hold: 0.08, d: 0.3, gain: 0.06 * vol, lp: 900 }) // rams compressing
  hiss(t + 0.05, 0.14 * vol)
  const n = COARSE_POINTER ? 4 : 8 + Math.round(p * 6)
  for (let i = 0; i < n; i++) {
    const at = t + 0.25 + rnd(0, 0.7)
    burst({ t: at, noise: 'brown', type: 'lowpass', f: rnd(500, 1100), d: rnd(0.03, 0.08), gain: rnd(0.06, 0.14) * vol, pan: rnd(-0.6, 0.6) })
    if (i % 2) burst({ t: at, f: rnd(2500, 5000), q: 2, d: 0.01, gain: 0.04 * vol, pan: rnd(-0.6, 0.6) })
  }
  if (vol >= 1) buzz([80, 40, 120])
}

// Standing back up out of the crouch: the rams extend (rising servo), vent the rest of their pressure
// and the joints lock with a clunk.
export function impactRise(vol = 1) {
  if (!ok('impactRise', 400, 0.9, 2)) return
  const t = now()
  if (vol > 0.6) servo(true, 0.38, t)
  burst({ t: t + 0.02, noise: 'white', type: 'highpass', f: 2800, a: 0.02, d: 0.45, gain: 0.08 * vol })
  modal({ t: t + 0.36, f: 210, modes: STEEL, gain: 0.12 * vol, strike: 0.2, beat: 4 })
  tone({ t: t + 0.36, f: 110, f2: 55, d: 0.12, gain: 0.16 * vol })
}

// --- Loops ----------------------------------------------------------------------------------------
// kind: 'diesel' | 'jet' | 'thrust' | 'rotor'. set(level 0..1, pitch 0..1) every frame.
const loops = new Map()
function noiseSrc(kind) {
  const s = A.ctx.createBufferSource()
  s.buffer = A.noise[kind] ?? A.noise.white
  s.loop = true
  s.start(A.ctx.currentTime, Math.random() * (s.buffer.duration - 0.1))
  return s
}
function makeLoop(kind) {
  const ctx = A.ctx
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(A.engine ?? A.sfx)
  const nodes = []
  const params = {}
  if (kind === 'diesel') {
    const o1 = ctx.createOscillator()
    o1.type = 'sawtooth'
    const o2 = ctx.createOscillator()
    o2.type = 'square'
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 380
    const g1 = ctx.createGain()
    g1.gain.value = 0.18
    o1.connect(lp)
    o2.connect(g1).connect(lp)
    lp.connect(out)
    const n = noiseSrc('brown')
    const nl = ctx.createBiquadFilter()
    nl.type = 'lowpass'
    nl.frequency.value = 300
    const ng = ctx.createGain()
    ng.gain.value = 0.6
    n.connect(nl).connect(ng).connect(out)
    o1.start()
    o2.start()
    nodes.push(o1, o2, n)
    params.apply = (p, t) => {
      const f = 34 + p * 46
      o1.frequency.setTargetAtTime(f, t, 0.08)
      o2.frequency.setTargetAtTime(f * 0.5, t, 0.08)
      lp.frequency.setTargetAtTime(300 + p * 700, t, 0.1)
    }
    params.gain = 0.22
  } else if (kind === 'jet' || kind === 'thrust') {
    const n = noiseSrc(kind === 'jet' ? 'pink' : 'white')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.6
    n.connect(bp).connect(out)
    nodes.push(n)
    let whine = null
    if (kind === 'jet') {
      whine = ctx.createOscillator()
      const wg = ctx.createGain()
      wg.gain.value = 0.03
      whine.connect(wg).connect(out)
      whine.start()
      nodes.push(whine)
    }
    params.apply = (p, t) => {
      bp.frequency.setTargetAtTime((kind === 'jet' ? 500 : 900) + p * 1500, t, 0.1)
      whine?.frequency.setTargetAtTime(1500 + p * 1400, t, 0.15)
    }
    params.gain = kind === 'jet' ? 0.5 : 0.22
  } else if (kind === 'hydraulic') {
    // Spider legs working: a geared whine over a hiss of hydraulic fluid.
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    const og = ctx.createGain()
    og.gain.value = 0.35
    o.connect(og).connect(lp).connect(out)
    const n = noiseSrc('white')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 2500
    bp.Q.value = 2
    const ng = ctx.createGain()
    ng.gain.value = 0.25
    n.connect(bp).connect(ng).connect(out)
    o.start()
    nodes.push(o, n)
    params.apply = (p, t) => {
      o.frequency.setTargetAtTime(85 + p * 120, t, 0.08)
      lp.frequency.setTargetAtTime(500 + p * 900, t, 0.1)
    }
    params.gain = 0.3
  } else if (kind === 'wind') {
    // High up: gusty wind (pink noise through a slowly wandering band).
    const n = noiseSrc('pink')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.5
    bp.frequency.value = 500
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.17
    const depth = ctx.createGain()
    depth.gain.value = 250
    lfo.connect(depth).connect(bp.frequency)
    n.connect(bp).connect(out)
    lfo.start()
    nodes.push(n, lfo)
    params.apply = (p, t) => bp.Q.setTargetAtTime(0.5 + p * 1.5, t, 0.5)
    params.gain = 0.35
  } else if (kind === 'canopy') {
    // Under the canopy: air rushing past the lines and the nylon fluttering (noise through a band,
    // its level shaken by two LFOs: a fast flap and a slow breath).
    const n = noiseSrc('pink')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.value = 650
    const am = ctx.createGain()
    am.gain.value = 0.6
    const flap = ctx.createOscillator()
    flap.type = 'triangle'
    flap.frequency.value = 7
    const fd = ctx.createGain()
    fd.gain.value = 0.3
    const breath = ctx.createOscillator()
    breath.frequency.value = 0.6
    const bd = ctx.createGain()
    bd.gain.value = 0.18
    flap.connect(fd).connect(am.gain)
    breath.connect(bd).connect(am.gain)
    n.connect(bp).connect(am).connect(out)
    const r = noiseSrc('brown')
    const rl = ctx.createBiquadFilter()
    rl.type = 'lowpass'
    rl.frequency.value = 260
    const rg = ctx.createGain()
    rg.gain.value = 0.5
    r.connect(rl).connect(rg).connect(out)
    flap.start()
    breath.start()
    nodes.push(n, r, flap, breath)
    params.apply = (p, t) => {
      bp.frequency.setTargetAtTime(450 + p * 900, t, 0.2)
      flap.frequency.setTargetAtTime(5 + p * 9, t, 0.2)
    }
    params.gain = 0.32
  } else if (kind === 'rush') {
    // Free fall: a roaring rush of air that climbs in pitch with the fall speed.
    const n = noiseSrc('white')
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.7
    n.connect(bp).connect(out)
    const r = noiseSrc('brown')
    const rl = ctx.createBiquadFilter()
    rl.type = 'lowpass'
    rl.frequency.value = 320
    const rg = ctx.createGain()
    rg.gain.value = 1.2
    r.connect(rl).connect(rg).connect(out)
    nodes.push(n, r)
    params.apply = (p, t) => {
      bp.frequency.setTargetAtTime(500 + p * 2400, t, 0.1)
      rl.frequency.setTargetAtTime(220 + p * 380, t, 0.1)
    }
    params.gain = 0.4
  } else {
    // Rotor: low noise pulsed by a ~13 Hz LFO (blade slap).
    const n = noiseSrc('brown')
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    const am = ctx.createGain()
    am.gain.value = 0.5
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 13
    const depth = ctx.createGain()
    depth.gain.value = 0.5
    lfo.connect(depth).connect(am.gain)
    n.connect(lp).connect(am).connect(out)
    lfo.start()
    nodes.push(n, lfo)
    params.apply = (p, t) => lfo.frequency.setTargetAtTime(11 + p * 6, t, 0.2)
    params.gain = 0.8
  }
  return { out, nodes, params, level: 0, quiet: 0 }
}

export function loop(kind, level, pitch = 0.5, dt = 0.016) {
  if (!ready()) return
  let l = loops.get(kind)
  if (!l) {
    if (level <= 0.001) return
    l = makeLoop(kind)
    loops.set(kind, l)
  }
  const t = A.ctx.currentTime
  l.out.gain.setTargetAtTime(level * l.params.gain, t, 0.08)
  l.params.apply(pitch, t)
  // Silent for a while: stop it (it is rebuilt the next time it sounds).
  l.quiet = level <= 0.001 ? l.quiet + dt : 0
  if (l.quiet > 2) {
    for (const n of l.nodes) {
      try {
        n.stop()
      } catch {
        // Already stopped.
      }
    }
    l.out.disconnect()
    loops.delete(kind)
  }
}
