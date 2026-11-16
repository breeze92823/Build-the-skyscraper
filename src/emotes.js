// Boxity emotes (docs.bloxity.io #emotes). The portal's emote wheel tells ONLY the picker's client
// `play_emote` (data = a 24-hex emote id), so this client plays the clip on its own avatar and relays
// the id through the room (net.sendEmote -> roster `emote` / `emoteAt`); remotePlayers.js replays it on
// the others. A clip is bone-degree deltas over the bind pose (Euler XYZ, right-multiplied onto the
// bind quaternion), smoothstepped between keys, layered over locomotion through the animator's
// `overlay` hook (avatar/animator.js). Everything here is null-safe: with the SDK missing (dev mode,
// blocked CDN) emotes simply never arrive. No DOM.
import { Euler, Quaternion } from 'three'
import { sdk } from './bloxity.js'
import { sendEmote } from './net.js'

const BLEND_IN = 0.1 // s
const BLEND_OUT = 0.15 // s
const FALLBACK_API = 'https://api.bloxity.io' // the documented prod fallback (avatar/loader.js uses it too)
const ID_PATTERN = /^[0-9a-f]{24}$/i

// Safe joint ranges in degrees (docs): [min, max] per axis, missing axis = untouched by the limit.
const LIMITS = [
  [/^Arm[LR]2$/, { x: [-38, 0], z: [-26, 26] }],
  [/^Arm[LR]1$/, { z: [-14, 14] }],
  [/^Arm[LR]_Offset$/, { x: [-178, 0], z: [-88, 88] }],
  [/^Spine1$/, { x: [-3, 3], z: [-9, 9] }],
  [/^Neck1$/, { x: [-8, 8], y: [-18, 18], z: [-8, 8] }],
  [/^Leg[LR]1$/, { z: [-20, 20] }],
  [/^Leg[LR]2$/, { x: [0, 14], z: [-14, 14] }],
]
const limitFor = (bone) => LIMITS.find(([re]) => re.test(bone))?.[1] ?? null
const clampDeg = (v, range) => (range ? Math.min(range[1], Math.max(range[0], v)) : v)
const DEG = Math.PI / 180
const smooth = (s) => s * s * (3 - 2 * s)
const finite = (v) => typeof v === 'number' && Number.isFinite(v)

// --- Catalogue ----------------------------------------------------------------------------------
// id -> clip, from GET {apiUrl}/v1/avatar/emotes. Fetched once, on first use.
let catalogue = null // Promise<Map> | null
const apiUrl = () => {
  try {
    return String(sdk()?.environment?.()?.apiUrl || FALLBACK_API).replace(/\/$/, '')
  } catch {
    return FALLBACK_API
  }
}

function validClip(c) {
  if (!c || typeof c !== 'object' || !finite(c.len) || c.len <= 0 || !c.tracks || typeof c.tracks !== 'object') return null
  const tracks = {}
  for (const [bone, keys] of Object.entries(c.tracks)) {
    if (!Array.isArray(keys)) continue
    const ok = keys.filter((k) => Array.isArray(k) && k.length >= 4 && k.slice(0, 4).every(finite)).sort((a, b) => a[0] - b[0])
    if (ok.length) tracks[bone] = ok
  }
  return Object.keys(tracks).length ? { len: c.len, loop: c.loop === true, tracks } : null
}

function loadCatalogue() {
  catalogue ??= (async () => {
    const map = new Map()
    if (!sdk()) return map // dev mode / SDK blocked: no emotes to play
    try {
      const res = await fetch(`${apiUrl()}/v1/avatar/emotes`)
      const list = res.ok ? (await res.json())?.emotes : null
      for (const e of Array.isArray(list) ? list : []) {
        const clip = validClip(e?.clip)
        if (clip && typeof e.id === 'string') map.set(e.id, clip)
      }
    } catch (err) {
      console.info('[emotes] catalogue unavailable', err?.message ?? err)
      catalogue = null // try again on the next emote
    }
    return map
  })()
  return catalogue
}

// The clip for an emote id, or null (unknown ids are ignored silently, never hardcoded).
export async function clipFor(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null
  return (await loadCatalogue()).get(id) ?? null
}

// --- Playback -----------------------------------------------------------------------------------
const qa = new Quaternion()
const qb = new Quaternion()
const euler = new Euler(0, 0, 0, 'XYZ')

