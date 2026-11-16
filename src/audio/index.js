// Game audio, the one import the rest of the game uses:
//   import { sfx, game, installAudio, updateAudio } from './audio/index.js'
// installAudio() once at boot (waits for the first gesture to start), then
// updateAudio(dt, state) every frame (jump / land, menu ducking). sfx.<name>() are the
// shared UI and reward one-shots, game.<name>() the construction sounds. Every button
// press gets its click here (one capture-phase listener), so menus need no wiring.
import { installAudio as installCore, isMuted, onStart, setDucked, setMuted, setVolume, toggleMuted, A } from './core.js'
import * as sfx from './sfx.js'
import * as game from './game.js'

export { sfx, game, setVolume, setMuted, isMuted, toggleMuted }

function onPress(e) {
  if (e.button > 0) return
  const b = e.target.closest?.('button, [role="button"]')
  if (!b || b.disabled) return
  const pan = Math.max(-0.6, Math.min(0.6, (e.clientX / window.innerWidth - 0.5) * 1.2))
  if (b.classList.contains('hud-tap')) return // the gym lift has its own sound
  if (b.classList.contains('uiw-btn')) sfx.press(pan)
  else sfx.click(pan)
}

export function installAudio() {
  installCore()
  window.addEventListener('pointerdown', onPress, { capture: true, passive: true })
}

// Feedback hooks for the shared UI pieces (uiWindow.replay): they wait one task so a
// specific sound fired in the same handler wins.
export function feedback(kind) {
  setTimeout(() => {
    if (kind === 'shake') return sfx.deny()
    if (sfx.claimedRecently()) return
    if (kind === 'bump') return sfx.equip()
  }, 0)
}

const prev = { grounded: true, vy: 0, init: false }
let started = false
onStart(() => (started = true))
// st: { player: { grounded, vy }, windowOpen }
export function updateAudio(dt, st) {
  if (!started || !A.ctx || A.ctx.state !== 'running') return
  const p = st.player
  if (prev.init && !st.locked) {
    if (prev.grounded && !p.grounded && p.vy > 2) sfx.jump()
    if (!prev.grounded && p.grounded && prev.vy < -4) sfx.land(Math.min(1, -prev.vy / 18))
  }
  prev.grounded = p.grounded
  prev.vy = p.vy
  prev.init = true
  setDucked(st.windowOpen)
}
