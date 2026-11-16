import { REWARDS } from './config.js'
import { sendReward, setRewardHandlers } from './net.js'
import * as S from './stats.js'

// Daily, Playtime and Free rewards: WHEN a prize may be claimed (stats.grantReward grants WHAT).
// Two sources, same rules (backend src/rewards.ts):
//  - server: a signed-in player whose server keeps a database sends `rewards` views; claims go up as
//    `claimReward` and only an ok `rewardResult` (stored server-side) lets the client grant the prize.
//  - local: guests and offline play keep the same state in the browser save (`state.rewards`).
// Daily: one claim per UTC day, in a row (missing a day starts over at day 1, a finished week too).
// Playtime: minutes played today (UTC), each REWARDS.play tier once a day. Free: once ever.

const DAY_MS = 86_400_000
const dayIndex = (ms) => Math.floor(ms / DAY_MS)
const DAYS = REWARDS.daily.length

let server = null // { view, at: performance.now() of receipt, offset: serverTime - Date.now() }
const pending = [] // claims waiting for the server: { kind, resolve, timer }
let refreshAt = 0 // performance.now() before which no rewardsRefresh is sent again
const listeners = new Set()
const changed = () => listeners.forEach((fn) => fn())

// fn() whenever the state changes (a view arrived, a claim landed, a new day).
export const onRewardsChange = (fn) => (listeners.add(fn), () => listeners.delete(fn))
export const serverMode = () => !!server

export function initRewards() {
  setRewardHandlers({
    view(v) {
      if (!v || !v.daily || !v.play) return
      server = { view: v, at: performance.now(), offset: (v.serverTime ?? Date.now()) - Date.now() }
      changed()
    },
    result(r) {
      if (r?.view) server = { view: r.view, at: performance.now(), offset: (r.view.serverTime ?? Date.now()) - Date.now() }
      const i = pending.findIndex((p) => p.kind === r?.kind)
      const p = i >= 0 ? pending.splice(i, 1)[0] : pending.shift()
      if (p) {
        clearTimeout(p.timer)
        p.resolve(r?.ok ? { ok: true, day: r.day, tier: r.tier } : { ok: false, reason: r?.reason || 'error' })
      }
      changed()
    },
  })
}

// --- Local (browser) state ------------------------------------------------------------------------------
function local() {
  const r = S.state.rewards
  const today = dayIndex(Date.now())
  if (r.playDay !== today) {
    r.playDay = today
    r.playSec = 0
    r.playClaimed = []
  }
  return r
}
function localDaily(r, now) {
  const today = dayIndex(now)
  const claimedToday = r.last === today
  const kept = claimedToday || r.last === today - 1
  const streak = kept ? r.streak : 0
  return { day: streak % DAYS, canClaim: !claimedToday, streak, nextAt: (today + 1) * DAY_MS }
}

// --- What the windows draw --------------------------------------------------------------------------------
// { daily: { day, canClaim, streak, nextIn (s), weekDone }, play: { sec, claimed: [], ready: [], nextTier,
//   nextIn (s) }, free, online }
export function status() {
  let daily, sec, claimed, free
  if (server) {
    const now = Date.now() + server.offset
    const v = server.view
    daily = { ...v.daily }
    sec = v.play.sec + (performance.now() - server.at) / 1000
    claimed = v.play.claimed
    free = v.free
    // Past the server's midnight: ask for the new day's view (the old one shows until it lands).
    if (now >= v.daily.nextAt && performance.now() > refreshAt) {
      refreshAt = performance.now() + 5000
      sendReward('rewardsRefresh')
    }
    daily.nextIn = Math.max(0, (v.daily.nextAt - now) / 1000)
  } else {
    const r = local()
    const now = Date.now()
    daily = localDaily(r, now)
    daily.nextIn = Math.max(0, (daily.nextAt - now) / 1000)
    sec = r.playSec
    claimed = r.playClaimed
    free = r.free
  }
  // A whole week claimed today: every card shows claimed until tomorrow starts the next week.
  daily.weekDone = !daily.canClaim && daily.streak > 0 && daily.streak % DAYS === 0
  const ready = []
  let nextTier = -1
  REWARDS.play.forEach((t, i) => {
    if (claimed.includes(i)) return
    if (sec >= t.at * 60) ready.push(i)
    else if (nextTier < 0) nextTier = i
  })
  return {
    daily,
    play: { sec, claimed, ready, nextTier, nextIn: nextTier >= 0 ? REWARDS.play[nextTier].at * 60 - sec : null },
    free,
    online: !!server,
  }
}

// Anything waiting to be claimed (the DAILY button's badge).
export function anyReady(st = status()) {
  return st.daily.canClaim || st.play.ready.length > 0
}

// Local playtime runs with the game (call every frame); the server counts its own.
let readyCount = -1
export function tickRewards(dt, onNewReady) {
  if (!server) local().playSec += dt
  const n = status().play.ready.length
  if (readyCount >= 0 && n > readyCount) onNewReady?.()
  readyCount = n
}

// --- Claims ------------------------------------------------------------------------------------------------
// kind 'daily' | 'play' (tier) | 'free'. Resolves { ok, day?, tier? } | { ok: false, reason }.
// reason: claimed, early, busy, offline, save, timeout, error.
export function claim(kind, tier) {
  if (server) {
    if (pending.some((p) => p.kind === kind)) return Promise.resolve({ ok: false, reason: 'busy' })
    if (!sendReward('claimReward', kind === 'play' ? { kind, tier } : { kind })) return Promise.resolve({ ok: false, reason: 'offline' })
    return new Promise((resolve) => {
      const p = { kind, resolve, timer: 0 }
      p.timer = setTimeout(() => {
        const i = pending.indexOf(p)
        if (i >= 0) pending.splice(i, 1)
        resolve({ ok: false, reason: 'timeout' })
      }, 8000)
      pending.push(p)
    })
  }
  const r = local()
  const now = Date.now()
  let out
  if (kind === 'daily') {
    const d = localDaily(r, now)
    if (!d.canClaim) out = { ok: false, reason: 'claimed' }
    else {
      r.streak = d.streak + 1
      r.last = dayIndex(now)
      out = { ok: true, day: d.day }
    }
  } else if (kind === 'play') {
    const t = REWARDS.play[tier]
    if (!t) out = { ok: false, reason: 'error' }
    else if (r.playClaimed.includes(tier)) out = { ok: false, reason: 'claimed' }
    else if (r.playSec < t.at * 60) out = { ok: false, reason: 'early' }
    else {
      r.playClaimed = [...r.playClaimed, tier]
      out = { ok: true, tier }
    }
  } else if (kind === 'free') {
    if (r.free) out = { ok: false, reason: 'claimed' }
    else {
      r.free = true
      out = { ok: true }
    }
  } else out = { ok: false, reason: 'error' }
  if (out.ok) changed()
  return Promise.resolve(out)
}
