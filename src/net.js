// Colyseus link to ../Build-the-skyscraper-backend (room "world"). Contract: the backend's CLAUDE.md.
//
// Progress: signed-in players' progress lives on the server. On join it answers `progress` (the saved
// doc -> stats.hydrate, replacing this browser's save), `noProgress` (new account, guest or no
// database: keep the current state and save it) or `serverError` (the save could not be read: saving
// stays off so it is never overwritten). From then on stats.snapshot() goes up as `saveProgress`
// whenever it changed, at most every NET.saveEvery s, and when the tab hides or closes (main.js calls
// saveNow). Guests, and everyone while no server answers, keep playing on the browser save (stats.js
// save()); its recorded owner decides who may adopt it (a different account never inherits it).
// Identity: the Bloxity game token goes in the join options and the SERVER decides who the player is
// (it never trusts a client id); the dev server (no SDK) sends a per-browser `devId` instead.
// Presence: this player's pose, loadout (rank, strength, gear) and avatar (equipped IDS only, never
// URLs) go up so the others can draw them; `roster()` is everyone in the room (remotePlayers.js).
// Never throws and never blocks play: without a server the game runs on the browser save.
import { Client } from '@colyseus/sdk'
import { DEV_MODE, NET, SERVER_URL } from './config.js'
import * as S from './stats.js'
import {
  authState, canResolveServer, displayName, getEquippedAvatar, getPfp, getProportions, getToken, launchRef, launchRoomId, locateRoom, resolveServerEndpoint, subscribeAuth, updateRoom,
} from './bloxity.js'

// `invite` = the newest Invite Friends view from the server (invite.js), null offline / for guests.
export const net = { room: null, connected: false, hydrated: false, invite: null }

// --- Identity ---------------------------------------------------------------------
const rand = () => Math.random().toString(36).slice(2, 8)
function storedId(key, make) {
  try {
    let id = localStorage.getItem(key)
    if (!id) localStorage.setItem(key, (id = make()))
    return id
  } catch {
    return make()
  }
}
const DEV = DEV_MODE ? storedId('build-the-skyscraper.dev', () => `dev-${rand()}`) : ''

// Who is playing, as this browser knows it: '' = a guest (never saved on the server), else the
// account id (the Bloxity user id, or the dev id). Only used to tell identities apart and to
// own the browser save; the server works out the real id from the token.
function userKey() {
  if (DEV_MODE) return DEV
  const u = authState.user
  const id = u && (u._id || u.id || u.userId || u.uid)
  return id ? String(id) : ''
}
// Ids compare after dropping Bloxity's `legion_` prefix and any `#m...` mode suffix (the roster's
// `uid` and the chat's `m.userId` are the same account id).
export const normId = (id) => String(id ?? '').split('#')[0].replace(/^legion_/, '')
// This player's account id in the roster's `uid` form ('' for a guest).
export const myUid = () => normId(userKey())
export const isGuest = () => !userKey()

function playerName() {
  if (DEV_MODE) return `Dev ${DEV.slice(4)}`
  if (!userKey()) return 'Guest'
  const n = displayName()
  return n === 'Offline' || n === 'Guest' ? 'Player' : n
}

export const hasServer = () => !!(SERVER_URL || canResolveServer())

// --- Sending ----------------------------------------------------------------------
function send(type, payload) {
  try {
    net.room?.send(type, payload)
  } catch (err) {
    console.warn('[net] send failed', type, err)
  }
}

let sentKey = '' // the identity this connection joined as
let roomRef = '' // "<relay>~<room>" or the bare room id: what ?roomId= wants
let booted = false // whenLoaded() has returned: the game was built from the state as it was then
let lastSaved = ''
let savedAt = -1e9

function serverSave(force) {
  if (!net.connected || !net.hydrated || !sentKey) return
  if (!force && performance.now() - savedAt < NET.saveEvery * 1000) return
  const snap = JSON.stringify(S.snapshot())
  if (snap === lastSaved) return
  lastSaved = snap
  savedAt = performance.now()
  send('saveProgress', JSON.parse(snap))
}

