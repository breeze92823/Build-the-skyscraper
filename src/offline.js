import { OFFLINE } from './config.js'
import { sendOfflineClaim, setOfflineHandlers } from './net.js'
import * as S from './stats.js'

// Offline ("While You Were Away") rewards: HOW LONG you were away, and what that time is worth.
// Two sources, same rules (backend src/offline.ts):
//  - server: a signed-in player whose server keeps a database gets an `offline` view { secs } on join (the
//    server timed the absence on its own clock); a claim goes up as `claimOffline` and only an ok
//    `offlineResult` (stored server-side, so it pays once) lets the client grant the prize.
//  - local: guests and offline play time the absence in the browser (a stamp refreshed while the game runs).
// The prize: Strength and Speed for the minutes away, at the best gym pad you can use (`OFFLINE`, config.js).

let server = null // { secs } once the server answered
let waiting = null // the claim in flight: { resolve, timer }
const listeners = new Set()
const changed = () => listeners.forEach((fn) => fn())

// fn() whenever the amount waiting changes (the server's view arrived, a claim landed).
export const onOfflineChange = (fn) => (listeners.add(fn), () => listeners.delete(fn))
export const serverMode = () => !!server
let latePaid = null
// fn({ ok, strength, speed }) when a claim that had timed out turns out to have been stored (and is paid now).
export const onLatePaid = (fn) => (latePaid = fn)

// --- Local (browser) state: { at (ms of the last stamp), secs (waiting, unclaimed) } -------------------------
const cap = (s) => Math.min(OFFLINE.max, Math.max(0, Math.floor(s)))
let local = { at: Date.now(), secs: 0 }
function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE.localKey) || 'null')
    if (raw && Number.isFinite(raw.at) && Number.isFinite(raw.secs)) return { at: raw.at, secs: cap(raw.secs) }
  } catch {
    // Unreadable: a first visit.
  }
  return null
}
function stamp() {
  local.at = Date.now()
  try {
    localStorage.setItem(OFFLINE.localKey, JSON.stringify(local))
  } catch {
    // Storage blocked: no offline reward for a guest this session.
  }
}

export function initOffline() {
  setOfflineHandlers({
    view(v) {
      if (!v || typeof v !== 'object') return
      server = { secs: cap(Number(v.secs) || 0) }
      changed()
    },
    result(r) {
      if (!waiting) {
        // The answer came after the claim timed out: it IS stored, so pay it now.
        if (r?.ok) {
          server = { secs: 0 }
          latePaid?.(pay(cap(Number(r.secs) || 0)))
          changed()
        }
        return
      }
      clearTimeout(waiting.timer)
      const w = waiting
      waiting = null
      if (r?.ok) server = { secs: 0 }
      else if (r?.reason === 'claimed') server = { secs: 0 }
      w.resolve(r?.ok ? { ok: true, secs: cap(Number(r.secs) || 0) } : { ok: false, reason: r?.reason || 'error' })
      changed()
    },
  })
  // The browser's own timing: the time since the last stamp is the time away (counted only when it is long
  // enough; a refresh in between is not a reward). Used for guests and while no server answers.
  const prev = readLocal()
  if (prev) {
    const away = (Date.now() - prev.at) / 1000
    local = { at: Date.now(), secs: cap(prev.secs + (away >= OFFLINE.min ? away : 0)) }
  }
  stamp()
  setInterval(stamp, 15_000)
  addEventListener('pagehide', stamp)
  document.addEventListener('visibilitychange', () => document.hidden && stamp())
}

// Seconds waiting to be claimed (0 = nothing, or under the minimum).
export function pendingSecs() {
  const s = server ? server.secs : local.secs
  return s >= OFFLINE.min ? s : 0
}

// --- What the time is worth -----------------------------------------------------------------------------
// Whole Strength and Speed for `secs` away: minutes x perMinute x the best pad you may use x your 2x passes
// and pets (no event or running boost). At least 1 of each once there is anything to claim.
export function gainFor(secs) {
  if (secs < OFFLINE.min) return { strength: 0, speed: 0 }
  const base = (Math.min(secs, OFFLINE.max) / 60) * OFFLINE.perMinute * S.bestGymMult()
  return { strength: Math.max(1, Math.floor(base * S.gymBaseMultiplier('strength'))), speed: Math.max(1, Math.floor(base * S.gymBaseMultiplier('speed'))) }
}
// The popup's numbers: the gain plus capacity and walk speed (as the HUD shows it) before and after.
export function preview(secs) {
  const gain = gainFor(secs)
  const { strength, speed } = S.state
  return {
    secs,
    ...gain,
    capBefore: S.capacity(),
    capAfter: S.capacityFor(strength + gain.strength),
    walkBefore: S.walkSpeedFor(speed) * 3.6,
    walkAfter: S.walkSpeedFor(speed + gain.speed) * 3.6,
  }
}

// --- Claim ---------------------------------------------------------------------------------------------------
// Resolves { ok, strength, speed } (already added to your stats) | { ok: false, reason: busy | offline | timeout |
// claimed | save | none | error }.
export function claim() {
  if (server) {
    if (waiting) return Promise.resolve({ ok: false, reason: 'busy' })
    if (!sendOfflineClaim()) return Promise.resolve({ ok: false, reason: 'offline' })
    return new Promise((resolve) => {
      const w = { timer: 0, resolve: (r) => resolve(r.ok ? pay(r.secs) : r) }
      w.timer = setTimeout(() => {
        if (waiting === w) waiting = null
        resolve({ ok: false, reason: 'timeout' })
      }, 8000)
      waiting = w
    })
  }
  const secs = pendingSecs()
  if (!secs) return Promise.resolve({ ok: false, reason: 'none' })
  local.secs = 0
  stamp()
  changed()
  return Promise.resolve(pay(secs))
}
function pay(secs) {
  const g = gainFor(secs)
  S.addStat('strength', g.strength)
  S.addStat('speed', g.speed)
  return { ok: true, ...g }
}
