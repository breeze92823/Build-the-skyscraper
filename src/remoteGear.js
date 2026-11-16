import { Vector3 } from 'three'
import { ROBOT, ROBOT_GEAR } from './config.js'
import { wearGear } from './gear.js'
import { makeVehicle } from './vehicles.js'

// Another player's Robot Gear (remotePlayers.js): what they wear (their `gear` id from the roster) and what
// the gear does while they play their pose `act` ("fly", "climb", "vehicle", "jet"; backend POSE_ACTS).
// The same models as ours (gear.js wearGear, vehicles.js makeVehicle) but driven from the relayed pose:
//  - the piece is put on the avatar (a suit-up when they change gear in front of us, straight on otherwise),
//  - thrusters light up and spit sparks while they fly, with the same lean / bank / hover as ours,
//  - Spider Arms carry the body on their legs and claw up the tower wall on "climb",
//  - transformers show their vehicle on "vehicle" / "jet" (the transform itself is not replayed: the robot
//    is simply swapped for the finished vehicle),
//  - giant suits step aside on the gym bench.
// No sounds (those are ours alone). The parachute and the landing crouch belong to remotePlayers.js.

const SP = ROBOT.spring
const CL = ROBOT.climb
const FLAME = ['#ffd27a', '#ff8a1a', '#fff6d8']
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const gearDef = (id) => ROBOT_GEAR.find((g) => g.id === id) ?? null
const tmp3 = new Vector3() // scratch for world positions (Object3D.getWorldPosition fills it)