// Saves everywhere this player's progress lives: the browser save (always, it is the offline
// fallback and the guest's only save) and the server (signed-in players, once their save loaded).
// Call it with state.tower already refreshed. `force` skips the NET.saveEvery throttle (tab hiding).
export function saveNow(force = false) {
  S.save()
  S.setSaveOwner(userKey())
  serverSave(force)
}

// --- Presence (what the others draw: remotePlayers.js) -----------------------------
let getPose = () => null
let getPresence = () => null
let sentPose = ''
let sentLoadout = ''
let sentAvatar = ''

const r2 = (n) => Math.round(n * 100) / 100
// The activities the server relays (backend POSE_ACTS): anything else goes up as "" (nothing).
const POSE_ACTS = new Set(['bench', 'chute', 'impact', 'fly', 'climb', 'vehicle', 'jet'])
function poseNow() {
  const p = getPose()
  if (!p) return null
  return { x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), speed: r2(p.speed), act: POSE_ACTS.has(p.act) ? p.act : '' }
}
function loadoutNow() {
  const p = getPresence()
  return p ? { rank: p.rank | 0, strength: Math.round(p.strength * 10) / 10, gear: p.gear || '' } : null
}
// The Bloxity look as the server relays it: JSON { equipped, proportions } of ids and numbers only
// (the others rebuild the skin / part URLs from the ids). '' = the default character.
function avatarJson() {
  if (!authState.user) return ''
  const equipped = getEquippedAvatar()
  if (!equipped || typeof equipped !== 'object') return ''
  const ids = {}
  for (const [k, v] of Object.entries(equipped)) if (typeof v === 'string' || Number.isFinite(v)) ids[k] = v
  for (const proportions of [getProportions(), null]) {
    try {
      const json = JSON.stringify({ equipped: ids, proportions })
      if (json.length <= NET.avatarMax) return json
    } catch {
      return ''
    }
  }
  return ''
}
function sendPose() {
  if (!net.connected) return
  const msg = poseNow()
  const key = msg && JSON.stringify(msg)
  if (!msg || key === sentPose) return
  sentPose = key
  send('pose', msg)
}
function syncPresence() {
  if (!net.connected) return
  const l = loadoutNow()
  const lk = l && JSON.stringify(l)
  if (l && lk !== sentLoadout) {
    sentLoadout = lk
    send('loadout', l)
  }
  const a = avatarJson()
  if (a !== sentAvatar) send('setAvatar', { avatar: (sentAvatar = a) })
}

// An emote this player picked in the Boxity menu ('' = stopped): the server relays it to the room.
export const sendEmote = (id) => net.connected && send('emote', { id: typeof id === 'string' ? id : '' })

// The other players in the room (sessionId -> PlayerState), or null when not connected.
export const roster = () => (net.connected ? net.room?.state?.players ?? null : null)
export const mySessionId = () => net.room?.sessionId ?? ''

// --- The shared tower (tower.js sync / setReporter; backend tower.ts) ---------------------------
// One tower per room, owned by the server: `towerState()` is what it says right now. Blocks this
// player places go up as `build { blocks }` (summed, at most every NET.buildEvery s) and come back
// through the room state; the finished building's top builders come as `built`.
let clockOffset = 0 // server clock - this clock (ms), from the `serverTime` of the server's messages
function keepClock(msg) {
  if (typeof msg?.serverTime === 'number' && Number.isFinite(msg.serverTime)) clockOffset = msg.serverTime - Date.now()
}
// The server's clock now (ms): ages the tower's `phaseAt` (how long the lobby has been open, how far it has sunk).
export const serverNow = () => Date.now() + clockOffset

