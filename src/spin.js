import { CanvasTexture, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, TorusGeometry } from 'three'
import { LAYOUT, SPIN } from './config.js'
import { bake } from './bake.js'
import { box, cyl, label, neon, solidBox, solidPole, std } from './propkit.js'
import { mats } from './props.js'
import { paintHazard, toTexture } from './textures.js'
import { prizeLabel } from './spinPrizes.js'

// The Spin Wheel stage east of the egg hall: a round hazard-rimmed stage, a gold frame with
// marquee bulbs and the big wheel facing north (toward the road). It idles slowly and plays
// the same spin as the Spin window. Returns { pad: { x, z }, spinTo(index, time), repaint(), update }.

const R = 4.3 // wheel radius
const HUB_Y = 5.6

function paintWheel(slices) {
  const S = 1024
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')
  const n = slices.length
  const cx = S / 2
  const r = S / 2 - 8
  const step = (Math.PI * 2) / n
  for (let i = 0; i < n; i++) {
    // Slice i is centred on the top (canvas -Y) when the wheel's angle is 0, then clockwise.
    const a0 = -Math.PI / 2 - step / 2 + i * step
    g.beginPath()
    g.moveTo(cx, cx)
    g.arc(cx, cx, r, a0, a0 + step)
    g.closePath()
    g.fillStyle = slices[i].color
    g.fill()
    g.lineWidth = 8
    g.strokeStyle = '#1b1b24'
    g.stroke()
    g.save()
    g.translate(cx, cx)
    g.rotate(a0 + step / 2 + Math.PI / 2)
    g.textAlign = 'center'
    g.font = '700 58px Fredoka, "Arial Black", sans-serif'
    g.lineJoin = 'round'
    g.lineWidth = 12
    g.strokeStyle = '#1b1b24'
    g.fillStyle = '#ffffff'
    const [l1, l2] = prizeLabel(slices[i])
    g.strokeText(l1, 0, -r * 0.7)
    g.fillText(l1, 0, -r * 0.7)
    if (l2) {
      g.font = '700 42px Fredoka, "Arial Black", sans-serif'
      g.strokeText(l2, 0, -r * 0.7 + 52)
      g.fillText(l2, 0, -r * 0.7 + 52)
    }
    g.restore()
  }
  g.beginPath()
  g.arc(cx, cx, r, 0, Math.PI * 2)
  g.lineWidth = 14
  g.strokeStyle = '#1b1b24'
  g.stroke()
  return c
}

