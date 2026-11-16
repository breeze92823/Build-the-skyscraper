import { inputState } from './input.js'
import { getYaw, syncYawToPlayer } from './camera.js'
import { isFirstPerson } from './modes.js'
import { RAPIER, alpha, onTick, world } from './physics.js'
import { PHYSICS, PLAYER_DIMS, SPAWN, SPAWN_FACING } from './config.js'

// The local player singleton, mutated in place. A kinematic Rapier capsule
// driven by Rapier's KinematicCharacterController: it slides along walls,
// autosteps small ledges, climbs slopes up to PHYSICS.maxSlope, snaps down
// steps and shoves dynamic bodies (crates, balls) with PHYSICS.pushMass.
// Gravity, jumping (with coyote time and a jump buffer) and acceleration are
// ours; collision resolution is Rapier's. Stepped once per physics tick.
export const player = {
  position: { x: 0, y: 0, z: 0 }, // capsule base (feet), at the latest tick
  renderPosition: { x: 0, y: 0, z: 0 }, // feet, interpolated for this frame
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  facing: SPAWN_FACING, // yaw the character model faces, radians
  dims: { ...PLAYER_DIMS },
  walkSpeed: PHYSICS.walkSpeed, // m/s, set from the Speed stat (stats.js)
  sprintMul: PHYSICS.sprintSpeed / PHYSICS.walkSpeed,
  // Held by something else (elevator ride, gym machine): input is ignored and, if `hold`
  // is set, the feet are put exactly there every tick.
  locked: false,
  hold: null, // { x, y, z } or null
  // Flying (Robot Gear jet form): { climb, sink, accel, maxY } replaces gravity; holding Jump climbs,
  // letting go glides down at `sink`.
  fly: null,
  // Wall climbing (Spider Arms): { nx, nz (the wall's outward normal), speed }. Forward / back climbs
  // up / down, strafe moves along the wall, Jump kicks off it (sets climbJump for robotPlayer).
  climb: null,
  climbJump: false,
  // Under a parachute (Robot Gear): { sink, decel, glide, speed }. The fall is braked toward -sink at
  // `decel`, the canopy keeps flying forward at `glide` and steering is capped at `speed`.
  chute: null,
}

const HALF = PLAYER_DIMS.height / 2 // capsule centre above the feet
const prev = { x: 0, y: 0, z: 0 }
let body = null
let collider = null
let controller = null
let sinceGrounded = 0
let jumpQueued = 0 // s left on a buffered jump

export function createPlayerBody() {
  const r = PLAYER_DIMS.radius
  body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, SPAWN.y + HALF, SPAWN.z))
  collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF - r, r).setFriction(0), body)

  controller = world.createCharacterController(0.02)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.enableAutostep(PHYSICS.stepHeight, 0.15, false)
  controller.enableSnapToGround(PHYSICS.snapToGround)
  controller.setMaxSlopeClimbAngle((PHYSICS.maxSlope * Math.PI) / 180)
  controller.setMinSlopeSlideAngle(((PHYSICS.maxSlope + 5) * Math.PI) / 180)
  controller.setApplyImpulsesToDynamicBodies(true)
  controller.setCharacterMass(PHYSICS.pushMass)

  resetPlayer()
  onTick(step)
}

export function resetPlayer(spawn = SPAWN, facing = SPAWN_FACING) {
  player.position.x = prev.x = player.renderPosition.x = spawn.x
  player.position.y = prev.y = player.renderPosition.y = spawn.y
  player.position.z = prev.z = player.renderPosition.z = spawn.z
  player.velocity.x = player.velocity.y = player.velocity.z = 0
  player.grounded = true
  player.facing = facing
  body?.setTranslation({ x: spawn.x, y: spawn.y + HALF, z: spawn.z }, true)
  body?.setNextKinematicTranslation({ x: spawn.x, y: spawn.y + HALF, z: spawn.z })
}

export function respawn() {
  resetPlayer()
  syncYawToPlayer()
}

const TAU = Math.PI * 2
// Turns angle `from` toward `to` by at most maxDelta, the short way round.
function rotateTowards(from, to, maxDelta) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  if (Math.abs(diff) <= maxDelta) return to
  return (from + Math.sign(diff) * maxDelta) % TAU
}

// Moves the (x, z) velocity toward the target as one 2D vector so it curves
// straight instead of warping axis-by-axis.
function approach2D(v, targetX, targetZ, maxDelta) {
  const dx = targetX - v.x
  const dz = targetZ - v.z
  const dist = Math.hypot(dx, dz)
  if (dist <= maxDelta || dist === 0) {
    v.x = targetX
    v.z = targetZ
  } else {
    v.x += (dx / dist) * maxDelta
    v.z += (dz / dist) * maxDelta
  }
}