// { n, floors, blocks, phase, phaseAt, seeded } of the room's tower, or null while not connected or
// before the room has seeded it (then the tower plays locally). One reused object: read it, don't keep it.
const towerSnap = { n: 0, floors: 0, blocks: 0, phase: 'building', phaseAt: 0, seeded: true }
export function towerState() {
  const t = net.connected ? net.room?.state?.tower : null
  if (!t || !t.seeded) return null
  towerSnap.n = t.n
  towerSnap.floors = t.floors
  towerSnap.blocks = t.blocks
  towerSnap.phase = t.phase
  towerSnap.phaseAt = t.phaseAt
  return towerSnap
}

let buildAcc = 0 // blocks placed since the last `build` message
let buildSentAt = -1e9
// Queues blocks this player just placed on the shared tower. Dropped while not connected (the tower
// plays locally then, see towerState()).
export function sendBuild(n) {
  if (!net.connected || !(n >= 1)) return
  buildAcc += Math.floor(n)
}
function flushBuild(force = false) {
  if (!(buildAcc >= 1)) return
  if (!net.connected) return void (buildAcc = 0)
  if (!force && performance.now() - buildSentAt < NET.buildEvery * 1000) return
  buildSentAt = performance.now()
  const blocks = buildAcc
  buildAcc = 0
  send('build', { blocks })
}
// fn({ n, name, builders: [{ id, name, blocks }] }) when a building is finished (tower.setBuilders).
let onBuiltHandler = null
export function onBuilt(fn) {
  onBuiltHandler = fn
}

// --- Boot wait ---------------------------------------------------------------------
let answered = null
const answer = new Promise((resolve) => (answered = resolve))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Does the browser save belong to whoever is playing now? (A guest's is '', an account's its id.)
const localIsMine = () => S.saveOwner() === '' || S.saveOwner() === userKey()
// What a missing server answer means: play on the browser save, but never as someone else's.
function localPolicy() {
  if (!localIsMine()) S.resetState()
}

// Resolves once the player's progress is settled: the server answered (state hydrated or kept), the
// connection failed, there is no server, or `ms` passed. main.js awaits it before building the tower
// (the tower reads state.tower), so the loading screen covers it.
export async function whenLoaded(ms = NET.loadTimeout * 1000) {
  const end = performance.now() + ms
  await Promise.race([answer, sleep(ms)])
  // Connected: the room's tower is built from too, so wait (within the same budget) until the server
  // has seeded it. No answer / no server: the tower plays locally.
  while (!booted && net.connected && !towerState() && performance.now() < end) await sleep(40)
  if (!booted) {
    // No answer in time: the browser save (or a fresh start when it is another account's).
    if (!net.hydrated) localPolicy()
    booted = true
  }
}

// --- Connection -------------------------------------------------------------------
let onLeaderboard = null
let lastRewards = null // the newest `rewards` view, replayed to a handler that registers late
const rewardHandlers = { view: null, result: null }
let lastOffline = null // the newest `offline` view ({ secs, max }), replayed to a handler that registers late
const offlineHandlers = { view: null, result: null }
let lastBoards = null // the newest `leaderboard` message, replayed to a handler that registers late

function reloadSameRoom() {
  try {
    if (roomRef) {
      const url = new URL(location.href)
      url.searchParams.set('roomId', roomRef)
      history.replaceState(null, '', url)
    }
  } catch {
    // Reload without it: matchmaking finds a room.
  }
  location.reload()
}

// The server's save arrived after the game was built from the browser save (a slow cold start).
// Keep the one that is further along; when the server's is, reload once (not in a loop) so the
// world is built from it.
function lateProgress(doc) {
  const ahead = (doc.totalBlocks ?? 0) > S.state.totalBlocks || (doc.buildings ?? 0) > S.state.buildings
  if (!ahead) return false
  try {
    const at = Number(sessionStorage.getItem('build-the-skyscraper.reload') || 0)
    if (Date.now() - at < 60_000) return false
    sessionStorage.setItem('build-the-skyscraper.reload', String(Date.now()))
  } catch {
    return false
  }
  S.setSaveOwner('') // let the reload adopt nothing from this browser: the server's save wins
  reloadSameRoom()
  return true
}

