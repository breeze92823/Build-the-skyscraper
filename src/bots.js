import { Group, Vector3 } from 'three'
import { BOTS, GYM, LAYOUT, STATS } from './config.js'
import { makeAnimator } from './avatar/animator.js'
import { dressWorker, makeBotBody, makeNameTag } from './characters.js'
import { rankIndex } from './stats.js'

// The other workers on the server. Each one loops like a player does: fill the bag in the
// pit, walk to the crew cage, ride up, place blocks on the roof (the same shared tower),
// ride down, and now and then train at the gym. They show up on the leaderboards, and
// you can add them to your crew for a cash bonus.

const HATS = ['#ffd21a', '#ffffff', '#ff7a1a', '#3bc8ff', '#2fd06b', '#ff4d6d', '#b45cff']

export function createBots(scene, { tower, elevator, pit, gym, fx }) {
  const P = LAYOUT.pit
  const nodes = {
    pitGate: { x: P.x + P.w / 2 + 1.5, z: P.z },
    west: { x: -20, z: 10 },
    plaza: { x: 2, z: 10 },
    avenue: { x: -12, z: -20 },
    gymEntry: { x: LAYOUT.gym.x0 - 10, z: LAYOUT.gym.z },
  }
  const rnd = (a, b) => a + Math.random() * (b - a)
  const bots = BOTS.names.map((name, i) => {
    const body = makeBotBody(i + 2)
    const group = new Group()
    group.add(body)
    const dress = dressWorker(body, { hat: HATS[i % HATS.length] })
    const animator = makeAnimator(body)
    const strength = Math.round([40, 70, 110, 170, 250, 380, 560][i % 7] * rnd(0.85, 1.2))
    const blocks = Math.round([180, 900, 2600, 6200, 12500, 28000, 52000][i % 7] * rnd(0.8, 1.2))
    const tag = makeNameTag(name, rankIndex(blocks))
    tag.sprite.position.y = 2.45
    group.add(tag.sprite)
    scene.add(group)
    const b = {
      name,
      i,
      group,
      body,
      dress,
      animator,
      tag,
      strength,
      speed: Math.round(strength * rnd(0.4, 0.9)),
      blocks,
      cash: Math.round(blocks * rnd(0.5, 1.4)),
      buildings: Math.floor(blocks / 9000),
      playtime: Math.round(blocks * rnd(0.25, 0.5) + 600),
      bag: 0,
      pos: new Vector3(nodes.plaza.x + rnd(-10, 10), 0, nodes.plaza.z + rnd(-6, 6)),
      facing: rnd(0, Math.PI * 2),
      path: [],
      state: 'toPit',
      t: 0,
      trips: Math.floor(rnd(0, 3)),
      station: null,
      rep: 0,
      repT: 0,
      walk: rnd(...BOTS.walkSpeed),
      helped: false, // placed blocks on the current building
      cageOff: { x: rnd(-1.2, 1.2), z: rnd(-1.2, 1.2) },
    }
    b.pos.y = 0
    return b
  })

  const capacity = (b) => STATS.capacity(b.strength)
  const route = (b, list) => {
    b.path = list.map((p) => ({ x: p.x, z: p.z }))
  }
  function goPit(b) {
    const z = pit.zone
    const target = { x: z.x + rnd(-z.w / 2 + 1.5, z.w / 2 - 1.5), z: z.z + rnd(-z.d / 2 + 1.5, z.d / 2 - 1.5) }
    const fromTower = b.pos.z < -10
    route(b, fromTower ? [nodes.avenue, nodes.west, nodes.pitGate, target] : [nodes.west, nodes.pitGate, target])
    if (b.pos.x < P.x + P.w / 2) b.path = [target] // already in the pit
    b.state = 'toPit'
  }
  function goLift(b) {
    const s = elevator.spots()
    route(b, [nodes.pitGate, nodes.west, nodes.avenue, s.crewBottom])
    b.state = 'toLift'
  }
  function goGym(b) {
    // The best pad this bot may use, a free machine on it.
    let best = 0
    GYM.tiers.forEach((t, i) => {
      if (t.price == null && b.buildings >= t.need) best = i
    })
    const choices = gym.stations.filter((s) => s.tier === best && !s.occupant)
    const st = choices[Math.floor(Math.random() * choices.length)]
    if (!st) return goPit(b)
    st.occupant = b
    b.station = st
    route(b, [nodes.pitGate, nodes.west, nodes.plaza, nodes.gymEntry, { x: st.x, z: LAYOUT.gym.z }, { x: st.x, z: st.z }])
    b.state = 'toGym'
  }
  bots.forEach((b) => goPit(b))

  // Walks along the path; returns true once at the end.
  function walk(b, dt) {
    if (!b.path.length) return true
    const p = b.path[0]
    const dx = p.x - b.pos.x
    const dz = p.z - b.pos.z
    const d = Math.hypot(dx, dz)
    const step = b.walk * dt
    if (d <= step) {
      b.pos.x = p.x
      b.pos.z = p.z
      b.path.shift()
      return !b.path.length
    }
    b.pos.x += (dx / d) * step
    b.pos.z += (dz / d) * step
    b.facing = Math.atan2(dx, dz)
    b.moving = b.walk
    return false
  }

  function reset(b) {
    b.pos.set(nodes.plaza.x + rnd(-8, 8), 0, nodes.plaza.z + rnd(-5, 5))
    if (b.station) {
      b.station.occupant = null
      b.station = null
    }
    goPit(b)
  }
  tower.on('building', () => {
    for (const b of bots) {
      b.helped = false
      if (b.pos.y > 1 || b.state === 'ride' || b.state === 'rideDown') reset(b)
    }
  })
  tower.on('complete', () => {
    for (const b of bots) {
      if (b.helped) {
        b.buildings++
        b.cash += 2500
      }
    }
  })

  const target = new Vector3()
  function update(dt, elapsed) {
    const crew = elevator.crew
    const spots = elevator.spots()
    const roofY = tower.roofY
    for (const b of bots) {
      b.playtime += dt
      b.moving = 0
      b.t += dt
      let activity = null
      let y = 0
      switch (b.state) {
        case 'toPit':
          if (walk(b, dt)) {
            b.state = 'collect'
            b.t = 0
          }
          break
        case 'collect': {
          const rate = Math.max(STATS.minRate, capacity(b) / STATS.fillTime) * (1 + b.i * 0.08)
          b.bag = Math.min(capacity(b), b.bag + rate * dt)
          if (Math.random() < dt * 6) {
            const s = pit.spots[Math.floor(Math.random() * pit.spots.length)]
            fx.flyBlock(target.set(s.x, s.y + 0.3, s.z), () => target.set(b.pos.x, 1.6, b.pos.z).clone(), 0.45, 2)
          }
          if (b.bag >= capacity(b)) {
            b.trips++
            if (b.trips % 4 === 3 && !tower.sinking) goGym(b)
            else goLift(b)
          }
          break
        }
        case 'toLift':
          if (walk(b, dt)) b.state = 'waitLift'
          break
        case 'waitLift':
          b.facing = Math.PI
          if (tower.sinking || tower.floors === 0) {
            // Nothing to ride up to yet: the foundation is the roof, walk straight on.
            if (tower.floors === 0 && !tower.sinking) {
              route(b, [{ x: spots.crewBottom.x + 3, z: spots.crewIn.z - 6 }])
              b.state = 'toBuild'
              b.buildTarget = pickBuildSpot()
              b.path.push(b.buildTarget)
            }
            break
          }
          if (crew.state === 'bottom' && crew.wait > 1.2) {
            route(b, [{ x: spots.crewIn.x + b.cageOff.x, z: spots.crewIn.z + b.cageOff.z }])
            b.state = 'board'
          }
          break
        case 'board':
          walk(b, dt)
          if (crew.state === 'up') b.state = 'ride'
          break
        case 'ride':
          y = crew.y
          b.pos.x = spots.crewIn.x + b.cageOff.x
          b.pos.z = spots.crewIn.z + b.cageOff.z
          if (crew.state === 'top') {
            b.buildTarget = pickBuildSpot()
            route(b, [spots.crewRoof, b.buildTarget])
            b.state = 'toBuild'
          }
          break
        case 'toBuild':
          y = tower.floors === 0 ? roofY : roofY
          if (walk(b, dt)) {
            b.state = 'build'
            b.t = 0
          }
          break
        case 'build': {
          y = roofY
          const c = tower.cursor()
          b.facing = Math.atan2(c.x - b.pos.x, c.z - b.pos.z)
          const rate = Math.max(STATS.minRate, capacity(b) / STATS.buildTime)
          const n = Math.min(b.bag, rate * dt)
          b.bag -= n
          b.carry = (b.carry ?? 0) + n
          if (b.carry >= 1) {
            const whole = Math.floor(b.carry)
            b.carry -= whole
            const took = tower.addBlocks(whole)
            b.blocks += took
            b.cash += took
            if (took) b.helped = true
            if (Math.random() < 0.5) fx.flyBlock(target.set(b.pos.x, roofY + 1.6, b.pos.z), c.clone(), 0.35, 1.2)
          }
          if (Math.hypot(c.x - b.pos.x, c.z - b.pos.z) > 7) route(b, [pickBuildSpot()]), (b.state = 'toBuild')
          if (b.bag <= 0.01) {
            b.bag = 0
            if (tower.floors === 0) {
              goPit(b)
            } else {
              route(b, [spots.crewRoof])
              b.state = 'toExit'
            }
          }
          break
        }
        case 'toExit':
          y = roofY
          if (walk(b, dt)) b.state = 'waitDown'
          break
        case 'waitDown':
          y = roofY
          if (crew.state === 'top' && crew.wait > 1.2) {
            route(b, [{ x: spots.crewIn.x + b.cageOff.x, z: spots.crewIn.z + b.cageOff.z }])
            b.state = 'boardDown'
          }
          break
        case 'boardDown':
          y = roofY
          walk(b, dt)
          if (crew.state === 'down') b.state = 'rideDown'
          break
        case 'rideDown':
          y = crew.y
          if (crew.state === 'bottom') {
            route(b, [spots.crewBottom])
            b.state = 'leaveLift'
          }
          break
        case 'leaveLift':
          if (walk(b, dt)) goPit(b)
          break
        case 'toGym':
          if (walk(b, dt)) {
            b.state = 'train'
            b.t = 0
          }
          break
        case 'train': {
          const st = b.station
          const tier = GYM.tiers[st.tier]
          b.repT += dt
          if (b.repT > GYM.repEvery) {
            b.repT = 0
            if (st.kind === 'strength') b.strength += tier.mult
            else b.speed += tier.mult
          }
          b.rep = 0.5 + 0.5 * Math.sin((b.repT / GYM.repEvery) * Math.PI * 2 - Math.PI / 2)
          if (st.kind === 'strength') {
            activity = 'bench'
            b.pos.set(st.lie.x, 0, st.lie.z)
            y = st.lie.y
            b.facing = st.lie.facing
            st.bar.position.y = st.barLow + (st.barHigh - st.barLow) * b.rep
          } else {
            b.pos.set(st.stand.x, 0, st.stand.z)
            y = st.stand.y
            b.facing = st.stand.facing
            b.moving = 9
            st.belt.offset.y += dt * 3
          }
          if (b.t > 18 + b.i * 2) {
            if (st.bar) st.bar.position.y = st.barRest
            st.occupant = null
            b.station = null
            b.pos.set(st.exit.x, 0, st.exit.z)
            goPit(b)
          }
          break
        }
      }
      if (b.state === 'toBuild' || b.state === 'build' || b.state === 'toExit' || b.state === 'waitDown' || b.state === 'boardDown') {
        if (tower.sinking) reset(b)
      }
      b.pos.y = y
      b.group.position.copy(b.pos)
      b.group.rotation.order = 'YXZ'
      b.group.rotation.set(activity === 'bench' ? -Math.PI / 2 : 0, b.facing, 0)
      b.animator?.update(dt, { grounded: true, speed: b.moving, verticalVelocity: 0, turn: 0, activity, rep: b.rep })
      b.dress.setFill(b.bag / Math.max(1, capacity(b)), 0)
      b.dress.setMuscle(STATS.muscle(b.strength))
      b.tag.set(b.name, rankIndex(b.blocks))
      b.tag.sprite.visible = activity !== 'bench'
    }
  }

  function pickBuildSpot() {
    const c = tower.cursor()
    const a = Math.random() * Math.PI * 2
    const r = rnd(2.5, 5)
    const x = c.x + Math.cos(a) * r
    const z = c.z + Math.sin(a) * r
    // Stay on the roof.
    if (tower.onRoof(x, tower.roofY, z)) return { x, z }
    return { x: c.x, z: c.z + 2 }
  }

  return {
    bots,
    update,
    // The player wants this machine: whoever is on it gets off and heads back to work.
    evict(st) {
      const b = st.occupant
      if (!b || b === 'player' || !bots.includes(b)) return
      if (st.bar) st.bar.position.y = st.barRest
      st.occupant = null
      b.station = null
      b.pos.set(st.exit.x + 1.2, 0, st.exit.z)
      goPit(b)
    },
    entries: () => bots.map((b) => ({ name: b.name, strength: b.strength, speed: b.speed, blocks: b.blocks, cash: b.cash, buildings: b.buildings, playtime: b.playtime })),
    // The worker within `r` of (x, z), for the crew prompt.
    near(x, z, r) {
      let best = null
      let bd = r
      for (const b of bots) {
        const d = Math.hypot(b.pos.x - x, b.pos.z - z)
        if (d < bd && b.state !== 'ride' && b.state !== 'rideDown') {
          bd = d
          best = b
        }
      }
      return best
    },
  }
}
