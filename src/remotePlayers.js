// The other players in the room: each is the Bloxity base character wearing the look they relayed
// (equipped item IDS only, never URLs), dressed like our own construction worker (hard hat + vest,
// muscles from their Strength), with a rank name tag, eased toward the pose the server last relayed
// (net.js sends ours; backend presence.ts) and playing their emotes. The roster is diffed every frame,
// so joins and leaves need no events; only the NET.maxRemotes nearest within NET.remoteRange are drawn.
// Their Robot Gear (remoteGear.js: worn piece, thrusters, Spider Arms climbing, transformer vehicles) and
// what their pose `act` says (parachute, superhero landing, bench) are drawn too. Their pets are not shown.
// Offline (roster() null) nothing is drawn.
import { Group, Object3D } from 'three'
import * as config from './config.js'
import { mySessionId, myUid, normId, roster } from './net.js'
import { dressWorker, makeNameTag } from './characters.js'
import { buildDefaultCharacter, loadBaseCharacter } from './avatar/character.js'
import { applyProportions, attachEquippedAccessories } from './avatar/loader.js'
import { AVATAR_SLOTS } from './avatar/cdn.js'
import { disposeAnimator, makeAnimator } from './avatar/animator.js'
import { clipFor, createEmoteChannel } from './emotes.js'
import { createRemoteGear } from './remoteGear.js'
import { flareFor, makeCanopy } from './parachute.js'
import { groundBelowAt } from './physics.js'
import { robot as snd } from './audio/index.js'

const { GYM, STATS, ROBOT, ROBOT_GEAR } = config
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
// config.NET holds the shared tunables; these are the fallbacks until/unless it does.
const NET = { remoteLerp: 12, maxRemotes: 16, remoteRange: 140, ...(config.NET ?? {}) }

const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from))
const TAG_Y = 2.5 // m above the feet (main.js: our own tag)
const TAG_Y_BENCH = 0.9
const SNAP = 25 // m: a jump this far (respawn, portal) is not eased
const ID_KEYS = new Set([...AVATAR_SLOTS.map((s) => s.key), 'skinId', 'pantsId', 'shirtId', 'faceId'])
const ID_VALUE = /^[A-Za-z0-9_-]{1,64}$/

// The relayed look as { equipped, proportions }, rebuilt from allowlisted keys with id-shaped values.
function parseLook(json) {
  if (!json) return { equipped: null, proportions: null }
  try {
    const raw = JSON.parse(json)
    const equipped = {}
    for (const [k, v] of Object.entries(raw?.equipped ?? {})) {
      if (!ID_KEYS.has(k)) continue
      if (typeof v === 'number' && Number.isFinite(v)) equipped[k] = String(v)
      else if (typeof v === 'string' && ID_VALUE.test(v)) equipped[k] = v
    }
    const proportions = {}
    for (const [k, v] of Object.entries(raw?.proportions ?? {})) if (typeof v === 'number' && Number.isFinite(v)) proportions[k] = v
    return { equipped: Object.keys(equipped).length ? equipped : null, proportions }
  } catch {
    return { equipped: null, proportions: null }
  }
}

class Remote {
  constructor(root, ctx) {
    this.root = root
    this.ctx = ctx // { scene, fx, impactFx }
    this.group = new Group()
    this.group.rotation.order = 'YXZ'
    root.add(this.group)
    // The avatar (and a transformer's vehicle) live in `body`: remoteGear.js lifts and leans it.
    this.body = new Group()
    this.group.add(this.body)
    this.gear = createRemoteGear({ body: this.body, fx: ctx.fx })
    this.canopy = null // the parachute, made when they first open one
    this.act = null // the last pose act seen (null until the first frame)
    this.apexY = 0
    this.impactDepth = 0
    this.flare = 0
    this.yawRate = 0
    this.target = { pos: this.group.position, facing: 0 } // where the superhero landing's effects happen
    // Not rotated with the body (a bench lies the body down): the name tag and chat bubble hang here.
    this.anchor = new Object3D()
    root.add(this.anchor)
    this.tag = makeNameTag('Player', 0)
    root.add(this.tag.sprite)

    this.avatar = null
    this.animator = null
    this.dress = null
    this.lookKey = null // the relayed look the current rig was built from
    this.proportions = null
    this.muscle = -1
    this.generation = 0
    this.placed = false
    this.vy = 0
    this.repT = 0
    this.yaw = 0
    this.channel = createEmoteChannel()
    this.setAvatar(buildDefaultCharacter(), null) // until the real one loads
  }