// body: the group the avatar lives in (this module lifts / leans it); fx: the shared effects.
export function createRemoteGear({ body, fx }) {
  let avatar = null
  let id = '' // the piece we show (or are putting on)
  let worn = null
  let wornAvatar = null
  let suit = null // { k } while the armour flies on
  let seen = false // false until the first gear id arrives: that one is put on without the show
  let vehicle = null
  let vehicleKind = ''
  let form = 'robot'
  let size = 1
  let carryLift = 0
  let climbBlend = 0
  let climbPhase = 0
  let stepPhase = 0
  let trailT = 0
  let exhaustT = 0
  let lastSpeed = 0
  let lastYaw = null
  let accel = 0
  let yawRate = 0
  const pose = { pitch: 0, roll: 0, steer: 0 }

  function dropWorn() {
    worn?.remove()
    worn = null
    wornAvatar = null
  }
  function putOn(next, animate) {
    dropWorn()
    if (!avatar || !next) return
    worn = wearGear(avatar, next, { merge: !animate })
    wornAvatar = avatar
    if (animate) {
      worn.assemble(0)
      suit = { k: 0 }
      const def = gearDef(next)
      fx.sparks(body.parent.position.x, body.parent.position.y + 1.2, body.parent.position.z, { count: 24, colors: [def?.glow ?? '#ffffff', '#ffffff'], speed: 6, size: 0.4 })
      fx.ring(body.parent.position.x, body.parent.position.y + 0.1, body.parent.position.z, 0.5, 5 * (def?.size ?? 1), def?.glow ?? '#ffffff', 0.8)
    }
  }

  function setForm(next, def) {
    if (next === form) return
    form = next
    const g = body.parent
    if (next === 'vehicle') {
      if (!vehicle || vehicleKind !== def?.vehicle) {
        if (vehicle) body.remove(vehicle.group)
        vehicleKind = def?.vehicle ?? ''
        vehicle = vehicleKind ? makeVehicle(vehicleKind, ROBOT.vehicleScale[vehicleKind] ?? 0.55, { display: true }) : null
        if (vehicle) body.add(vehicle.group)
      }
      if (vehicle) vehicle.flash()
    }
    if (vehicle) vehicle.group.visible = next === 'vehicle'
    if (avatar) avatar.visible = next !== 'vehicle'
    worn?.setVisible(next !== 'vehicle')
    // A puff where the robot and the vehicle swap.
    fx.sparks(g.position.x, g.position.y + 1.2, g.position.z, { count: 20, colors: [def?.glow ?? '#ffffff', '#ffffff', '#ffd23a'], speed: 6, size: 0.4 })
    fx.ring(g.position.x, g.position.y + 0.2, g.position.z, 0.6, 6, def?.glow ?? '#ffffff', 0.6)
  }

  return {
    // How tall the worn robot stands compared with the avatar (the name tag's height).
    get tagScale() {
      return form === 'robot' ? size + carryLift / 2.5 : 1.3
    },
    // Spider Arms carry the body: its own legs hang still.
    get legsIdle() {
      return form === 'robot' && !!worn && !!gearDef(id)?.carry && !suit
    },
    // The avatar was swapped (loaded / changed): dress the new one.
    setAvatar(next) {
      avatar = next
      if (form === 'vehicle') next.visible = false
      if (id) putOn(id, false)
    },
    setId(next) {
      next = next || ''
      if (next === id && (seen || !next)) return
      const first = !seen
      seen = true
      id = next
      suit = null
      if (form !== 'robot') setForm('robot', null)
      if (vehicle) {
        body.remove(vehicle.group)
        vehicle = null
        vehicleKind = ''
      }
      if (!next) {
        if (worn) {
          const g = body.parent
          fx.sparks(g.position.x, g.position.y + 1.2, g.position.z, { count: 14, colors: ['#ffffff', '#bfefff'], speed: 4, size: 0.3, life: 0.4 })
        }
        dropWorn()
        return
      }
      putOn(next, !first)
    },
    // p: { act, speed (horizontal m/s), vy, grounded, yaw }
    update(dt, elapsed, p) {
      const def = gearDef(id)
      if (!worn && id && avatar) putOn(id, false) // the avatar was rebuilt without us noticing
      if (worn && wornAvatar !== avatar) putOn(id, false)

      // The armour flying on.
      if (suit && worn) {
        suit.k += dt / ROBOT.suitUp
        worn.assemble(clamp(suit.k, 0, 1))
        worn.landed()
        if (suit.k >= 1) {
          suit = null
          worn.finalize()
        }
      }

      const act = p.act
      const wantForm = (act === 'vehicle' || act === 'jet') && def?.vehicle && !suit ? 'vehicle' : 'robot'
      setForm(wantForm, def)
      worn?.setPiloted(act !== 'bench')
      size = worn && form === 'robot' && act !== 'bench' ? worn.size : 1

      const speed = p.speed ?? 0
      const a = (speed - lastSpeed) / Math.max(dt, 1e-3)
      accel += (clamp(a, -60, 60) - accel) * Math.min(1, dt * 8)
      lastSpeed = speed
      if (lastYaw !== null) {
        const dy = Math.atan2(Math.sin(p.yaw - lastYaw), Math.cos(p.yaw - lastYaw)) / Math.max(dt, 1e-3)
        yawRate += (clamp(dy, -8, 8) - yawRate) * Math.min(1, dt * 8)
      }
      lastYaw = p.yaw
      const k = Math.min(1, dt * 12)

      const climbing = act === 'climb'
      climbBlend += ((climbing ? 1 : 0) - climbBlend) * Math.min(1, dt * 6)
      if (climbing) climbPhase += (dt * (Math.abs(p.vy) + speed) * Math.PI) / CL.gait
      const carry = !!def?.carry && form === 'robot' && !!worn && !suit
      if (form === 'robot' && p.grounded && speed > 0.5) stepPhase += (dt * speed * Math.PI) / (carry ? 3.2 : ROBOT.stride * size * 0.6)
      const flying = act === 'fly'
      const thrust = flying ? 0.85 : 0

      if (worn) {
        worn.update(dt, {
          t: elapsed,
          thrust,
          building: false,
          speed: p.grounded ? speed : 0,
          step: climbing ? climbPhase : stepPhase,
          moving: climbing ? Math.abs(p.vy) > 0.5 || speed > 0.5 : p.grounded && speed > 0.8,
          climb: climbBlend,
        })
      }

      // Spider Arms: lift the body until the lowest claw rests on the ground.
      if (carry && climbBlend < 0.5) {
        let low = Infinity
        for (const c of worn.points.claws) {
          c.getWorldPosition(tmp3)
          if (tmp3.y < low) low = tmp3.y
        }
        const ground = body.parent.position.y
        if (low !== Infinity) carryLift += (clamp(ground - low + 0.15, 0, 9) - carryLift) * Math.min(1, dt * 6)
      } else carryLift += (0 - carryLift) * Math.min(1, dt * 6)
      body.position.y = carryLift + (carry && speed > 0.8 && p.grounded ? Math.abs(Math.sin(stepPhase)) * ROBOT.carry.bob : 0)

      // Lean, bank and hover like the pilot does.
      if (form === 'robot') {
        const pitchT = flying ? clamp(speed * SP.flyLean, 0, SP.maxFlyLean) : clamp(speed * 0.004 + accel * 0.006, -0.08, 0.16)
        const rollT = flying ? clamp(-yawRate * 0.35, -0.5, 0.5) : clamp(-yawRate * speed * 0.004, -0.12, 0.12)
        pose.pitch += (pitchT - pose.pitch) * k
        pose.roll += (rollT - pose.roll) * k
        body.rotation.set(pose.pitch + 0.12 * climbBlend, 0, pose.roll + Math.sin(climbPhase) * 0.05 * climbBlend)
        if (flying && speed < 3) body.position.y += Math.sin(elapsed * 2.2) * 0.12
      } else if (vehicle) {
        const jet = act === 'jet'
        const pitchT = jet ? clamp(-p.vy * 0.03, -0.45, 0.45) : clamp(-accel * SP.pitchPerAccel, -0.12, 0.12)
        const rollT = jet ? clamp(-yawRate * 0.5, -0.7, 0.7) : clamp(yawRate * speed * SP.rollPerLateral * 0.5, -0.12, 0.12)
        pose.pitch += (pitchT - pose.pitch) * k
        pose.roll += (rollT - pose.roll) * k
        pose.steer += (clamp(yawRate * SP.steer, -SP.maxSteer, SP.maxSteer) - pose.steer) * Math.min(1, dt * 10)
        body.rotation.set(0, 0, 0)
        vehicle.update(dt, {
          speed,
          steer: pose.steer,
          pitch: pose.pitch,
          roll: pose.roll,
          heave: 0,
          airborne: jet,
          thrust: jet ? 1 : 0,
        })
        // Exhaust smoke / the jet's flame.
        exhaustT -= dt
        if (exhaustT <= 0) {
          exhaustT = jet ? 0.045 : 0.16
          const marks = jet ? vehicle.points.flames : vehicle.points.exhaust
          for (const m of marks.slice(0, 4)) {
            if (jet && !m.visible) continue
            m.getWorldPosition(tmp3)
            if (jet) fx.sparks(tmp3.x, tmp3.y - 0.15, tmp3.z, { count: 2, speed: 2.2, up: -8, gravity: -2, drag: 2.2, size: 0.45, life: 0.35, colors: FLAME, intensity: 3.6 })
            else fx.dust(tmp3.x, tmp3.y, tmp3.z, { count: 1, size: 0.3, grow: 3.5, life: 1.2, color: '#4a4d54', alpha: 0.3, rise: 1.6, spread: 0.05, push: 0.2, height: 0 })
          }
        }
      }

      // Thruster sparks and smoke.
      trailT -= dt
      if (form === 'robot' && worn && thrust > 0.04 && trailT <= 0) {
        trailT = ROBOT.trail
        const flames = worn.points.flames
        for (let i = 0; i < flames.length && i < 6; i++) {
          const f = flames[i]
          if (!f.visible) continue
          f.getWorldPosition(tmp3)
          fx.sparks(tmp3.x, tmp3.y - 0.15, tmp3.z, { count: 2, speed: 2.2, up: -6 * thrust - 2, gravity: -2, drag: 2.2, size: 0.38 * size, life: 0.35, colors: FLAME, intensity: 3.6 })
        }
      }
    },
    dispose() {
      dropWorn()
      if (vehicle) body.remove(vehicle.group)
      vehicle = null
    },
  }
}
