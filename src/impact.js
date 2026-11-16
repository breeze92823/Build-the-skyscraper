import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three'
import { groundBelowAt } from './physics.js'

// Robot Gear superhero landing effects (robotPlayer.js decides when and drives the crouch): the ground
// cracks in a star around the point of impact (a decal that fades after a few seconds), two shock rings
// race out, a skirt of dust blasts sideways, sparks skid along the ground, chunks of rubble fly out and
// tumble down, the camera shakes, and steam vents out of the leg shock absorbers while the suit holds the
// crouch; standing back up vents the last of it with a hiss. Works for any body: `target` is
// { pos: {x, y, z} (feet, read live), facing } -- the local player, or another player (remotePlayers.js).

const rnd = (a, b) => a + Math.random() * (b - a)

// Radial ground cracks: a dark crater bruise, jagged main cracks with forks, and a few broken chips.
function paintCracks(size = 256) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  const h = size / 2
  const bruise = g.createRadialGradient(h, h, 0, h, h, h * 0.5)
  bruise.addColorStop(0, 'rgba(30,22,16,0.55)')
  bruise.addColorStop(0.6, 'rgba(40,30,22,0.25)')
  bruise.addColorStop(1, 'rgba(40,30,22,0)')
  g.fillStyle = bruise
  g.fillRect(0, 0, size, size)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  function crack(x, y, ang, len, w, depth) {
    g.strokeStyle = `rgba(22,16,12,${0.85 - depth * 0.2})`
    let px = x
    let py = y
    const steps = 6
    for (let i = 0; i < steps; i++) {
      ang += rnd(-0.45, 0.45)
      const nx = px + Math.cos(ang) * (len / steps)
      const ny = py + Math.sin(ang) * (len / steps)
      g.lineWidth = Math.max(0.6, w * (1 - i / steps))
      g.beginPath()
      g.moveTo(px, py)
      g.lineTo(nx, ny)
      g.stroke()
      if (depth < 2 && Math.random() < 0.35) crack(nx, ny, ang + rnd(-1, 1), len * 0.45, w * 0.6, depth + 1)
      px = nx
      py = ny
    }
  }
  const n = 11
  for (let i = 0; i < n; i++) crack(h + rnd(-4, 4), h + rnd(-4, 4), (i / n) * Math.PI * 2 + rnd(-0.2, 0.2), h * rnd(0.55, 0.92), 4.5, 0)
  // A ring of broken edge around the centre.
  g.strokeStyle = 'rgba(22,16,12,0.6)'
  g.lineWidth = 2
  g.beginPath()
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const r = h * 0.2 * rnd(0.85, 1.15)
    i ? g.lineTo(h + Math.cos(a) * r, h + Math.sin(a) * r) : g.moveTo(h + Math.cos(a) * r, h + Math.sin(a) * r)
  }
  g.stroke()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  return tex
}