  setAvatar(next, proportions) {
    if (this.avatar) this.body.remove(this.avatar)
    disposeAnimator(this.animator)
    this.avatar = next
    this.body.add(next)
    this.proportions = proportions
    this.dress = dressWorker(next, { hat: '#ffd21a' }) // before the animator and the gear: it records the bind pose
    this.muscle = -1
    this.animator = makeAnimator(next)
    if (this.animator) this.animator.overlay = this.channel.hook
    this.gear.setAvatar(next)
  }

  // The look arrives as JSON { equipped, proportions } of ids; "" = the default Bloxity character.
  async syncAvatar(json) {
    if (json === this.lookKey) return
    this.lookKey = json
    const mine = ++this.generation
    const { equipped, proportions } = parseLook(json)
    try {
      const group = await loadBaseCharacter()
      if (mine !== this.generation) return
      await attachEquippedAccessories(group, equipped)
      if (mine !== this.generation) return
      applyProportions(group, proportions)
      this.setAvatar(group, proportions)
    } catch (err) {
      console.warn('[remotePlayers] avatar load failed', err) // keep the placeholder
    }
  }

  syncMuscle(strength) {
    const m = Math.round(STATS.muscle(Math.max(0, Number(strength) || 0)) * 50) / 50
    if (m === this.muscle || !this.dress) return
    this.muscle = m
    this.dress.setMuscle(m, this.proportions?.torsoScaleX ?? 1)
  }

  // d: how far this player is from the viewer (m): quiets the sounds of their parachute and landings.
  update(p, dt, elapsed, d = 0) {
    this.tag.set(p.username || 'Player', p.rank | 0)
    this.syncAvatar(p.avatar || '')
    this.syncMuscle(p.strength)
    this.gear.setId(p.gear || '')

    const g = this.group
    const far = Math.hypot(p.x - g.position.x, p.z - g.position.z) > SNAP
    const k = this.placed && !far ? 1 - Math.exp(-NET.remoteLerp * dt) : 1
    const prevY = g.position.y
    g.position.x += (p.x - g.position.x) * k
    g.position.y += (p.y - g.position.y) * k
    g.position.z += (p.z - g.position.z) * k
    this.yaw = this.placed && !far ? this.yaw + angleDelta(this.yaw, p.yaw) * k : p.yaw
    this.vy = this.placed ? this.vy + ((g.position.y - prevY) / Math.max(dt, 1e-3) - this.vy) * Math.min(1, dt * 10) : 0
    this.placed = true

    const act = p.act || ''
    const bench = act === 'bench'
    const chuting = act === 'chute'
    const impacting = act === 'impact'
    g.rotation.set(bench ? -Math.PI / 2 : 0, this.yaw, 0)
    this.target.facing = this.yaw
    this.repT = (this.repT + dt) % GYM.repEvery
    const grounded = !chuting && Math.abs(this.vy) < 1.5

    // The act changed: open / land the parachute, take the landing (a hard one the further they fell).
    const vol = clamp01(1 - d / 60)
    if (!grounded || !this.placed) this.apexY = Math.max(this.apexY, g.position.y)
    else this.apexY = g.position.y
    if (this.act !== null && act !== this.act) {
      if (chuting) {
        this.canopy ??= makeCanopy({ scene: this.ctx.scene, holder: g, feet: () => g.position, fx: this.ctx.fx, snd })
        this.flare = 0
        this.canopy.deploy(null, vol)
      } else if (this.act === 'chute') this.canopy?.land()
      if (impacting) {
        const v = Math.sqrt(2 * 22 * Math.max(0, this.apexY - g.position.y))
        this.ctx.impactFx.land(this.target, clamp01((v - ROBOT.impact.minVy) / ROBOT.impact.range), this.gear.tagScale, ROBOT_GEAR.find((g) => g.id === p.gear)?.glow ?? '#ffffff', { vol, shakeK: clamp01(1 - d / 25) * 0.5, big: false })
      } else if (this.act === 'impact') this.ctx.impactFx.rise(this.target, this.gear.tagScale, vol)
    }
    this.act = act
    this.impactDepth += ((impacting ? 1 : 0) - this.impactDepth) * Math.min(1, dt * (impacting ? 25 : 6))
    if (chuting) this.flare += (flareFor(groundBelowAt(g.position.x, g.position.y, g.position.z)) - this.flare) * Math.min(1, dt * 7)
    else this.flare = 0
    const dYaw = angleDelta(this.lastYaw ?? this.yaw, this.yaw)
    this.lastYaw = this.yaw
    this.yawRate += (Math.max(-6, Math.min(6, dYaw / Math.max(dt, 1e-3))) - this.yawRate) * Math.min(1, dt * 6)
    this.canopy?.update(dt, elapsed, { size: 1, flare: this.flare, yawRate: this.yawRate, speed: p.speed, loops: false })

    // Spider Arms carry the body, so the legs hang still (as on the pilot).
    const idle = this.gear.legsIdle
    this.animator?.update(dt, {
      grounded: idle || grounded,
      speed: idle ? 0 : p.speed,
      verticalVelocity: idle ? 0 : this.vy,
      turn: 0,
      activity: bench ? 'bench' : chuting ? 'chute' : this.impactDepth > 0.01 ? 'impact' : null,
      flare: this.flare,
      impact: this.impactDepth,
      rep: Math.sin((this.repT / GYM.repEvery) * Math.PI),
    })
    this.gear.update(dt, elapsed, { act, speed: p.speed, vy: this.vy, grounded, yaw: this.yaw })
    this.anchor.position.set(g.position.x, g.position.y, g.position.z)
    this.tag.sprite.position.set(g.position.x, g.position.y + (bench ? TAG_Y_BENCH : TAG_Y * this.gear.tagScale), g.position.z)
  }

