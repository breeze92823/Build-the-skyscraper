import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3 } from 'three'
import { ROBOT } from './config.js'
import * as S from './stats.js'
import { makeDropship, makePod, makeVehicle, wearGear } from './gear.js'
import { robot as snd, sfx } from './audio/index.js'
import { inputState, onKey } from './input.js'
import { flash } from './juice.js'

// The local player's Robot Gear: buying / wearing at the hall pedestals (E or tap the prompt),
// the suit-up (a beam of light, every armour piece flying in and locking on with a clank and
// sparks, a power chord and the stats popping up), and what the gear does while worn:
//  - the mech suits make you bigger (`scale`) and stomp (dust + thuds),
//  - Jet Boots, the Black Mech Suit and Titan Armor fly (hold Jump), with thruster flames, spark
//    and smoke trails, a take-off blast and a landing slam,
//  - Robotic Arms walk on their claws and weld sparks while you build; gauntlets spark at work,
//  - G / the touch gear button: transformers turn into their vehicle (the Jet Transformer flies),
//    Titan Armor calls a dropship that drops the armour in a pod with a ground slam and a timed
//    build-speed boost.

const { state } = S
const easeOut = (t) => 1 - Math.pow(1 - t, 3)
const backOut = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)
const clamp01 = (t) => Math.max(0, Math.min(1, t))
const FLAME = ['#ffd27a', '#ff8a1a', '#fff6d8']