function attach(room) {
  net.room = room
  net.connected = true
  buildAcc = 0
  room.onMessage('progress', (doc) => {
    net.hydrated = true
    lastSaved = ''
    keepClock(doc)
    if (!doc) return answered()
    if (!booted) {
      // Boot is waiting: the account's save replaces whatever this browser held.
      S.hydrate(doc)
      S.setSaveOwner(userKey())
    } else if (lateProgress(doc)) return
    answered()
    saveNow(true)
  })
  room.onMessage('noProgress', (msg) => {
    net.hydrated = true
    lastSaved = ''
    keepClock(msg)
    if (!booted) localPolicy() // keep this browser's save for this account, unless it is someone else's
    answered()
    saveNow(true)
  })
  room.onMessage('serverError', () => {
    net.hydrated = false // saving stays off: the stored progress must not be overwritten
    console.warn('[net] server could not read the saved progress; saving to it is off this session')
    answered()
  })
  room.onMessage('leaderboard', (data) => {
    lastBoards = data
    deliverBoards()
  })
  // A building was finished: its top builders (tower.setBuilders, the finale's podium).
  room.onMessage('built', (m) => {
    keepClock(m)
    try {
      onBuiltHandler?.(m)
    } catch (err) {
      console.warn('[net] built handler failed', err)
    }
  })
  // Daily / Playtime / Free rewards (server-authoritative for a signed-in player: rewards.js).
  room.onMessage('rewards', (view) => {
    lastRewards = view
    rewardHandlers.view?.(view)
  })
  room.onMessage('rewardResult', (res) => rewardHandlers.result?.(res))
  // Offline ("While You Were Away") reward: the seconds the server counted, and the answer to a claim (offline.js).
  room.onMessage('offline', (view) => {
    lastOffline = view
    offlineHandlers.view?.(view)
  })
  room.onMessage('offlineResult', (res) => offlineHandlers.result?.(res))
  // Invite Friends (invite.js; the server decides who counts: a friend who actually played).
  room.onMessage('invite', (view) => setInvite(view))
  room.onMessage('inviteResult', (res) => {
    if (res && Array.isArray(res.claimed)) setInvite(res)
    const w = inviteWaiting
    inviteWaiting = null
    if (w) {
      clearTimeout(w.timer)
      w.resolve(res?.ok ? { ok: true, id: res.id } : { ok: false, reason: res?.reason || 'error' })
    }
  })
  room.onMessage('friendJoined', (m) => inviteEvent('friendJoined', String(m?.name || 'A friend')))
  room.onMessage('invitedBy', (m) => inviteEvent('invitedBy', String(m?.name || 'A friend')))
  room.onLeave(() => {
    if (net.room !== room) return
    net.room = null
    net.connected = false
    net.hydrated = false
    setInvite(null)
    if (inviteWaiting) {
      clearTimeout(inviteWaiting.timer)
      inviteWaiting.resolve({ ok: false, reason: 'offline' })
      inviteWaiting = null
    }
    buildAcc = 0 // not sent: the tower is local again (towerState() is null) until the rejoin
    roomRef = ''
    updateRoom('')
    setTimeout(connect, NET.rejoin * 1000)
  })
}

let launchRoom = launchRoomId()
async function joinLaunchRoom(options) {
  const id = launchRoom
  launchRoom = '' // only the first connection; a reconnect matchmakes
  if (!id) return null
  try {
    if (SERVER_URL) return { room: await new Client(SERVER_URL).joinById(id.split('~').pop(), options), relay: '' }
    const at = await locateRoom(id)
    if (at) return { room: await new Client(at.endpoint).joinById(at.roomId, options), relay: at.relayRoomId }
  } catch (err) {
    console.info('[net] the invited room is gone or full; matchmaking instead', err?.message ?? err)
  }
  return null
}