  async playEmote(id) {
    const clip = await clipFor(id)
    if (clip) this.channel.play(clip)
  }

  setVisible(on) {
    this.group.visible = on
    this.anchor.visible = on
    this.tag.sprite.visible = on
  }

  dispose() {
    this.generation++ // drop an avatar load in flight
    this.anchor.userData.bubble?.remove?.() // chatBubbles.js
    this.anchor.userData.bubble = null
    this.root.remove(this.group, this.anchor, this.tag.sprite)
    disposeAnimator(this.animator)
    this.gear.dispose()
    this.canopy?.dispose()
    this.tag.sprite.material.map?.dispose()
    this.tag.sprite.material.dispose()
  }
}

// fx: the shared effects (fx.js); impactFx: the shared superhero-landing effects (robots.impactFx).
export function createRemotePlayers(scene, { fx, impactFx }) {
  const ctx = { scene, fx, impactFx }
  const root = new Group()
  root.name = 'remotePlayers'
  scene.add(root)
  const remotes = new Map() // sessionId -> Remote
  const byUidMap = new Map() // normalised uid -> sessionId (rebuilt each frame)
  const emoteSeen = new Map() // sessionId -> the last emoteAt observed (baseline on first sight)
  const near = []

  return {
    get count() {
      return remotes.size
    },
    // The remote's anchor (an unrotated Object3D at their feet: bubbles hang here), or null.
    anchorByUid(uid) {
      const id = byUidMap.get(normId(uid))
      return (id && remotes.get(id)?.anchor) || null
    },
    update(dt, _t, viewer) {
      const players = roster()
      if (!players) {
        for (const r of remotes.values()) r.dispose()
        remotes.clear()
        byUidMap.clear()
        emoteSeen.clear()
        return
      }
      const mine = mySessionId()
      const myId = myUid()
      near.length = 0
      const present = new Set()
      players.forEach((p, id) => {
        present.add(id)
        if (id === mine || (myId && normId(p.uid) === myId)) return
        // The first emoteAt seen is a baseline (an emote from before we looked is not replayed);
        // a later change is a new emote (or a stop) and is acted on below, drawn or not.
        const seen = emoteSeen.get(id)
        emoteSeen.set(id, p.emoteAt)
        const fresh = seen !== undefined && seen !== p.emoteAt
        const r = remotes.get(id)
        if (fresh && r) {
          if (p.emote) void r.playEmote(p.emote)
          else r.channel.stop()
        }
        near.push({ id, p, d: Math.hypot(p.x - viewer.x, p.z - viewer.z) })
      })
      for (const id of emoteSeen.keys()) if (!present.has(id)) emoteSeen.delete(id)

      // Nearest first, capped, so a full room does not drown the frame rate.
      near.sort((a, b) => a.d - b.d)
      const keep = new Set()
      byUidMap.clear()
      for (const { id, p, d } of near.slice(0, NET.maxRemotes)) {
        keep.add(id)
        let r = remotes.get(id)
        if (!r) remotes.set(id, (r = new Remote(root, ctx)))
        if (p.uid) byUidMap.set(normId(p.uid), id)
        const visible = d < NET.remoteRange
        r.setVisible(visible)
        if (visible) r.update(p, dt, _t, d)
        else {
          r.placed = false // out of range: skip the work, snap into place when it comes back
          r.group.position.set(p.x, p.y, p.z)
        }
      }
      for (const [id, r] of remotes) {
        if (keep.has(id)) continue
        r.dispose()
        remotes.delete(id)
      }
    },
  }
}
