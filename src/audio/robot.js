import { COARSE_POINTER } from '../config.js'
import { A, now, ready, voice } from './core.js'
import { burst, modal, rnd, tone, vary } from './synth.js'

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

// Robot <-> vehicle: a run of ratchet clicks over two servo glides, a heavy clunk at the end.
export function transform(toVehicle = true) {
  if (!ok('transform', 300, 1.2, 4)) return
  const t = now()
  const n = 9
  for (let i = 0; i < n; i++) {
    const k = toVehicle ? i : n - 1 - i
    const at = t + i * 0.045 + rnd(0, 0.01)
    modal({ t: at, f: vary(900 + k * 90, 0.05), modes: PLATE, gain: 0.08, strike: 0.2 })
    burst({ t: at, f: 4200 + k * 200, q: 2, d: 0.01, gain: 0.06 })
  }
  servo(toVehicle, 0.3, t)
  servo(!toVehicle, 0.25, t + 0.2)
  const end = t + n * 0.045 + 0.05
  modal({ t: end, f: 170, modes: STEEL, gain: 0.16, strike: 0.2 })
  tone({ t: end, f: 110, f2: 45, d: 0.2, gain: 0.3 })
  hiss(end + 0.03, 0.06)
  if (toVehicle) tone({ t: end + 0.08, type: 'sawtooth', f: 55, f2: 120, glide: 0.35, a: 0.05, d: 0.45, gain: 0.07, lp: 600 }) // engine rev
  buzz([20, 20, 40])
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
