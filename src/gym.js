import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GYM, LAYOUT, clamp } from './config.js'
import { bake } from './bake.js'
import { BENCH, DECOR, TREAD, buildBench, buildLock, buildTreadmill, setFieldTime } from './gymKit.js'
import { createEmitter } from './particles.js'
import { box, flatText, label, neon, setNeonK, solidBox, solidFootprint, std } from './propkit.js'
import { mulberry32, paintGlowRing, paintGymFloor, paintHazard, toTexture } from './textures.js'

// The gym: a walkway running east from the plaza (under an entrance arch) with a themed pad
// every few metres on both sides, from the FREE pad up to the 500x LEGEND pad. Every pad has a
// bench press (Strength) and a treadmill (Speed), modelled in gymKit.js with the pad's decor.
// A pad unlocks when you have finished enough buildings (premium pads with cash); until then
// a force field and a floating padlock stand over it. Use a machine (E / tap) and it repeats
// on its own; tapping makes you rep faster, moving gets you off.
//
// Machines glow up while someone is on them (belt running, console screen, underglow, plate
// rings, a floor aura), throw trails while you run, and burst on every rep (`rep`).

export function createGym(scene, fx = null) {
  const G = LAYOUT.gym
  const root = new Group()
  root.name = 'gym'
  const statics = new Group()
  const n = GYM.tiers.length
  const cols = Math.ceil(n / 2)
  const xStart = G.x0 - G.pad / 2 - 6
  const xEnd = G.x0 + (cols - 1) * G.spacing + G.pad / 2 + 2
  const concrete = std('#5d626b', { roughness: 0.8 })

  // Walkway: dark rubber with yellow edge lines, GYM painted at the entrance.
  box(statics, xEnd - xStart, 0.08, 9, std('#3a3d44', { roughness: 0.9 }), (xEnd + xStart) / 2, 0, G.z)
  for (const dz of [-4.4, 4.4]) box(statics, xEnd - xStart, 0.09, 0.25, std('#ffc21a'), (xEnd + xStart) / 2, 0, G.z + dz)
  const gymWord = flatText('GYM', 4.5, { color: '#ffb21a', outline: '#3a1600', outlineWidth: 22 })
  gymWord.rotation.x = -Math.PI / 2
  gymWord.position.set(G.x0 - G.pad / 2 - 2, 0.12, G.z)
  root.add(gymWord)

  // Entrance arch: hazard-striped pillars, a beam with the sign on both faces, neon strips.
  const ax = xStart + 1.2
  const stripes = std('#ffffff', { map: toTexture(paintHazard(), { repeat: 2, srgb: true }), roughness: 0.55 })
  const archNeon = neon('#ffb21a', 2.6)
  for (const s of [-1, 1]) {
    const z = G.z + s * 5.3
    box(statics, 1.2, 0.3, 1.2, concrete, ax, 0, z)
    box(statics, 0.8, 6.2, 0.8, stripes, ax, 0.3, z)
    box(statics, 0.06, 5.6, 0.06, archNeon, ax - 0.43, 0.6, z)
    box(statics, 0.06, 5.6, 0.06, archNeon, ax + 0.43, 0.6, z)
    solidBox(0.6, 3.3, 0.6, ax, 3.3, z)
  }
  box(statics, 1.1, 1.3, 11.6, std('#22242a', { roughness: 0.5, metalness: 0.4 }), ax, 6.5, G.z)
  box(statics, 1.14, 0.08, 11.64, archNeon, ax, 6.5, G.z)
  box(statics, 1.14, 0.08, 11.64, archNeon, ax, 7.72, G.z)
  for (const s of [-1, 1]) {
    const sign = flatText('GYM', 1.05, { color: '#ffb21a', outline: '#3a1600', outlineWidth: 20 })
    sign.position.set(ax + s * 0.57, 7.15, G.z)
    sign.rotation.y = (s * Math.PI) / 2
    root.add(sign)
  }

  const auraTex = toTexture(paintGlowRing(), { srgb: true })
  const stations = []
  const pads = []
  const anims = []
  const tmp = new Vector3()
  let emitterSeed = 70

  GYM.tiers.forEach((tier, i) => {
    const col = Math.floor(i / 2)
    const north = i % 2 === 0
    const px = G.x0 + col * G.spacing
    const pz = G.z + (north ? -G.offset : G.offset)
    const face = north ? 1 : -1 // machines face the walkway (+Z for the north row)
    const yaw = face > 0 ? 0 : Math.PI // pad space: +Z toward the walkway
    const S = G.pad
    const premium = tier.price != null
    const R = premium ? GYM.premiumRise : 0.3 // pad top
    const theme = GYM.themes[tier.theme]
    const c = Math.cos(yaw)
    const sn = Math.sin(yaw)
    const world = (lx, ly, lz) => tmp.set(px + lx * c + lz * sn, R + ly, pz - lx * sn + lz * c)

    // Platform, steps up to the premium pads, painted floor.
    box(statics, S, R, S, concrete, px, 0, pz)
    solidBox(S / 2, R / 2, S / 2, px, R / 2, pz)
    if (premium) {
      const edgeGlow = neon(tier.color, 2)
      box(statics, S + 0.06, 0.1, S + 0.06, std(tier.color, { metalness: 0.6, roughness: 0.3 }), px, R - 0.16, pz)
      for (const k of [0, 1]) {
        const h = (R * (k + 1)) / 3
        const cz = pz + face * (S / 2 + 0.3 + (1 - k) * 0.6)
        box(statics, S - 1, h, 0.6, concrete, px, 0, cz)
        box(statics, S - 1, 0.03, 0.05, edgeGlow, px, h, cz + face * 0.28)
        solidBox((S - 1) / 2, h / 2, 0.3, px, h / 2, cz)
      }
    }
    const fl = paintGymFloor(tier.theme, theme.floor, 512, 31 + i * 13)
    const floorMat = std('#ffffff', { map: toTexture(fl.map, { srgb: true }), roughness: 0.78 })
    if (fl.glow) {
      floorMat.emissiveMap = toTexture(fl.glow, { srgb: true })
      floorMat.emissive.set('#ffffff')
      floorMat.emissiveIntensity = theme.floor.glow
    }
    const floor = new Mesh(new PlaneGeometry(S - 0.5, S - 0.5), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.rotation.z = yaw
    floor.position.set(px, R + 0.006, pz)
    floor.receiveShadow = true
    root.add(floor)

    // Neon rim round the pad plus a glowing "stand here" mark in front of each machine.
    const bx = px - 2.4
    const tx = px + 2.6
    const rimParts = []
    const bar = (w, d, x, z, h = 0.1) => rimParts.push(new BoxGeometry(w, h, d).translate(x, h / 2, z))
    for (const [x, z, w, d] of [[0, -S / 2, S, 0.22], [0, S / 2, S, 0.22], [-S / 2, 0, 0.22, S], [S / 2, 0, 0.22, S]]) bar(w, d, x, z)
    for (const mx of [bx - px, tx - px]) {
      const mz = face * 2.3
      for (const [x, z, w, d] of [[0, -0.42, 1.36, 0.06], [0, 0.42, 1.36, 0.06], [-0.65, 0, 0.06, 0.9], [0.65, 0, 0.06, 0.9]]) bar(w, d, mx + x, mz + z, 0.03)
    }
    const rimMat = neon(tier.color, premium ? 3 : 2.4)
    const rim = new Mesh(mergeGeometries(rimParts), rimMat)
    rim.position.set(px, R, pz)
    root.add(rim)

    // The machines.
    const look = { color: tier.color, frame: tier.frame, trim: tier.trim, cushion: tier.cushion, label: tier.label }
    const bench = buildBench(look)
    for (const g of [bench.fixed, bench.live]) {
      g.position.set(bx, R, pz)
      g.rotation.y = yaw
    }
    statics.add(bench.fixed)
    root.add(bench.live)
    solidFootprint(bx, pz, yaw, 0, 0.05, 0.42, 1.15, R + 0.65)
    solidFootprint(bx, pz, yaw, 0, -1.15, 1.3, 0.48, R + 1.9)
    const millYaw = yaw + Math.PI
    const mill = buildTreadmill(look)
    for (const g of [mill.fixed, mill.live]) {
      g.position.set(tx, R, pz)
      g.rotation.y = millYaw
    }
    statics.add(mill.fixed)
    root.add(mill.live)
    solidFootprint(tx, pz, millYaw, 0, -0.05, 0.7, 1.62, R + 0.5)
    mill.screen.idle()

    const aura = (w, d, x) => {
      const m = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ color: tier.color, map: auraTex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }))
      m.rotation.x = -Math.PI / 2
      m.position.set(x, R + 0.03, pz)
      m.visible = false
      m.renderOrder = 1
      root.add(m)
      return m
    }

    // Stations: where you stand to use them, how you lie / stand on them, where you get off.
    const base = { tier: i, look, heat: 0, flash: 0, emitT: 0, R, occupant: null }
    stations.push({
      ...base,
      id: `b${i}`,
      kind: 'strength',
      x: bx,
      z: pz + face * 2.2,
      y: R + 1.2,
      // Lying on the bench, feet toward the walkway, shoulders under the bar (1.35 m from the
      // feet); `y` puts the back on the cushion (feet origin on the body's centre line).
      lie: { x: bx, y: R + 0.87, z: pz + face * 0.35, facing: yaw },
      exit: { x: bx, y: R + 0.1, z: pz + face * 3.2 },
      bar: bench.bar,
      barRest: BENCH.barRest,
      barLow: BENCH.barLow,
      barHigh: BENCH.barHigh,
      ringMat: bench.ringMat,
      aura: aura(3.4, 3.4, bx),
      ox: bx,
      oz: pz,
      c,
      s: sn,
    })
    stations.push({
      ...base,
      id: `t${i}`,
      kind: 'speed',
      x: tx,
      z: pz + face * 2.2,
      y: R + 1.2,
      // On the belt, facing the console (which faces the walkway).
      stand: { x: tx, y: R + 0.32, z: pz - face * 0.1, facing: yaw },
      exit: { x: tx, y: R + 0.1, z: pz + face * 3.4 },
      belt: mill.belt,
      ledMat: mill.ledMat,
      screen: mill.screen,
      screenOn: false,
      screenT: 0,
      aura: aura(2.6, 3.4, tx),
      ox: tx,
      oz: pz,
      c: Math.cos(millYaw),
      s: Math.sin(millYaw),
    })

    // Theme decor and ambient particles.
    const fixed = new Group()
    const live = new Group()
    for (const g of [fixed, live]) {
      g.position.set(px, R, pz)
      g.rotation.y = yaw
    }
    statics.add(fixed)
    root.add(live)
    const emit = (opts) =>
      createEmitter(root, {
        ...opts,
        seed: emitterSeed++,
        boxes: opts.boxes.map((b) => {
          const w = world(b.x, b.y, b.z)
          return { ...b, x: w.x, y: w.y, z: w.z }
        }),
      })
    const solid = (lx, lz, hx, hz, h) => solidFootprint(px, pz, yaw, lx, lz, hx, hz, R + h)
    DECOR[tier.theme]?.({ fixed, live, S, t: look, emit, solid, anims, fx, world, rand: mulberry32(900 + i) })
    const amb = theme.fx
    emit({ ...amb, boxes: [{ x: 0, y: amb.y, z: 0, sx: S / 2 - 0.6, sy: amb.sy, sz: S / 2 - 0.6 }] })

    // Labels: multiplier, and the requirement / price (or UNLOCKED) under it.
    const lbl = label(tier.label, 1.5, { color: tier.color, outline: '#141414', outlineWidth: 16 })
    lbl.position.set(px, R + 4.6, pz)
    root.add(lbl)

    // Locked: force field + padlock (refresh() shows / drops them).
    const lock = buildLock(S - 0.1, 2.6, tier.color)
    lock.group.position.set(px, R, pz)
    lock.padlock.scale.setScalar(1.7)
    root.add(lock.group)
    pads.push({ tier, i, x: px, z: pz, R, label: lbl, sub: null, subText: '', open: null, lock, unlockT: -1, rimMat, rimK: rimMat.userData.k, floorMat, glow: fl.glow ? theme.floor.glow : 0 })
  })
  root.add(bake(statics, true))
  scene.add(root)

  // The line under a pad's multiplier: what it takes, or that it is yours.
  function setSub(pad) {
    const t = pad.tier
    let text = 'Everyone'
    let color = '#ffffff'
    if (t.price != null) {
      text = pad.open ? 'OWNED' : `$${(t.price / 1e6).toFixed(1)}M`
      color = pad.open ? '#7dff6b' : '#ffd23a'
    } else if (t.need) {
      text = pad.open ? 'UNLOCKED' : `Requirement: ${t.need} Building${t.need > 1 ? 's' : ''}`
      color = pad.open ? '#7dff6b' : '#ffffff'
    }
    if (text === pad.subText) return
    if (pad.sub) {
      root.remove(pad.sub)
      pad.sub.material.map.dispose()
      pad.sub.material.dispose()
    }
    pad.subText = text
    pad.sub = label(text, 0.55, { color, outline: '#141414', outlineWidth: 10 })
    pad.sub.position.set(pad.x, pad.R + 3.65, pad.z)
    root.add(pad.sub)
  }

  // Shared world position helper for a station (machine space -> world).
  const sw = new Vector3()
  const toWorld = (st, lx, ly, lz) => sw.set(st.ox + lx * st.c + lz * st.s, st.R + ly, st.oz - lx * st.s + lz * st.c)
  const beltRate = GYM.beltSpeed / (TREAD.beltLength / TREAD.beltRepeat)
  const rnd = (a, b) => a + Math.random() * (b - a)

  const api = {
    stations,
    pads,
    tierUnlocked(i, buildings, owned) {
      const t = GYM.tiers[i]
      // owned[i]: bought (premium pads) or won on the spin wheel (any pad).
      if (owned[i]) return true
      if (t.price != null) return false
      return buildings >= t.need
    },
    // Shows which pads are open; `celebrate` drops the force field of a pad that just opened
    // with a burst (otherwise it simply disappears, e.g. on load).
    refresh(buildings, owned, celebrate = false) {
      for (const pad of pads) {
        const open = api.tierUnlocked(pad.i, buildings, owned)
        if (open === pad.open) continue
        const first = pad.open === null
        pad.open = open
        setSub(pad)
        const L = pad.lock
        if (open && celebrate && !first) {
          pad.unlockT = 0
          if (fx) {
            const y = pad.R + 0.4
            fx.sparks(pad.x, y + 2, pad.z, { count: 90, colors: [pad.tier.color, '#ffffff', '#ffe27a'], speed: 9, size: 0.5, life: 1.4, spread: 2 })
            fx.ring(pad.x, y, pad.z, 1, 9, pad.tier.color, 1.2)
            fx.confetti(pad.x, y + 3, pad.z, 80, 4)
          }
        } else {
          pad.unlockT = -1
          L.group.visible = !open
          L.group.scale.set(1, 1, 1)
          L.fieldMat.uniforms.uOpacity.value = 1
          L.padlock.scale.setScalar(1.7)
        }
      }
    },
    // One rep on a station: sparks off the plates / a trail off the belt, a ring on the floor.
    // `mine` = the player (anyone else would get a lighter version).
    rep(st, mine = true) {
      st.flash = 1
      if (!fx) return
      const tier = GYM.tiers[st.tier]
      const power = 1 + Math.log10(tier.mult)
      const colors = [tier.color, '#ffffff', st.look.trim]
      if (st.kind === 'strength') {
        for (const s of [-1, 1]) {
          const p = toWorld(st, s * 1.0, st.bar.position.y, BENCH.barZ)
          fx.sparks(p.x, p.y, p.z, { count: mine ? Math.round(5 * power) : 3, colors, speed: 2.5 + power, size: 0.22, life: 0.55, up: 1.5, gravity: 6 })
        }
        if (mine) {
          const p = toWorld(st, 0, 0.05, -0.2)
          fx.ring(p.x, p.y, p.z, 0.6, 2.4 + power * 0.6, tier.color, 0.6)
          if (tier.mult >= 25) fx.streak(p.x, p.y + 0.5, p.z, 0, 3.5, 0, { count: Math.round(power * 3), spread: 0.6, jitter: 0.6, colors, size: 0.28, life: 0.7 })
        }
      } else {
        const p = toWorld(st, 0, 0.35, 1.3)
        fx.streak(p.x, p.y, p.z, st.s * 6, 1.2, st.c * 6, { count: mine ? Math.round(3 * power) : 2, spread: 0.35, spreadY: 0.05, jitter: 0.8, colors, size: 0.24, life: 0.45, gravity: 4 })
        if (mine) {
          const f = toWorld(st, 0, 0.32, 0.2)
          fx.ring(f.x, f.y, f.z, 0.4, 1.6 + power * 0.4, tier.color, 0.45)
        }
      }
    },
    update(dt, time) {
      setFieldTime(time)
      for (const st of stations) {
        const on = !!st.occupant
        const mine = st.occupant === 'player'
        st.heat = on ? Math.min(1, st.heat + dt * GYM.heatUp) : Math.max(0, st.heat - dt * GYM.heatDown)
        st.flash = Math.max(0, st.flash - dt * 2.5)
        const glow = st.heat + st.flash
        const a = st.aura
        a.visible = glow > 0.01
        if (a.visible) {
          a.material.opacity = Math.min(1, st.heat * 0.5 + st.flash * 0.5)
          const k = 1 + st.flash * 0.12
          a.scale.set(k, k, 1)
          a.rotation.z += dt * 0.8
        }
        const tier = GYM.tiers[st.tier]
        if (st.kind === 'speed') {
          if (on) {
            st.belt.offset.y += dt * beltRate
            st.screenT -= dt
            if (st.screenT <= 0) {
              st.screenT = 0.12
              st.screen.run(11 + 7 * st.heat + Math.sin(time * 3) * 0.4, (time / GYM.repEvery) % 1, time)
              st.screenOn = true
            }
            // Trails: sparks off the back of the belt, speed lines streaming past the runner.
            st.emitT -= dt
            if (st.emitT <= 0 && fx) {
              st.emitT = mine ? 0.04 : 0.14
              const p = toWorld(st, rnd(-0.38, 0.38), 0.33, 1.3)
              fx.streak(p.x, p.y, p.z, st.s * 4.5, 0.5, st.c * 4.5, { count: 1, jitter: 0.4, colors: [tier.color, '#ffffff'], size: 0.16, life: 0.35, gravity: 3 })
              if (mine) {
                const side = Math.random() < 0.5 ? -1 : 1
                const q = toWorld(st, side * rnd(0.3, 0.55), rnd(0.5, 1.9), rnd(-0.2, 0.2))
                fx.streak(q.x, q.y, q.z, st.s * 10, 0, st.c * 10, { count: 1, jitter: 0.1, colors: ['#ffffff', tier.color], size: 0.1, shrink: 0.6, life: 0.22, drag: 0 })
              }
            }
          } else if (st.screenOn) {
            st.screenOn = false
            st.screen.idle()
          }
          setNeonK(st.ledMat, 1 + glow * 2.2 + (on ? 0.5 * Math.sin(time * 14) : 0))
        } else {
          const rep = on ? clamp((st.bar.position.y - BENCH.barLow) / (BENCH.barHigh - BENCH.barLow), 0, 1) : 0
          setNeonK(st.ringMat, 1.6 + glow * 1.8 + rep * st.heat * 1.4)
          if (on && fx) {
            st.emitT -= dt
            if (st.emitT <= 0) {
              st.emitT = mine ? 0.09 : 0.25
              const p = toWorld(st, rnd(-0.6, 0.6), 0.6, rnd(-1.0, 1.0))
              fx.streak(p.x, p.y, p.z, 0, 1.6, 0, { count: 1, jitter: 0.3, colors: [tier.color, '#ffffff'], size: 0.2, life: 0.9 })
            }
          }
        }
      }
      for (const pad of pads) {
        const p = 0.85 + 0.15 * Math.sin(time * 2 + pad.i)
        setNeonK(pad.rimMat, pad.rimK * p * (pad.open ? 1 : 0.45))
        if (pad.glow) pad.floorMat.emissiveIntensity = pad.glow * (0.75 + 0.25 * Math.sin(time * 1.6 + pad.i)) * (pad.open ? 1 : 0.55)
        const L = pad.lock
        if (!L.group.visible) continue
        L.padlock.rotation.y = time * 1.2 + pad.i
        L.padlock.position.y = 2.9 + Math.sin(time * 2 + pad.i) * 0.15
        if (pad.unlockT >= 0) {
          pad.unlockT += dt
          const k = Math.min(1, pad.unlockT / GYM.unlockTime)
          L.fieldMat.uniforms.uOpacity.value = 1 - k
          L.field.scale.y = Math.max(0.001, 1 - k * k)
          L.padlock.position.y += k * 2.5
          L.padlock.scale.setScalar(Math.max(0.001, 1.7 * (1 - k)))
          L.padlock.rotation.y += k * 12
          if (k >= 1) {
            L.group.visible = false
            pad.unlockT = -1
          }
        }
      }
      for (const f of anims) f(dt, time)
    },
  }
  return api
}

export { Vector3 }