export function createSpinStage(scene) {
  const P = LAYOUT.spin
  const root = new Group()
  root.name = 'spinStage'
  const statics = new Group()
  const gold = std('#ffc21a', { metalness: 0.5, roughness: 0.35 })
  // Stage: a round concrete deck with a hazard skirt and a gold lip.
  cyl(statics, 6.6, 0.5, std('#9aa1a8', { roughness: 0.85 }), 0, 0, 0, 40)
  const skirtTex = toTexture(paintHazard(128, '#ffcc1a', '#1d1d22'), { srgb: true })
  skirtTex.repeat.set(14, 0.5)
  const skirt = new Mesh(new CylinderGeometry(6.65, 6.65, 0.42, 48, 1, true), new MeshStandardMaterial({ map: skirtTex, roughness: 0.6 }))
  skirt.position.y = 0.21
  statics.add(skirt)
  const lip = new Mesh(new TorusGeometry(6.45, 0.12, 6, 64), gold)
  lip.rotation.x = Math.PI / 2
  lip.position.y = 0.52
  statics.add(lip)
  solidPole(6.6, 0.5, P.x, P.z)
  // Frame: two posts and a top beam (wheel faces -Z).
  for (const s of [-1, 1]) {
    box(statics, 0.7, HUB_Y + R + 1.2, 0.7, gold, s * (R + 1.2), 0.5, 0.6)
    solidBox(0.35, (HUB_Y + R + 1.7) / 2, 0.35, P.x + s * (R + 1.2), (HUB_Y + R + 1.7) / 2, P.z + 0.6)
  }
  box(statics, 2 * (R + 1.2) + 0.7, 0.8, 0.8, gold, 0, HUB_Y + R + 1.3, 0.6)
  box(statics, 1.2, HUB_Y, 0.6, mats.dark(), 0, 0.5, 0.9) // the stand behind the hub
  solidBox(0.6, HUB_Y / 2, 0.3, P.x, HUB_Y / 2, P.z + 0.9)
  const baked = bake(statics, true)
  baked.position.set(P.x, 0, P.z)
  root.add(baked)
  // Marquee bulbs on the beam and the posts.
  const bulbOn = neon('#fff2b0', 2.4)
  const bulbs = []
  const bulbGeo = new SphereGeometry(0.17, 10, 8)
  for (let i = 0; i <= 12; i++) {
    const b = new Mesh(bulbGeo, bulbOn)
    b.position.set(P.x - (R + 1.2) + (i * 2 * (R + 1.2)) / 12, HUB_Y + R + 1.7, P.z + 0.15)
    root.add(b)
    bulbs.push(b)
  }
  // The wheel: a disc whose face (+Y of the cylinder) is turned to -Z.
  const wheel = new Group()
  wheel.position.set(P.x, HUB_Y, P.z)
  root.add(wheel)
  const spinner = new Group() // turns about the wheel axis
  wheel.add(spinner)
  const tex = new CanvasTexture(paintWheel(SPIN.normal))
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const face = new MeshStandardMaterial({ map: tex, roughness: 0.5 })
  const edge = std('#ffb21a', { metalness: 0.5, roughness: 0.3 })
  // CylinderGeometry caps: groups [side, top, bottom]; the top cap gets the painted face.
  const disc = new Mesh(new CylinderGeometry(R, R, 0.35, 64), [edge, face, edge])
  disc.rotation.x = -Math.PI / 2 // top cap -> faces -Z
  disc.castShadow = true
  spinner.add(disc)
  const rim = new Mesh(new TorusGeometry(R + 0.12, 0.22, 10, 64), gold)
  rim.position.z = 0
  wheel.add(rim)
  const rimBulbs = []
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    const b = new Mesh(bulbGeo, bulbOn)
    b.position.set(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), -0.22)
    wheel.add(b)
    rimBulbs.push(b)
  }
  const hub = new Mesh(new CylinderGeometry(1.05, 1.05, 0.6, 32), std('#ff6a1a', { roughness: 0.4 }))
  hub.rotation.x = -Math.PI / 2
  hub.position.z = -0.25
  wheel.add(hub)
  const hubText = label('SPIN!', 0.7, { color: '#ffffff', outline: '#5a1a00', outlineWidth: 14 })
  hubText.position.set(P.x, HUB_Y, P.z - 0.9)
  root.add(hubText)
  // Pointer on top, pointing down at the slice that wins.
  const pointer = new Mesh(new ConeGeometry(0.45, 1, 4), neon('#ff3d3d', 2.2))
  pointer.rotation.z = Math.PI
  pointer.position.set(P.x, HUB_Y + R + 0.55, P.z - 0.4)
  root.add(pointer)
  solidBox(R, R, 0.3, P.x, HUB_Y, P.z)
  const title = label('SPIN', 2.4, { color: '#ff4fd8', outline: '#3a0636', outlineWidth: 20 })
  title.position.set(P.x, HUB_Y + R + 3.6, P.z)
  root.add(title)
  scene.add(root)

  // Spin state. `angle` = how far the wheel has turned clockwise as you face it; slice i is
  // under the pointer when angle = -i * step (mod one turn).
  const TAU = Math.PI * 2
  let angle = 0
  let from = 0
  let to = 0
  let t = 1
  let dur = 1
  let hold = 0 // s the result stays under the pointer before the idle drift resumes
  const step = TAU / SPIN.normal.length
  return {
    pad: { x: P.x, z: P.z - 7.6 },
    // Turn (clockwise, SPIN.turns full turns) so slice `index` ends under the pointer;
    // `offset` (-1..1) lands it off-centre inside the slice.
    spinTo(index, time = SPIN.time, offset = 0) {
      const target = -index * step + offset * step * 0.35
      const d = (((target - angle) % TAU) + TAU) % TAU
      from = angle
      to = angle + SPIN.turns * TAU + d
      t = 0
      dur = time
    },
    repaint(slices) {
      const c = paintWheel(slices)
      tex.image = c
      tex.needsUpdate = true
    },
    get spinning() {
      return t < 1
    },
    update(dt, elapsed) {
      if (t < 1) {
        t = Math.min(1, t + dt / dur)
        const e = 1 - Math.pow(1 - t, 4)
        angle = from + (to - from) * e
        if (t >= 1) hold = 6
      } else if (hold > 0) {
        hold -= dt
      } else {
        angle += dt * 0.25 // idle drift
      }
      // Seen from the front (-Z) a positive Z rotation is clockwise. The cap's UVs leave the
      // painted face a quarter turn counter-clockwise, hence the PI / 2.
      spinner.rotation.z = Math.PI / 2 + angle
      const on = Math.floor(elapsed * (t < 1 ? 10 : 3))
      rimBulbs.forEach((b, i) => (b.visible = (i + on) % 2 === 0))
      bulbs.forEach((b, i) => (b.visible = (i + on) % 3 !== 0))
    },
  }
}