export function createRobotPlayer({ scene, hall, interact, hud, fx, say, player, playerGroup, getAvatar, popAtPlayer }) {
  // --- Worn gear on the avatar (rebuilt when the avatar is swapped) ----------------------------------
  let worn = null
  let wornAvatar = null
  let wornId = null
  let suit = null // { k, dur, off }
  let landedCount = 0
  let bodyScale = 1

  // Beam of light for the suit-up, and the Titan boost aura.
  const pillarMat = new MeshBasicMaterial({ color: '#7dffe4', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
  const pillar = new Mesh(new CylinderGeometry(1.5, 1.9, 16, 28, 1, true), pillarMat)
  pillar.visible = false
  scene.add(pillar)
  const auraMat = new MeshBasicMaterial({ color: '#ff3a3a', transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
  const aura = new Mesh(new RingGeometry(1.1, 1.7, 40), auraMat)
  aura.rotation.x = -Math.PI / 2
  aura.visible = false
  scene.add(aura)

  function dropWorn() {
    worn?.remove()
    worn = null
    wornAvatar = null
    wornId = null
  }
  // k = assembly progress to start at; merged = straight to the final (merged) model.
  function putOn(id, k = 1, merged = false) {
    const av = getAvatar()
    if (!av || !id) return
    worn = wearGear(av, id, { merge: merged })
    wornAvatar = av
    wornId = id
    if (!merged) worn.assemble(k)
  }
  const chest = () => {
    const p = player.renderPosition
    return [p.x, p.y + 1.2 * bodyScale, p.z]
  }

  function startSuitUp(def, dur = ROBOT.suitUp) {
    suit = { k: 0, dur, off: false }
    landedCount = 0
    pillarMat.color.set(def.glow)
    pillar.visible = true
    snd.suitStart()
    const [x, y, z] = chest()
    fx.ring(x, y - 1.1, z, 0.5, 5, def.glow, 0.8)
    fx.sparks(x, y, z, { count: 30, colors: [def.glow, '#ffffff'], speed: 6, size: 0.4 })
  }
  function finishSuitUp(def) {
    snd.powerUp()
    const [x, y, z] = chest()
    fx.sparks(x, y + 0.4, z, { count: 70, colors: [def.glow, def.color, '#ffffff'], speed: 9, size: 0.55, life: 1.2 })
    fx.ring(x, y - 1.1, z, 1, 9, def.glow, 0.9)
    hud.banner(`${def.name.toUpperCase()} EQUIPPED!`, def.glow, 2.6)
    const chips = [`${def.blocks}x Blocks Placed`, `${def.build}x Build Speed`, `+${def.walk} Walk Speed`, `+${S.short(def.capacity)} Capacity`]
    chips.forEach((c, i) => setTimeout(() => popAtPlayer(c, i % 2 ? '#7dffe4' : '#ffd23a', true), 120 + i * 220))
    const tips = []
    if (def.fly) tips.push('Hold Jump to fly!')
    if (def.ability === 'drop') tips.push('G / the gear button calls the dropship!')
    else if (def.ability) tips.push('G / the gear button to transform!')
    if (tips.length) setTimeout(() => say(tips.join(' '), true), 1100)
  }

  // Gear changed (bought, worn, taken off), from the pedestals or anywhere else.
  S.on('gear', (id) => {
    hall.refresh()
    S.boosts.gearBuild = 1
    boostT = 0
    if (form !== 'robot' || tf) toRobot(true)
    if (id) {
      dropWorn()
      putOn(id, 0)
      startSuitUp(S.gearDef(id))
    } else if (worn) {
      // Take-off: rebuild unmerged so the pieces can fly away.
      const was = wornId
      dropWorn()
      putOn(was, 1)
      suit = { k: 1, dur: 0.5, off: true }
      snd.powerDown()
    }
  })

  // --- Pedestals -----------------------------------------------------------------------------------------
  for (const p of hall.pedestals) {
    const d = p.def
    interact.add({
      x: p.x,
      z: p.z,
      y: p.top + 1.2,
      r: p.r + 3,
      info() {
        const owned = !!state.gear.owned[d.id]
        if (state.gear.on === d.id) return { title: d.name, verb: 'Take Off' }
        if (owned) return { title: d.name, verb: 'Wear' }
        return { title: d.name, verb: 'Buy', price: `$${S.short(d.price)}`, short: state.cash < d.price }
      },
      run() {
        if (!state.gear.owned[d.id]) {
          const r = S.buyGear(d.id)
          if (r.need) {
            sfx.deny()
            hud.shake('cash')
            say(`Need $${S.short(r.need)} more!`, false)
          } else if (r.done) {
            sfx.purchase()
            flash('gold')
            say(`${d.name} unlocked!`, true)
          }
          return
        }
        S.wearGear(d.id)
      },
    })
  }

  // --- Transform (robot <-> vehicle) ----------------------------------------------------------------------
  let form = 'robot'
  let tf = null // { t, to, avatar, scale }
  let vehicle = null
  const vehicleHolder = new Group()
  playerGroup.add(vehicleHolder)
  let lastFacing = player.facing
  let bank = 0

  function startTransform(toVehicle) {
    const def = S.gearOn()
    if (!def?.vehicle) return
    const av = getAvatar()
    tf = { t: 0, to: toVehicle ? 'vehicle' : 'robot', avatar: av, scale: av ? av.scale.x : 1 }
    if (toVehicle) {
      vehicle = makeVehicle(def.vehicle, ROBOT.vehicleScale[def.vehicle] ?? 0.55)
      vehicle.kind = def.vehicle
      vehicle.group.scale.setScalar(0.01)
      vehicleHolder.add(vehicle.group)
    }
    snd.transform(toVehicle)
    const [x, y, z] = chest()
    fx.sparks(x, y, z, { count: 40, colors: [def.glow, '#ffffff', '#ffd23a'], speed: 7, size: 0.45 })
    fx.ring(x, y - 1.1, z, 0.6, 6, def.glow, 0.6)
  }
  // Back to the robot; `now` skips the animation (elevator, gym, gear change).
  function toRobot(now = false) {
    if (now) {
      if (tf?.avatar) tf.avatar.scale.setScalar(tf.scale)
      tf = null
      if (vehicle) vehicleHolder.remove(vehicle.group)
      vehicle = null
      form = 'robot'
      const av = getAvatar()
      if (av) av.visible = true
      player.fly = null
      return
    }
    startTransform(false)
  }

  // --- Titan Armor: the dropship --------------------------------------------------------------------------
  let drop = null // { phase, t, ship, pod, from }
  let dropCd = 0
  let boostT = 0
  const hover = new Vector3()
  function callDropship() {
    if (drop) return
    if (dropCd > 0) {
      sfx.deny()
      say(`Dropship ready in ${Math.ceil(dropCd)}s`, false)
      return
    }
    dropCd = ROBOT.drop.cooldown
    const ship = makeDropship()
    scene.add(ship.group)
    const pod = makePod()
    pod.visible = false
    scene.add(pod)
    const p = player.position
    drop = { phase: 'in', t: 0, ship, pod, from: new Vector3(p.x - 110, p.y + 90, p.z - 70) }
    snd.shipIn()
    hud.banner('DROPSHIP INCOMING!', '#ff3a3a', 2)
  }
  function updateDrop(dt) {
    if (!drop) return
    const P = player.renderPosition
    hover.set(P.x, P.y + 15, P.z)
    const D = ROBOT.drop
    const ship = drop.ship.group
    drop.t += dt
    drop.ship.update(dt)
    if (drop.phase === 'in') {
      const k = clamp01(drop.t / D.hover)
      const e = easeOut(k)
      ship.position.lerpVectors(drop.from, hover, e)
      ship.rotation.set(0.25 * (1 - e), Math.atan2(hover.x - drop.from.x, hover.z - drop.from.z), Math.sin(drop.t * 2) * 0.05)
      if (k >= 1) {
        drop.phase = 'release'
        drop.t = 0
        // The armour goes into the pod.
        if (wornId === 'titan') dropWorn()
        drop.pod.visible = true
        snd.podFall()
      }
    } else if (drop.phase === 'release') {
      ship.position.copy(hover)
      ship.position.y += Math.sin(drop.t * 3) * 0.2
      const k = clamp01(drop.t / D.fallTime)
      drop.pod.position.set(P.x, hover.y - 1.8 - (hover.y - 1.8 - P.y) * k * k, P.z)
      drop.pod.rotation.y = drop.t * 6
      if (Math.random() < dt * 30) fx.sparks(P.x, drop.pod.position.y + 2.8, P.z, { count: 2, colors: ['#ff3a3a', '#ffd23a'], speed: 1.5, up: 3, size: 0.45, life: 0.5 })
      if (k >= 1) {
        drop.phase = 'out'
        drop.t = 0
        drop.pod.visible = false
        // Ground slam.
        snd.slam()
        flash('edge')
        fx.ring(P.x, P.y + 0.25, P.z, 1, 16, '#ff3a3a', 0.9)
        fx.ring(P.x, P.y + 0.3, P.z, 0.5, 10, '#ffd23a', 0.7)
        fx.sparks(P.x, P.y + 0.6, P.z, { count: 90, colors: ['#ff3a3a', '#ffd23a', '#ffffff'], speed: 12, size: 0.6, flat: true })
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          fx.dust(P.x + Math.cos(a) * 2.5, P.y + 0.1, P.z + Math.sin(a) * 2.5, { count: 4, size: 2.2, grow: 2.2, life: 1.4, spread: 1, push: 4, alpha: 0.5 })
        }
        if (state.gear.on === 'titan') {
          dropWorn()
          putOn('titan', 0)
          suit = { k: 0, dur: 0.75, off: false }
          landedCount = 0
        }
        S.boosts.gearBuild = D.boost
        boostT = D.boostTime
        hud.banner(`TITAN POWER! ${D.boost}x BUILD SPEED`, '#ff3a3a', 2.8)
      }
    } else {
      const k = drop.t / 2.4
      ship.position.copy(hover).add(new Vector3(40 * k * k, 70 * k * k, 30 * k * k))
      ship.rotation.x = -0.3 * k
      if (k >= 1) {
        scene.remove(ship)
        scene.remove(drop.pod)
        drop = null
      }
    }
  }

  // --- Ability (G / touch gear button) ---------------------------------------------------------------------
  function ability() {
    const def = S.gearOn()
    if (!def?.ability) {
      if (def?.fly) say(`${def.name}: hold Jump to fly!`, true)
      else if (def) say(`${def.name} has no special move. Transformers and Titan Armor do!`, false)
      return
    }
    if (suit) return
    if (def.ability === 'drop') return callDropship()
    if (tf) return
    if (player.locked) {
      say("You can't transform here!", false)
      sfx.deny()
      return
    }
    startTransform(form === 'robot')
  }
  onKey('KeyG', ability)

  // Key hints (desktop, in the HUD's key list) and the touch button's label.
  const keyList = document.querySelector('.hud-keys')
  const hint = document.createElement('div')
  hint.hidden = true
  hint.innerHTML = '<b>G</b> <span></span>'
  const flyHint = document.createElement('div')
  flyHint.hidden = true
  flyHint.innerHTML = '<b>Space</b> Hold to fly'
  keyList?.prepend(hint, flyHint)
  const hintText = hint.querySelector('span')
  let shownHint = ''
  function updateHint() {
    const def = S.gearOn()
    let text = ''
    let short = ''
    if (def?.ability === 'drop') {
      text = dropCd > 0 ? `Titan Drop (${Math.ceil(dropCd)}s)` : 'Titan Drop'
      short = dropCd > 0 ? `${Math.ceil(dropCd)}s` : 'DROP'
    } else if (def?.ability) {
      const jet = def.ability === 'fly'
      text = form === 'vehicle' ? 'Robot Mode' : jet ? 'Jet Mode' : 'Transform'
      short = form === 'vehicle' ? 'ROBOT' : jet ? 'JET' : 'DRIVE'
    }
    const canFly = !!player.fly
    const key = `${text}|${short}|${canFly}`
    if (key === shownHint) return
    shownHint = key
    hint.hidden = !text
    hintText.textContent = text
    flyHint.hidden = !canFly
    document.body.classList.toggle('gear-ability', !!text)
    const btn = document.querySelector('.touch-btn.ability')
    if (btn) btn.textContent = short || 'G'
  }

  // --- Particles ---------------------------------------------------------------------------------------------
  const v = new Vector3()
  let trailT = 0
  let smokeN = 0
  let stepAcc = 0
  let stepIdx = 0
  let stepPhase = 0
  let workT = 0
  let speedT = 0
  let wasGrounded = true
  let airTime = 0
  let lastAir = 0
  function thrusterTrail(dt, thrust) {
    trailT -= dt
    if (trailT > 0 || !worn) return
    trailT = ROBOT.trail
    smokeN++
    const flames = worn.points.flames
    for (let i = 0; i < flames.length && i < 6; i++) {
      const f = flames[i]
      if (!f.visible) continue
      f.getWorldPosition(v)
      fx.sparks(v.x, v.y - 0.15, v.z, { count: thrust > 0.7 ? 3 : 1, speed: 2.2, up: -6 * thrust - 2, gravity: -2, drag: 2.2, size: 0.38 * bodyScale, life: 0.35, colors: FLAME, intensity: 3.6 })
      if (smokeN % 3 === 0) fx.dust(v.x, v.y - 0.5, v.z, { count: 1, size: 0.45 * bodyScale, grow: 3, life: 0.9, color: '#dfe3e8', alpha: 0.26, rise: 0.4, spread: 0.1, push: 0.25, height: 0 })
    }
  }
  function burstAtFeet(color, n, big) {
    const P = player.renderPosition
    fx.ring(P.x, P.y + 0.15, P.z, 0.4, big ? 6 : 4, color, 0.5)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      fx.dust(P.x + Math.cos(a) * 0.8, P.y + 0.05, P.z + Math.sin(a) * 0.8, { count: 2, size: 1.1 * bodyScale, grow: 2.2, life: 0.9, spread: 0.3, push: 3, alpha: 0.4, color: '#d9c7ad', height: 0 })
    }
  }
  function footDust(n = 3) {
    const feet = worn?.points.feet
    if (!feet?.length) return
    const f = feet[stepIdx++ % feet.length]
    f.getWorldPosition(v)
    fx.dust(v.x, v.y, v.z, { count: n, size: 0.8 * bodyScale, grow: 2.4, life: 0.8, spread: 0.4, push: 1.6, alpha: 0.4, color: '#d2bfa3', height: 0 })
  }
  function sparkAt(list, colors, count = 4) {
    if (!list?.length) return
    const o = list[Math.floor(Math.random() * list.length)]
    o.getWorldPosition(v)
    fx.sparks(v.x, v.y, v.z, { count, colors, speed: 4, size: 0.3, life: 0.4, intensity: 3.5 })
  }

  // --- Per frame ------------------------------------------------------------------------------------------------
  let refreshT = 0
  const flyCache = new Map()
  const flyParams = (def) => flyCache.get(def.id) ?? flyCache.set(def.id, { climb: def.fly.climb, sink: def.fly.sink, accel: ROBOT.flyAccel, maxY: ROBOT.flyMaxY }).get(def.id)
  return {
    ability,
    get form() {
      return form
    },
    // Walk speed multiplier (vehicle form is faster).
    speedMul: () => (form === 'vehicle' && !tf ? ROBOT.vehicleSpeed : 1),
    // How much bigger the body is right now (name tag height).
    bodyScale: () => bodyScale,
    // ctx: { building, collecting, training }
    update(dt, elapsed, ctx = {}) {
      const av = getAvatar()
      // The avatar was swapped (avatar loaded / changed): dress the new one, no animation.
      if (worn && wornAvatar !== av) {
        const id = wornId
        dropWorn()
        if (!suit?.off) putOn(id, 1, true)
        suit = null
      } else if (!worn && state.gear.on && av && !suit && drop?.phase !== 'release') putOn(state.gear.on, 1, true)

      // Suit-up / take-off animation.
      if (suit && worn) {
        suit.k += (suit.off ? -dt : dt) / suit.dur
        worn.assemble(clamp01(suit.k))
        const n = worn.landed()
        for (let i = 0; i < n; i++) {
          snd.lockIn(landedCount++)
          const [x, y, z] = chest()
          fx.sparks(x + (Math.random() - 0.5) * 1.2 * bodyScale, y + (Math.random() - 0.3) * 1.4 * bodyScale, z + (Math.random() - 0.5) * 1.2 * bodyScale, { count: 8, colors: [S.gearDef(wornId)?.glow ?? '#ffffff', '#ffffff'], speed: 4, size: 0.3, life: 0.5 })
        }
        if (!suit.off && suit.k >= 1) {
          const def = S.gearDef(wornId)
          suit = null
          worn.finalize()
          if (def) finishSuitUp(def)
        } else if (suit?.off && suit.k <= 0) {
          suit = null
          dropWorn()
        }
      }
      // Beam fades out over the suit-up.
      if (pillar.visible) {
        const k = suit && !suit.off ? suit.k : 1.2
        pillarMat.opacity = Math.max(0, 0.55 * (1 - Math.max(0, k - 0.6) / 0.6)) * (0.8 + Math.sin(elapsed * 30) * 0.2)
        const P = player.renderPosition
        pillar.position.set(P.x, P.y + 8, P.z)
        pillar.scale.set(1 + Math.sin(elapsed * 8) * 0.06, 1, 1 + Math.sin(elapsed * 8) * 0.06)
        if (pillarMat.opacity <= 0.001) pillar.visible = false
      }

      // Riding the elevator / on a gym machine: back to the robot.
      if (player.locked && (form !== 'robot' || tf)) toRobot(true)

      // Transform animation.
      if (tf) {
        tf.t += dt / ROBOT.transformTime
        const t = clamp01(tf.t)
        const toV = tf.to === 'vehicle'
        const k = toV ? t : 1 - t // 0 = robot, 1 = vehicle
        if (tf.avatar) {
          tf.avatar.scale.setScalar(tf.scale * Math.max(0.05, 1 - k * 1.6))
          tf.avatar.visible = k < 0.6
        }
        if (vehicle) {
          const vk = clamp01((k - 0.3) / 0.7)
          vehicle.group.scale.setScalar(Math.max(0.01, toV ? backOut(vk) : vk))
          vehicleHolder.rotation.y = (1 - vk) * Math.PI * 1.5
        }
        if (tf.t >= 1) {
          if (tf.avatar) tf.avatar.scale.setScalar(tf.scale)
          form = tf.to
          if (form === 'robot') {
            if (vehicle) vehicleHolder.remove(vehicle.group)
            vehicle = null
            if (av) av.visible = true
          }
          vehicleHolder.rotation.y = 0
          tf = null
        }
      }
      if (form === 'vehicle' && !tf && av) av.visible = false

      // Body size: the mech suits are bigger (not in vehicle form or on a gym machine).
      const def = S.gearOn()
      const wantScale = form === 'vehicle' || ctx.training || !worn ? 1 : def?.scale ?? 1
      bodyScale += (wantScale - bodyScale) * Math.min(1, dt * 5)
      if (Math.abs(bodyScale - wantScale) < 0.002) bodyScale = wantScale
      playerGroup.scale.setScalar(bodyScale)
      vehicleHolder.scale.setScalar(1 / bodyScale)

      // Flying: the jet, or gear that flies in robot form.
      const jet = form === 'vehicle' && !tf && vehicle?.kind === 'jet'
      player.fly = jet ? ROBOT.fly : form === 'robot' && !tf && worn && def?.fly ? flyParams(def) : null

      // Thrusters, flight effects, footsteps, work sparks, engine sounds.
      const moving = Math.hypot(player.velocity.x, player.velocity.z)
      const airborne = !player.grounded
      airTime = airborne ? airTime + dt : 0
      let thrust = 0
      if (player.fly && form === 'robot') thrust = airborne ? (inputState.jumpHeld ? 1 : 0.5) : def?.id === 'jetboots' && inputState.sprint && moving > 2 ? 0.4 : 0
      else if (def?.id === 'jet' && form === 'robot') thrust = airborne ? 0.8 : 0
      if (form === 'robot' && player.grounded && moving > 0.5) stepPhase += (dt * moving * Math.PI) / (ROBOT.stride * bodyScale * 0.6)
      if (worn) worn.update(dt, { t: elapsed, thrust, building: !!ctx.building, speed: player.grounded ? moving : 0, step: stepPhase })
      if (form === 'robot' && thrust > 0.04) thrusterTrail(dt, thrust)
      // Take-off blast and landing slam for flying gear.
      if (player.fly && form === 'robot') {
        if (wasGrounded && airborne && player.velocity.y > 1) {
          burstAtFeet(def.glow, 8, false)
          snd.liftoff()
        }
        if (!wasGrounded && player.grounded && airTime === 0 && lastAir > 0.6) {
          burstAtFeet('#ffffff', 10, true)
          fx.sparks(player.renderPosition.x, player.renderPosition.y + 0.3, player.renderPosition.z, { count: 30, colors: [def.glow, '#ffffff'], speed: 7, size: 0.4, flat: true })
          snd.stomp(1.4)
        }
      }
      lastAir = airborne ? lastAir + dt : player.grounded && wasGrounded ? 0 : lastAir
      wasGrounded = player.grounded
      // Heavy mech footsteps (and the robotic arms' claws planting).
      if (form === 'robot' && worn && player.grounded && moving > 1 && (bodyScale > 1.2 || def?.id === 'arms')) {
        stepAcc += moving * dt
        if (stepAcc > ROBOT.stride * bodyScale) {
          stepAcc = 0
          if (def.id === 'arms') {
            const claws = worn.points.claws
            const c = claws[stepIdx++ % claws.length]
            c.getWorldPosition(v)
            fx.dust(v.x, Math.max(player.renderPosition.y, v.y - 0.3), v.z, { count: 2, size: 0.5, grow: 2, life: 0.6, spread: 0.2, push: 1, alpha: 0.35, color: '#d2bfa3', height: 0 })
            snd.clawStep()
          } else {
            footDust(4)
            snd.stomp(bodyScale)
          }
        }
      }
      // Work sparks: welding claws / gauntlets while building or grabbing blocks.
      workT -= dt
      if (worn && form === 'robot' && workT <= 0 && (ctx.building || ctx.collecting)) {
        if (def.id === 'arms' && ctx.building) {
          workT = 0.07
          sparkAt(worn.points.claws.slice(0, 2), ['#bff6ff', '#ffffff', '#7dffe4'], 4)
          snd.weld()
        } else if (worn.points.fists.length) {
          workT = 0.14
          sparkAt(worn.points.fists, [def.glow, '#ffd23a', '#ffffff'], 4)
        } else workT = 0.2
      }
      // Speed trail: glowing sparks off the feet when running fast in gear.
      speedT -= dt
      if (worn && form === 'robot' && player.grounded && moving > 14 && speedT <= 0) {
        speedT = 0.08
        const P = player.renderPosition
        fx.sparks(P.x, P.y + 0.15, P.z, { count: 2, colors: [def.glow, '#ffffff'], speed: 1.5, up: 0.8, size: 0.3, life: 0.45, flat: true })
      }
      snd.loop('thrust', form === 'robot' ? thrust * (player.fly ? 0.9 : 0.6) : 0, airborne ? 0.4 + (inputState.jumpHeld ? 0.5 : 0) : Math.min(1, moving / 30), dt)
      if (vehicle) {
        const turn = Math.atan2(Math.sin(player.facing - lastFacing), Math.cos(player.facing - lastFacing)) / Math.max(dt, 1e-3)
        bank += (Math.max(-0.5, Math.min(0.5, -turn * 0.12)) - bank) * Math.min(1, dt * 6)
        if (jet) {
          vehicle.group.rotation.set(Math.max(-0.5, Math.min(0.5, -player.velocity.y * 0.03)), 0, bank)
          vehicle.update(dt, { thrust: airborne ? 1 : moving > 1 ? 0.5 : 0.15 })
        } else {
          vehicle.group.rotation.set(0, 0, bank * 0.15)
          vehicle.update(dt, { thrust: 0 })
        }
      }
      lastFacing = player.facing
      const driving = form === 'vehicle' && vehicle && !tf
      snd.loop('diesel', driving && vehicle.kind !== 'jet' ? 0.35 + 0.65 * Math.min(1, moving / 35) : 0, Math.min(1, moving / 45), dt)
      snd.loop('jet', driving && vehicle.kind === 'jet' ? (airborne ? 0.85 : 0.35 + Math.min(0.4, moving / 60)) : 0, airborne ? 0.6 + Math.min(0.4, Math.abs(player.velocity.y) / 30) : Math.min(1, moving / 50), dt)

      // Titan dropship, boost and aura.
      if (dropCd > 0) dropCd = Math.max(0, dropCd - dt)
      updateDrop(dt)
      const dist = drop ? drop.ship.group.position.distanceTo(hover) : 999
      snd.loop('rotor', drop ? Math.max(0.15, 1 - dist / 140) : 0, 0.5, dt)
      if (boostT > 0) {
        boostT -= dt
        aura.visible = true
        const P = player.renderPosition
        aura.position.set(P.x, P.y + 0.08, P.z)
        aura.scale.setScalar((1 + Math.sin(elapsed * 6) * 0.12) * bodyScale)
        auraMat.opacity = 0.45 + Math.sin(elapsed * 10) * 0.2
        if (Math.random() < dt * 8) fx.sparks(P.x, P.y + 0.3, P.z, { count: 2, colors: ['#ff3a3a', '#ffd23a'], speed: 2, up: 3, size: 0.35, life: 0.6, spread: 1 })
        if (boostT <= 0) {
          S.boosts.gearBuild = 1
          aura.visible = false
          say('Titan Power faded. Call the dropship again soon!', true)
        }
      } else aura.visible = false

      refreshT -= dt
      if (refreshT <= 0) {
        refreshT = 0.25
        updateHint()
      }
    },
  }
}