function sample(keys, t, bone, out) {
  const last = keys.length - 1
  let a = keys[0]
  let b = keys[0]
  let s = 0
  if (t >= keys[last][0]) a = b = keys[last]
  else if (t > keys[0][0]) {
    let i = 0
    while (i < last - 1 && keys[i + 1][0] <= t) i++
    a = keys[i]
    b = keys[i + 1]
    s = smooth((t - a[0]) / (b[0] - a[0] || 1))
  }
  const lim = limitFor(bone)
  out.x = clampDeg(a[1] + (b[1] - a[1]) * s, lim?.x)
  out.y = clampDeg(a[2] + (b[2] - a[2]) * s, lim?.y)
  out.z = clampDeg(a[3] + (b[3] - a[3]) * s, lim?.z)
}

// One avatar's emote layer: play(clip) / stop(), and `hook` (assign to `animator.overlay`).
export function createEmoteChannel({ onEnd } = {}) {
  let clip = null
  let time = 0
  let weight = 0
  let stopping = false
  const touched = new Set() // bones written, restored to bind when the emote fades out
  const e = { x: 0, y: 0, z: 0 }

  function hook(dt, animator) {
    if (!clip && !touched.size) return
    time += dt
    if (clip) {
      if (!clip.loop && time >= clip.len) stopping = true
      weight = stopping ? Math.max(0, weight - dt / BLEND_OUT) : Math.min(1, weight + dt / BLEND_IN)
    } else weight = Math.max(0, weight - dt / BLEND_OUT)
    const nodes = animator.root.nodes ?? {}
    const names = new Set([...touched, ...Object.keys(clip?.tracks ?? {})])
    const t = clip?.loop ? time % clip.len : Math.min(time, clip?.len ?? 0)
    for (const bone of names) {
      const node = nodes[bone]
      const bind = animator.bind.get(bone)
      if (!node || !bind) continue // a bone this rig lacks (the procedural fallback): ignore
      const keys = clip?.tracks[bone]
      if (keys) {
        sample(keys, t, bone, e)
        qb.copy(bind).multiply(qa.setFromEuler(euler.set(e.x * DEG, e.y * DEG, e.z * DEG, 'XYZ')))
        touched.add(bone)
      } else qb.copy(bind)
      // The animator rewrites the bones it drives every frame; the others keep what we last wrote.
      if (!animator.driven.has(node)) node.quaternion.copy(bind)
      node.quaternion.slerp(qb, weight)
    }
    if (weight <= 0 && (stopping || !clip)) {
      clip = null
      stopping = false
      touched.clear()
      onEnd?.()
    }
  }

  return {
    hook,
    get active() {
      return !!clip
    },
    play(next) {
      const valid = validClip(next)
      if (!valid) return false
      clip = valid
      time = 0
      stopping = false
      return true
    },
    stop() {
      if (clip) stopping = true
    },
  }
}

// --- This client's own emotes ---------------------------------------------------------------------
// getAnimator() = the local avatar's animator (replaced when the Bloxity look loads); isBusy() =
// moving / jumping / on a gym machine: an emote stops as soon as the player does anything.
export function createEmotes({ getAnimator, isBusy }) {
  let current = '' // the id relayed to the room
  const channel = createEmoteChannel({
    onEnd() {
      if (current) sendEmote('')
      current = ''
    },
  })

  async function play(id) {
    const clip = await clipFor(id)
    if (!clip || isBusy()) return
    if (!channel.play(clip)) return
    current = id
    sendEmote(id)
  }
  function stop() {
    channel.stop()
  }

  try {
    const SDK = sdk()
    if (SDK) {
      SDK.game?.registerFeature?.('emotes')
      SDK.player?.onEvent?.((event, data) => {
        if (event === 'play_emote') void play(String(data))
        else if (event === 'stop_emote') stop()
      })
      void loadCatalogue() // ready before the first pick
    }
  } catch (err) {
    console.warn('[emotes] could not register', err)
  }

  return {
    // Call once per frame, before the animator updates.
    update() {
      const a = getAnimator()
      if (a && a.overlay !== channel.hook) a.overlay = channel.hook
      if (channel.active && isBusy()) stop()
    },
    play,
    stop,
    // Dev: play a clip object directly (the catalogue only exists inside the portal).
    playClip(clip) {
      if (channel.play(clip)) current = ''
    },
  }
}
