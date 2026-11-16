import { COARSE_POINTER } from '../config.js'
import { now, ready, setDucked, voice } from './core.js'
import { burst, modal, rnd, tone } from './synth.js'

// The Top Builders finale (finale.js), synthesised like the rest (audio/synth.js): a sting as
// the letterbox closes in, a whoosh on every camera cut, a snare roll building up to each
// reveal, a hit + cymbal + chime per rank (#1 adds a brass fanfare), a crowd cheering and
// clapping, ticks over the last seconds of the countdown, and a rewind sweep when skipped.
// The world (ambience + engines) steps back for the whole show.

const BELL = [[0.5, 0.3, 1.2], [1, 1, 1.1], [1.19, 0.45, 0.8], [1.5, 0.3, 0.7], [2, 0.42, 0.6], [2.66, 0.22, 0.4]]
const CYMBAL = [[1, 0.5, 1.6], [1.48, 0.4, 1.3], [2.13, 0.35, 1.1], [2.97, 0.25, 0.9], [4.11, 0.2, 0.7]]
const semi = (n) => Math.pow(2, n / 12)
const LITE = COARSE_POINTER // weak phones: fewer nodes per sound
const go = (seconds, pri = 3) => ready() && voice(seconds, pri)

// World audio steps back while everyone watches.
export function duck(on) {
  setDucked(on)
}

// The letterbox closes in: a low swell into a bright sting.
export function intro() {
  if (!go(2.4, 5)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 300, f2: 2600, q: 0.8, a: 0.55, d: 0.35, gain: 0.22, verb: 0.2 })
  tone({ t, type: 'sawtooth', f: 55, f2: 110, glide: 0.8, a: 0.4, hold: 0.3, d: 0.6, gain: 0.07, lp: 700 })
  const s = t + 0.75
  tone({ t: s, f: 70, f2: 38, d: 0.5, gain: 0.45 })
  ;[0, 7, 12, 16].forEach((n, i) => modal({ t: s + i * 0.02, f: 523 * semi(n), modes: BELL, gain: 0.08, verb: 0.45 }))
  burst({ t: s, noise: 'white', type: 'highpass', f: 5000, d: 1.2, gain: 0.08, verb: 0.3 })
}

// A camera cut: air rushing past.
export function whoosh(big = false) {
  if (!go(0.8)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: big ? 400 : 700, f2: big ? 3200 : 2400, q: 1.1, a: 0.12, d: 0.32, gain: big ? 0.26 : 0.18, sweep: 0.4, pan: rnd(-0.3, 0.3) })
  burst({ t: t + 0.05, noise: 'white', type: 'highpass', f: 3500, a: 0.1, d: 0.2, gain: 0.04 })
}

// A snare roll over `dur` s that swells into the reveal (call it `dur` s before reveal()).
export function drumroll(dur = 1.2, rank = 3) {
  if (!go(dur + 0.3, 3)) return
  const t = now()
  const rate = LITE ? 14 : 24 // hits per second
  const n = Math.round(dur * rate)
  for (let i = 0; i < n; i++) {
    const k = i / n
    const at = t + k * dur + rnd(0, 0.006)
    const g = (0.04 + k * k * 0.12) * (rank === 1 ? 1.2 : 1)
    burst({ t: at, noise: 'white', type: 'bandpass', f: rnd(1700, 2300), q: 0.9, a: 0.001, d: 0.045, gain: g, pan: rnd(-0.15, 0.15) })
    if (!LITE && i % 2 === 0) tone({ t: at, f: 210, f2: 150, d: 0.03, gain: g * 0.5 })
  }
  // A tom pickup into the hit.
  for (let i = 0; i < 3; i++) tone({ t: t + dur - 0.24 + i * 0.08, f: 160 - i * 30, f2: 70, d: 0.12, gain: 0.25 })
}