export function createImpact({ scene, fx, snd, flash, shake }) {
  const tex = paintCracks()
  const geo = new PlaneGeometry(1, 1)
  geo.rotateX(-Math.PI / 2)
  const decals = [0, 1, 2].map(() => {
    const m = new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, opacity: 0 }))
    m.visible = false
    m.renderOrder = 1
    scene.add(m)
    return { m, t: 99 }
  })
  let next = 0
  const vents = [] // { target, t, size, dur, next }
  const a = new Vector3()
  const b = new Vector3()

  // The leg shock absorbers: both knees, either side of the body.
  function legs(target, size, fn) {
    const P = target.pos
    const f = target.facing
    for (const side of [-1, 1]) {
      fn(P.x + Math.cos(f) * side * 0.5 * size + Math.sin(f) * 0.2 * size, P.y + 0.45 * size, P.z - Math.sin(f) * side * 0.5 * size + Math.cos(f) * 0.2 * size, side)
    }
  }

  return {
    // p = 0..1 how hard; size = the suit's size; glow = its glow colour; vol = sound volume (0 = silent),
    // shakeK scales the camera shake (0 = none), big flashes the screen edge on a hard hit.
    land(target, p, size, glow, { vol = 1, shakeK = 1, big = true } = {}) {
      // On the ground right below them: another player's eased position can still be a little up in
      // the air on the frame their landing arrives.
      const T = target.pos
      const P = a.set(T.x, T.y - groundBelowAt(T.x, T.y + 0.5, T.z, 6) + 0.5, T.z)
      const gx = P.x
      const gy = P.y
      const gz = P.z
      const d = decals[next]
      next = (next + 1) % decals.length
      d.t = 0
      d.m.visible = true
      d.m.material.opacity = 0.92
      d.m.position.set(gx, gy + 0.04, gz)
      d.m.rotation.y = Math.random() * Math.PI * 2
      d.m.scale.setScalar((3.2 + 3.2 * p) * size)

      fx.ring(gx, gy + 0.15, gz, 0.5, (8 + 9 * p) * size, '#ffffff', 0.6)
      fx.ring(gx, gy + 0.2, gz, 0.3, (5 + 5 * p) * size, glow, 0.9)
      const n = 14
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2
        fx.dust(gx + Math.cos(ang) * 0.9 * size, gy + 0.05, gz + Math.sin(ang) * 0.9 * size, { count: 2, size: (1.2 + 0.8 * p) * size, grow: 2.6, life: 1.4, spread: 0.4, push: 4 + 4 * p, alpha: 0.5, color: '#d9c7ad', height: 0 })
      }
      fx.dust(gx, gy + 0.2, gz, { count: 6, size: 1.5 * size, grow: 2.4, life: 1.6, spread: 0.8 * size, push: 0.8, rise: 2.5, alpha: 0.38, color: '#cbb89c', height: 0.4 })
      fx.sparks(gx, gy + 0.25, gz, { count: 40 + 40 * p, colors: [glow, '#ffffff', '#ffb347'], speed: 9 + 5 * p, size: 0.45, flat: true, life: 0.8 })
      // Rubble flying out of the crater.
      const chunks = 6 + Math.round(8 * p)
      for (let i = 0; i < chunks; i++) {
        const ang = Math.random() * Math.PI * 2
        const r = rnd(2.5, 6) * size * (0.7 + 0.5 * p)
        a.set(gx + Math.cos(ang) * 0.4, gy + 0.3, gz + Math.sin(ang) * 0.4)
        b.set(gx + Math.cos(ang) * r, gy + 0.1, gz + Math.sin(ang) * r)
        fx.flyBlock(a, b, rnd(0.5, 0.85), rnd(1.2, 3) * (0.6 + 0.6 * p))
      }
      if (vol > 0.02) snd.impactLand(p, vol)
      if (shakeK > 0) shake((0.16 + 0.38 * p) * Math.min(1.5, size) * shakeK)
      if (big && p > 0.4) flash('edge')
      for (let i = vents.length - 1; i >= 0; i--) if (vents[i].target === target) vents.splice(i, 1)
      vents.push({ target, t: 0, size, dur: 0.75, next: 0 })
    },
    // Standing back up: the last of the pressure vents out.
    rise(target, size, vol = 1) {
      if (vol > 0.02) snd.impactRise(vol)
      legs(target, size, (x, y, z) => {
        fx.dust(x, y, z, { count: 3, size: 0.5 * size, grow: 3, life: 0.8, color: '#f2f4f7', alpha: 0.5, rise: 2.2, push: 1.6, spread: 0.1, height: 0 })
        fx.sparks(x, y, z, { count: 5, colors: ['#ffffff', '#bfefff'], speed: 3, size: 0.25, life: 0.35 })
      })
    },
    update(dt) {
      for (const d of decals) {
        if (!d.m.visible) continue
        d.t += dt
        d.m.material.opacity = 0.92 * Math.max(0, 1 - Math.max(0, d.t - 2.2) / 1.6)
        if (d.m.material.opacity <= 0) d.m.visible = false
      }
      for (let i = vents.length - 1; i >= 0; i--) {
        const vent = vents[i]
        vent.t += dt
        vent.next -= dt
        if (vent.next <= 0) {
          vent.next = 0.045
          const k = vent.t / vent.dur
          const f = vent.target.facing
          legs(vent.target, vent.size, (x, y, z, side) => {
            fx.dust(x, y, z, { count: 1, size: 0.35 * vent.size, grow: 3.2, life: 0.7, color: '#f2f4f7', alpha: 0.45 * (1 - k), rise: 1.4, push: 1.6, spread: 0.05, height: 0 })
            fx.streak(x, y, z, Math.cos(f) * side * 3, 1.2, -Math.sin(f) * side * 3, { count: 1, jitter: 0.6, size: 0.18, life: 0.3, colors: ['#ffffff', '#cfe8ff'], intensity: 1.4 })
          })
        }
        if (vent.t >= vent.dur) vents.splice(i, 1)
      }
    },
  }
}