function step(dt) {
  prev.x = player.position.x
  prev.y = player.position.y
  prev.z = player.position.z

  if (player.locked) {
    player.velocity.x = player.velocity.y = player.velocity.z = 0
    inputState.jump = false
    if (player.hold) {
      const h = player.hold
      body.setNextKinematicTranslation({ x: h.x, y: h.y + HALF, z: h.z })
      player.position.x = h.x
      player.position.y = h.y
      player.position.z = h.z
    }
    player.grounded = true
    return
  }
  if (player.climb) {
    climbStep(dt)
    return
  }

  // Camera-relative ground basis.
  const yaw = getYaw()
  const fwdX = -Math.sin(yaw)
  const fwdZ = -Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const mv = inputState.move
  const len = Math.hypot(mv.x, mv.z)
  const scale = len > 1 ? 1 / len : 1
  const wishX = (fwdX * mv.z + rightX * mv.x) * scale
  const wishZ = (fwdZ * mv.z + rightZ * mv.x) * scale
  const C = player.fly ? null : player.chute
  let speed = player.walkSpeed * (inputState.sprint ? player.sprintMul : 1)
  let targetX = wishX
  let targetZ = wishZ
  if (C) {
    // A canopy always flies forward; the move keys steer it (no sprinting under a parachute).
    speed = C.speed
    if (len < 0.05) {
      const g = C.glide / C.speed
      targetX = Math.sin(player.facing) * g
      targetZ = Math.cos(player.facing) * g
    }
  }

  const quick = Math.max(1, player.walkSpeed / PHYSICS.walkSpeed) // fast runners also accelerate faster
  const rate = (!player.grounded ? PHYSICS.airAccel : len > 0.01 ? PHYSICS.accel : PHYSICS.decel) * quick
  approach2D(player.velocity, targetX * speed, targetZ * speed, rate * dt)

  // Jump: buffered a little before landing, and allowed a little after leaving a ledge.
  if (inputState.jump) {
    jumpQueued = PHYSICS.jumpBuffer
    inputState.jump = false
  }
  sinceGrounded = player.grounded ? 0 : sinceGrounded + dt
  let jumped = false
  if (jumpQueued > 0 && sinceGrounded <= PHYSICS.coyoteTime) {
    player.velocity.y = PHYSICS.jumpSpeed
    jumpQueued = 0
    sinceGrounded = PHYSICS.coyoteTime + 1
    jumped = true
  }
  jumpQueued = Math.max(0, jumpQueued - dt)

  const F = player.fly
  if (F) {
    const target = inputState.jumpHeld && player.position.y < F.maxY ? F.climb : player.grounded ? -2 : F.sink
    const dv = target - player.velocity.y
    player.velocity.y += Math.sign(dv) * Math.min(Math.abs(dv), F.accel * dt)
  } else if (C && !player.grounded) {
    // Canopy open: brake hard toward the sink rate (the opening shock), never fall faster than it.
    const vy = player.velocity.y + PHYSICS.gravity * dt
    player.velocity.y = vy < -C.sink ? Math.min(-C.sink, player.velocity.y + C.decel * dt) : vy
  } else player.velocity.y += PHYSICS.gravity * dt
  if (player.grounded && !jumped && player.velocity.y < -2) player.velocity.y = -2 // stay pressed to slopes

  const desired = { x: player.velocity.x * dt, y: player.velocity.y * dt, z: player.velocity.z * dt }
  controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
  const moved = controller.computedMovement()
  player.grounded = !jumped && controller.computedGrounded()

  // Blocked vertically: a ceiling stops the rise, the floor stops the fall.
  if (player.velocity.y > 0 && moved.y < desired.y * 0.5) player.velocity.y = 0
  if (player.grounded && player.velocity.y < 0) player.velocity.y = Math.max(player.velocity.y, -2)
  // Horizontal velocity is left alone: the controller already slides along walls,
  // and scaling it by moved/desired would also bleed speed on every ramp and step.

  const t = body.translation()
  const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z }
  body.setNextKinematicTranslation(next)
  player.position.x = next.x
  player.position.y = next.y - HALF
  player.position.z = next.z

  if (player.position.y < PHYSICS.killY) {
    respawn()
    return
  }

  // The body turns toward its heading; in first person it always faces the view.
  if (isFirstPerson()) player.facing = yaw + Math.PI
  else if (Math.hypot(wishX, wishZ) > 0.05) {
    player.facing = rotateTowards(player.facing, Math.atan2(wishX, wishZ), PHYSICS.turnSpeed * dt)
  }
}

// On a wall: no gravity; forward / back moves up / down, strafe along the wall (right = the
// climber's right while facing it), a light push into the wall keeps the capsule against it.
function climbStep(dt) {
  const c = player.climb
  const mv = inputState.move
  if (inputState.jump) {
    inputState.jump = false
    player.climb = null
    player.climbJump = true
    player.velocity.x = c.nx * 9
    player.velocity.z = c.nz * 9
    player.velocity.y = 7
    jumpQueued = 0
    sinceGrounded = PHYSICS.coyoteTime + 1
    return
  }
  const side = mv.x * c.speed * 0.7
  player.velocity.x = c.nz * side - c.nx * 1.5
  player.velocity.z = -c.nx * side - c.nz * 1.5
  player.velocity.y = mv.z * c.speed
  const desired = { x: player.velocity.x * dt, y: player.velocity.y * dt, z: player.velocity.z * dt }
  controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS)
  const moved = controller.computedMovement()
  player.grounded = mv.z <= 0 && controller.computedGrounded()
  const t = body.translation()
  const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z }
  body.setNextKinematicTranslation(next)
  player.position.x = next.x
  player.position.y = next.y - HALF
  player.position.z = next.z
  player.facing = Math.atan2(-c.nx, -c.nz)
}

// Distance from the feet down to the first thing below (tower roof, scaffold, ground), up to `max` m.
// Nothing hit: the height above y = 0 (the desert floor).
let ray = null
export function groundBelow(max = 300) {
  const p = player.position
  if (!body || !world) return Math.min(max, Math.max(0, p.y))
  ray ??= new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
  ray.origin.x = p.x
  ray.origin.y = p.y + 0.1
  ray.origin.z = p.z
  const hit = world.castRay(ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, body)
  if (!hit) return Math.min(max, Math.max(0, p.y))
  return Math.max(0, (hit.timeOfImpact ?? hit.toi) - 0.1)
}

// Called once per frame after the physics ticks: interpolated feet position.
export function interpolate() {
  const p = player.position
  const r = player.renderPosition
  r.x = prev.x + (p.x - prev.x) * alpha
  r.y = prev.y + (p.y - prev.y) * alpha
  r.z = prev.z + (p.z - prev.z) * alpha
}