// A builder revealed: impact + cymbal + a chime that climbs with the rank (#1 also gets a fanfare).
export function reveal(rank = 3) {
  if (!go(rank === 1 ? 3.2 : 2, rank === 1 ? 6 : 4)) return
  const t = now()
  const big = rank === 1
  tone({ t, f: big ? 80 : 95, f2: 34, d: big ? 0.7 : 0.5, gain: big ? 0.6 : 0.45 })
  burst({ t, noise: 'pink', type: 'lowpass', f: 1200, d: 0.35, gain: 0.28 })
  burst({ t, noise: 'white', type: 'highpass', f: 4500, a: 0.002, d: big ? 2.2 : 1.4, gain: big ? 0.16 : 0.11, verb: 0.35 })
  modal({ t, f: 410, modes: CYMBAL, gain: 0.05, beat: 11, strike: 0.15, verb: 0.3 })
  const root = { 3: 392, 2: 466, 1: 523 }[rank] ?? 392
  const chord = big ? [0, 4, 7, 12, 16] : [0, 4, 7, 12]
  chord.forEach((n, i) => modal({ t: t + 0.05 + i * 0.07, f: root * semi(n), modes: BELL, gain: 0.09, verb: 0.45 }))
  if (big) fanfare(t + 0.35)
}

// Brass-ish fanfare for the #1 builder (detuned saws through a lowpass).
function fanfare(t) {
  const notes = [
    [0, 0.14],
    [0, 0.1],
    [0, 0.1],
    [7, 0.32],
    [4, 0.16],
    [7, 0.16],
    [12, 0.7],
  ]
  let at = t
  for (const [n, len] of notes) {
    const f = 392 * semi(n)
    for (const det of LITE ? [0] : [-7, 7]) tone({ t: at, type: 'sawtooth', f, detune: det, a: 0.02, hold: len * 0.6, d: len * 0.7, gain: 0.035, lp: 2200, verb: 0.25 })
    tone({ t: at, type: 'triangle', f: f / 2, a: 0.02, hold: len * 0.5, d: len * 0.6, gain: 0.05 })
    at += len
  }
}

// The crowd goes wild: a swell of voices and scattered claps over `dur` s.
export function cheer(dur = 2.6, gain = 1) {
  if (!go(dur + 0.5, 3)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 900, f2: 1300, q: 0.6, a: 0.35, hold: dur * 0.4, d: dur * 0.6, gain: 0.16 * gain, verb: 0.35 })
  burst({ t: t + 0.1, noise: 'pink', type: 'bandpass', f: 2200, f2: 1700, q: 0.9, a: 0.3, hold: dur * 0.3, d: dur * 0.5, gain: 0.07 * gain, verb: 0.3 })
  const claps = Math.round(dur * (LITE ? 10 : 22))
  for (let i = 0; i < claps; i++) {
    const at = t + rnd(0.05, dur)
    burst({ t: at, noise: 'white', type: 'bandpass', f: rnd(1000, 2200), q: 1.2, a: 0.001, d: rnd(0.015, 0.035), gain: rnd(0.05, 0.12) * gain, pan: rnd(-0.7, 0.7), verb: 0.15 })
  }
  // A couple of whistles.
  for (let i = 0; i < (LITE ? 1 : 2); i++) {
    const at = t + rnd(0.2, dur * 0.6)
    const f = rnd(1800, 2400)
    tone({ t: at, f, f2: f * 1.35, glide: 0.18, a: 0.02, hold: 0.12, d: 0.2, gain: 0.025, pan: rnd(-0.5, 0.5) })
    tone({ t: at + 0.38, f: f * 1.35, f2: f * 0.9, glide: 0.3, a: 0.02, d: 0.3, gain: 0.02, pan: rnd(-0.5, 0.5) })
  }
}

// The countdown's last seconds.
export function tick(last = false) {
  if (!go(0.3, 2)) return
  const t = now()
  modal({ t, f: last ? 1568 : 1175, modes: [[1, 1, 0.12], [2.4, 0.3, 0.06]], gain: 0.07, strike: 0.05 })
}

// Skipped: a quick rewind sweep down.
export function skip() {
  if (!go(0.6, 3)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 2600, f2: 300, q: 1, a: 0.01, d: 0.3, gain: 0.18 })
  tone({ t, type: 'triangle', f: 900, f2: 220, glide: 0.25, d: 0.25, gain: 0.05 })
}

// The show is over: the letterbox opens with a soft rising chime.
export function outro() {
  if (!go(1.4, 3)) return
  const t = now()
  burst({ t, noise: 'pink', type: 'bandpass', f: 2400, f2: 600, q: 0.9, a: 0.05, d: 0.45, gain: 0.12 })
  ;[0, 7, 12].forEach((n, i) => modal({ t: t + 0.1 + i * 0.08, f: 784 * semi(n), modes: BELL, gain: 0.06, verb: 0.4 }))
}