async function joinAnyRoom(options) {
  if (SERVER_URL) return { room: await new Client(SERVER_URL).joinOrCreate('world', options), relay: '' }
  const { endpoint, relayRoomId } = await resolveServerEndpoint(options.token ? userKey() : undefined)
  return { room: await new Client(endpoint).joinOrCreate('world', options), relay: relayRoomId }
}

let connecting = false
let retryIn = NET.retry
async function connect() {
  if (!hasServer() || connecting || net.connected) return
  connecting = true
  try {
    sentKey = userKey()
    const pose = poseNow()
    const loadout = loadoutNow()
    sentPose = pose ? JSON.stringify(pose) : ''
    sentLoadout = loadout ? JSON.stringify(loadout) : ''
    sentAvatar = avatarJson()
    // The token proves who this is; the server never takes an id from here (devId: dev servers only).
    const options = {
      token: DEV_MODE ? '' : await getToken(),
      ...(DEV_MODE && { devId: DEV }),
      username: playerName(),
      pfp: getPfp(),
      pose,
      loadout,
      avatar: sentAvatar,
      // The browser save's tower: the server only uses it to seed a FRESH room (guests / no stored save).
      tower: S.state.tower ?? null,
      // The invite link this page was opened from (the inviter's account id): the server credits the
      // inviter once this player has actually played.
      ref: launchRef(),
    }
    const { room, relay } = (await joinLaunchRoom(options)) ?? (await joinAnyRoom(options))
    retryIn = NET.retry
    roomRef = relay ? `${relay}~${room.roomId}` : room.roomId
    attach(room)
    updateRoom(roomRef)
  } catch (err) {
    console.info(`[net] could not reach the server (retrying in ${retryIn}s); playing on the browser save`, err?.message ?? err)
    answered() // play on rather than hold the loading screen
    setTimeout(connect, retryIn * 1000)
    retryIn = Math.min(retryIn * 2, NET.retryMax)
  } finally {
    connecting = false
  }
}

function deliverBoards() {
  if (!onLeaderboard || !lastBoards) return
  try {
    onLeaderboard(lastBoards)
  } catch (err) {
    console.warn('[net] leaderboard failed', err)
  }
}
// fn(data): the server's boards (leaderboard.js setRemote), now and on every refresh.
export function setLeaderboardHandler(fn) {
  onLeaderboard = fn
  deliverBoards()
}
// Rewards (rewards.js): view(v) gets every `rewards` view (now, if one already came), result(r) every
// `rewardResult`. sendReward(type, msg) sends `claimReward` / `rewardsRefresh`; false when offline.
export function setRewardHandlers({ view, result } = {}) {
  rewardHandlers.view = view ?? null
  rewardHandlers.result = result ?? null
  if (lastRewards && view) view(lastRewards)
}
// Offline reward (offline.js): view(v) gets the server's `offline` view (now, if it already came), result(r)
// every `offlineResult`. sendOfflineClaim() sends `claimOffline`; false when not connected.
export function setOfflineHandlers({ view, result } = {}) {
  offlineHandlers.view = view ?? null
  offlineHandlers.result = result ?? null
  if (lastOffline && view) view(lastOffline)
}
export function sendOfflineClaim() {
  if (!net.connected || !net.room) return false
  send('claimOffline', {})
  return true
}
export function sendReward(type, msg = {}) {
  if (!net.connected || !net.room) return false
  send(type, msg)
  return true
}

// --- Invite Friends (invite.js) -------------------------------------------------------------------
// The server sends the view { invites, pending, claimed, welcome, tiers, invitedBy, active, need } and
// answers claims; the client grants a prize only after an ok claim. Offline / guests: net.invite is null.
let inviteWaiting = null // the claim in flight: { resolve, timer } (one at a time)
const inviteListeners = new Set()
let onInviteEventFn = null
function setInvite(view) {
  net.invite = view && typeof view === 'object' && Array.isArray(view.claimed) ? view : null
  inviteListeners.forEach((fn) => {
    try {
      fn(net.invite)
    } catch (err) {
      console.warn('[net] invite listener failed', err)
    }
  })
}
function inviteEvent(kind, name) {
  try {
    onInviteEventFn?.(kind, name)
  } catch (err) {
    console.warn('[net] invite event failed', err)
  }
}
// fn(view) whenever the view changes (a refresh, a claim, a friend started playing). Returns an unsubscribe.
export function onInviteChange(fn) {
  inviteListeners.add(fn)
  return () => inviteListeners.delete(fn)
}
// fn(kind, name): 'friendJoined' (a friend you invited started playing) or 'invitedBy' (you were invited:
// your welcome gift is ready).
export function onInviteEvent(fn) {
  onInviteEventFn = fn
}
// The raw account id the invite link is tagged with (`ref`); '' for a guest.
export const myAccountId = () => userKey()
// Claims `id` ("welcome" or a tier index). Resolves { ok: true, id } | { ok: false, reason }:
// guest, loading, locked, save (server), offline, busy, timeout.
export function claimInvite(id) {
  if (!net.connected || !net.room) return Promise.resolve({ ok: false, reason: 'offline' })
  if (inviteWaiting) return Promise.resolve({ ok: false, reason: 'busy' })
  return new Promise((resolve) => {
    const w = { resolve, timer: 0 }
    w.timer = setTimeout(() => {
      if (inviteWaiting === w) inviteWaiting = null
      resolve({ ok: false, reason: 'timeout' })
    }, 8000)
    inviteWaiting = w
    send('claimInvite', { id })
  })
}
// Re-reads the counts (friends credited in another room meanwhile); the answer arrives as an `invite` view.
export const refreshInvite = () => net.connected && send('inviteRefresh', {})
// A direct Boxity invite went to `friendId`: the server remembers it, so that friend counts for this player.
export const sentInvite = (friendId) => net.connected && send('invited', { friendId })

// pose(): { x, y, z, yaw, speed, act } of this player; presence(): { rank, strength, gear }. They can
// be attached after initNet (main.js builds the things they read after it starts connecting).
export function setPresenceSources({ pose, presence } = {}) {
  if (pose) getPose = pose
  if (presence) getPresence = presence
}

// Starts connecting (once auth has settled). Takes the same handlers as the setters above.
export function initNet({ setLeaderboard, pose, presence } = {}) {
  if (setLeaderboard) setLeaderboardHandler(setLeaderboard)
  setPresenceSources({ pose, presence })
  if (!hasServer()) {
    console.info('[net] no server configured; progress is kept in this browser')
    answered()
    return
  }
  let started = false
  subscribeAuth((s) => {
    if (!s.ready) return
    if (!started) {
      started = true // who is playing is settled: join as them
      void connect()
      return
    }
    if (userKey() === sentKey) return
    // A guest signed in (or an account signed out) after joining: save under the OLD identity, then
    // come back to the same room as the new one (its progress loads from the server on the way in).
    // The browser save stays owned by the old identity, so only a guest's is adopted by an account.
    if (booted) {
      S.save()
      S.setSaveOwner(sentKey)
      serverSave(true)
    }
    reloadSameRoom()
  })
  // Once a second: the loadout / look when they changed.
  setInterval(syncPresence, 1000)
  setInterval(sendPose, 1000 / NET.poseHz)
  // The blocks you placed on the shared tower: batched, then sent (at once when the tab hides).
  setInterval(() => flushBuild(), (NET.buildEvery * 1000) / 2)
  document.addEventListener('visibilitychange', () => document.hidden && flushBuild(true))
  window.addEventListener('pagehide', () => flushBuild(true))
}
