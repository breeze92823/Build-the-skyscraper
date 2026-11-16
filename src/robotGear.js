import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry, RingGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3 } from 'three'

const tmpV = new Vector3()
import { LAYOUT, ROBOT, ROBOT_GEAR } from './config.js'
import { bake } from './bake.js'
import { box, flatText, fontReady, label, neon, solidBox, solidPole, std } from './propkit.js'
import { makeWorkerBody } from './characters.js'
import { createEmitter } from './particles.js'
import { makeDropship, wearGear } from './gear.js'
import { makeVehicle } from './vehicles.js'
import { paintPavers, toTexture } from './textures.js'
import { commas, limitedStatus, short, state } from './stats.js'

// The Robot Gear hall: a T-shaped neon platform south-west of the leaderboard. The hall leads
// in from the main road past two rows of pedestals (Jet Boots to Mech Suit); the bar of the T
// at the far end holds the big ones (Black Mech Suit, the transformers, Titan Armor). Every
// pedestal shows a mannequin wearing its gear (the transformers park their vehicle beside it,
// the jet hovers overhead, Titan Armor's dropship idles above), a floating card with the stats
// and the cash price, and a glowing rim. The interact prompts live in robotPlayer.js.

const PED_H = 0.6
const FLOOR_Y = 0.3

// The floating card over a pedestal: name, stats, ability and the price / owned pill.
function abilityText(def) {
  if (def.ability === 'transform') return 'PRESS G: ROBOT ⇄ VEHICLE!'
  if (def.ability === 'fly') return 'PRESS G: JET MODE · HOLD JUMP TO FLY!'
  if (def.ability === 'drop') return 'G: ARMOR DROP · HOLD JUMP TO FLY!'
  if (def.fly) return 'HOLD JUMP TO FLY!'
  return ''
}
function pill(g, x, y, w, h, fill, edge) {
  const r = h / 2
  g.beginPath()
  g.moveTo(x - w / 2 + r, y - h / 2)
  g.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, r)
  g.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, r)
  g.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, r)
  g.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, r)
  g.closePath()
  g.fillStyle = fill
  g.fill()
  g.lineWidth = 7
  g.strokeStyle = edge
  g.stroke()
}
function outlined(g, text, x, y, font, fill, stroke, lw) {
  g.font = font
  g.lineJoin = 'round'
  g.lineWidth = lw
  g.strokeStyle = stroke
  g.strokeText(text, x, y)
  g.fillStyle = fill
  g.fillText(text, x, y)
}
const clockLong = (sec) => {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

// The LIMITED card: struck-out list price, the cash price, a big red LIMITED and the stock left.
function makeLimitedCard(def) {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 420
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
  sprite.scale.set(6.4, 4.2, 1)
  let shown = ''
  let last = limitedStatus(def)
  function draw(force = false, st = last) {
    last = st
    const owned = !!state.gear.owned[def.id]
    const on = state.gear.on === def.id
    const key = `${owned}|${on}|${st.left}`
    if (key === shown && !force) return
    shown = key
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const F = 'Fredoka, "Arial Black", sans-serif'
    outlined(g, `$${short(def.was ?? def.price)}`, 220, 52, `700 52px ${F}`, '#c9ccd2', '#1b1030', 10)
    g.strokeStyle = '#ff2a3a'
    g.lineWidth = 8
    g.beginPath()
    g.moveTo(150, 56)
    g.lineTo(290, 48)
    g.stroke()
    outlined(g, `$${short(def.price)}`, 420, 52, `700 60px ${F}`, '#4dff6b', '#0b3a14', 12)
    g.save()
    g.translate(320, 160)
    g.transform(1, 0, -0.18, 1, 0, 0)
    const grad = g.createLinearGradient(0, -60, 0, 60)
    grad.addColorStop(0, '#ff6a6a')
    grad.addColorStop(1, '#d4101e')
    g.font = `700 112px ${F}`
    g.lineJoin = 'round'
    g.lineWidth = 18
    g.strokeStyle = '#3a0006'
    g.strokeText('LIMITED', 0, 0)
    g.fillStyle = grad
    g.fillText('LIMITED', 0, 0)
    g.restore()
    g.textAlign = 'center'
    outlined(g, `${st.left}`, 250, 262, `700 54px ${F}`, '#ff4a5a', '#2a0004', 10)
    outlined(g, `/${commas(st.stock)} LEFT`, 410, 262, `700 46px ${F}`, '#ffffff', '#1b1030', 10)
    if (owned) {
      pill(g, 320, 360, on ? 270 : 380, 72, on ? '#2bd9ff' : '#4f6bff', on ? '#0b4a63' : '#1d2a7a')
      outlined(g, on ? 'EQUIPPED' : 'OWNED · E TO WEAR', 320, 362, `700 ${on ? 44 : 34}px ${F}`, '#ffffff', 'rgba(0,0,0,0.35)', 6)
    } else {
      outlined(g, `${def.blocks}x Blocks · ${def.build}x Build · +${commas(def.capacity)} Capacity`, 320, 352, `600 28px ${F}`, '#ffffff', '#1b1030', 8)
    }
    tex.needsUpdate = true
  }
  draw()
  fontReady.then(() => draw(true))
  return { sprite, draw }
}

function makeCard(def) {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 360
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
  sprite.scale.set(6.4, 3.6, 1)
  let shown = ''
  function draw(force = false) {
    const owned = !!state.gear.owned[def.id]
    const on = state.gear.on === def.id
    const key = `${owned}|${on}`
    if (key === shown && !force) return
    shown = key
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const F = 'Fredoka, "Arial Black", sans-serif'
    outlined(g, def.name, 320, 62, `700 ${def.name.length > 15 ? 62 : 72}px ${F}`, '#ffffff', '#3b1477', 16)
    outlined(g, `${def.blocks}x Blocks Placed · ${def.build}x Build Speed`, 320, 132, `600 31px ${F}`, '#ffffff', '#1b1030', 8)
    outlined(g, `+${def.walk} Walk Speed · +${commas(def.capacity)} Capacity`, 320, 172, `600 31px ${F}`, '#ffffff', '#1b1030', 8)
    const ab = abilityText(def)
    if (ab) outlined(g, ab, 320, 216, `700 27px ${F}`, '#ffd23a', '#3a1a00', 8)
    const text = on ? 'EQUIPPED' : owned ? 'OWNED · E TO WEAR' : `$${short(def.price)}`
    const w = on ? 270 : owned ? 380 : 240
    pill(g, 320, 290, w, 76, on ? '#2bd9ff' : owned ? '#4f6bff' : '#3bd14a', on ? '#0b4a63' : owned ? '#1d2a7a' : '#126b1e')
    outlined(g, text, 320, 292, `700 ${owned && !on ? 36 : 46}px ${F}`, '#ffffff', 'rgba(0,0,0,0.35)', 6)
    tex.needsUpdate = true
  }
  draw()
  fontReady.then(() => draw(true))
  return { sprite, draw }
}

// A display mannequin wearing `id`, `scale` x a player, arms a little out.
function mannequin(id, seed, scale) {
  const root = makeWorkerBody(seed)
  const n = root.nodes
  const worn = wearGear(root, id, { merge: true }) // in the bind pose, then the arms come out a little
  if (n.ArmL1) n.ArmL1.rotation.z = 0.22
  if (n.ArmR1) n.ArmR1.rotation.z = -0.22
  const g = new Group()
  root.scale.multiplyScalar(scale)
  g.add(root)
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true
  })
  return { group: g, worn, root }
}

export function createRobotHall(scene) {
  const L = LAYOUT.robot
  const cx = L.x
  const hx0 = cx - L.hallW / 2
  const hx1 = cx + L.hallW / 2
  const bx0 = cx - L.barW / 2
  const bx1 = cx + L.barW / 2
  const root = new Group()
  root.name = 'robotGear'
  const statics = new Group()

  // --- Floor: dark slate pavers on a raised slab (one collider per rect).
  const pav = paintPavers(512, '#3a3654', 919)
  const floorMat = (w, d) => {
    const map = toTexture(pav.color, { srgb: true })
    const normal = toTexture(pav.normal)
    map.repeat.set(w / 7, d / 7)
    normal.repeat.set(w / 7, d / 7)
    return new MeshStandardMaterial({ map, normalMap: normal, normalScale: new Vector2(0.5, 0.5), roughness: 0.8 })
  }
  const rects = [
    [hx0, L.z0, hx1, L.hallEnd],
    [bx0, L.hallEnd, bx1, L.barEnd],
  ]
  const slab = std('#2a2640', { roughness: 0.85 })
  for (const [x0, z0, x1, z1] of rects) {
    const w = x1 - x0
    const d = z1 - z0
    box(statics, w, FLOOR_Y - 0.02, d, slab, (x0 + x1) / 2, 0, (z0 + z1) / 2)
    const top = new Mesh(new PlaneGeometry(w, d), floorMat(w, d))
    top.rotation.x = -Math.PI / 2
    top.position.set((x0 + x1) / 2, FLOOR_Y, (z0 + z1) / 2)
    top.receiveShadow = true
    root.add(top)
    solidBox(w / 2, FLOOR_Y / 2, d / 2, (x0 + x1) / 2, FLOOR_Y / 2, (z0 + z1) / 2)
  }

  // --- Low walls round the T with a neon strip on top; the entrance is a gap in the north wall.
  const wallMat = std('#2c2742', { roughness: 0.6, metalness: 0.2 })
  const capMat = std('#4a4466', { roughness: 0.5, metalness: 0.3 })
  const strip = neon('#2fe6ff', 3)
  const gate = 6
  const walls = [
    [hx0, L.z0, cx - gate, L.z0],
    [cx + gate, L.z0, hx1, L.z0],
    [hx0, L.z0, hx0, L.hallEnd],
    [hx1, L.z0, hx1, L.hallEnd],
    [bx0, L.hallEnd, hx0, L.hallEnd],
    [hx1, L.hallEnd, bx1, L.hallEnd],
    [bx0, L.hallEnd, bx0, L.barEnd],
    [bx1, L.hallEnd, bx1, L.barEnd],
    [bx0, L.barEnd, bx1, L.barEnd],
  ]
  const T = 0.7
  const H = 1.1
  for (const [x0, z0, x1, z1] of walls) {
    const alongX = z0 === z1
    const len = Math.abs(alongX ? x1 - x0 : z1 - z0) + T
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const w = alongX ? len : T
    const d = alongX ? T : len
    box(statics, w, H, d, wallMat, mx, 0, mz)
    box(statics, w + 0.1, 0.18, d + 0.1, capMat, mx, H, mz)
    box(statics, alongX ? len : 0.16, 0.08, alongX ? 0.16 : len, strip, mx, H + 0.18, mz, false)
    solidBox(w / 2, (H + 0.3) / 2, d / 2, mx, (H + 0.3) / 2, mz)
  }
  // Glowing lines on the floor: the walkway edges and a frame round the bar.
  const line = neon('#2fe6ff', 2.2)
  const ly = FLOOR_Y + 0.02
  for (const s of [-1, 1]) {
    box(statics, 0.22, 0.03, L.hallEnd - L.z0 - 1, line, cx + s * 4.6, ly, (L.z0 + L.hallEnd) / 2 + 0.5, false)
    box(statics, 0.22, 0.03, L.barEnd - L.hallEnd - 2, line, cx + s * (L.barW / 2 - 1.2), ly, (L.hallEnd + L.barEnd) / 2, false)
    box(statics, (L.barW - L.hallW) / 2 - 1.2, 0.03, 0.22, line, cx + s * ((L.hallW + L.barW) / 4 + 0.6), ly, L.hallEnd + 1.2, false)
  }
  box(statics, L.barW - 2.4, 0.03, 0.22, line, cx, ly, L.barEnd - 1.2, false)
  box(statics, 9.2, 0.03, 0.22, line, cx, ly, L.hallEnd + 1.2, false)

  // --- Entrance arch with the hall's name.
  for (const s of [-1, 1]) {
    box(statics, 1.3, 7.6, 1.3, wallMat, cx + s * (gate + 0.4), 0, L.z0)
    box(statics, 0.16, 6.6, 0.16, strip, cx + s * (gate + 0.4), 0.6, L.z0 + 0.7, false)
    box(statics, 0.16, 6.6, 0.16, strip, cx + s * (gate + 0.4), 0.6, L.z0 - 0.7, false)
    solidBox(0.65, 3.8, 0.65, cx + s * (gate + 0.4), 3.8, L.z0)
  }
  box(statics, gate * 2 + 2.4, 1.3, 1.3, wallMat, cx, 7.6, L.z0)
  box(statics, gate * 2 + 2.4, 0.14, 0.16, strip, cx, 8.1, L.z0 - 0.7, false)
  box(statics, gate * 2 + 2.4, 0.14, 0.16, strip, cx, 8.1, L.z0 + 0.7, false)
  const title = label('ROBOT GEAR', 2.8, { colors: ['#7dffe4', '#2fe6ff'], outline: '#06263a', outlineWidth: 18 })
  title.position.set(cx, 10.6, L.z0)
  root.add(title)
  const sub = label('BUILD FASTER WITH ROBOTS!', 0.9, { color: '#ffffff', outline: '#0b1a3a', outlineWidth: 12 })
  sub.position.set(cx, 9.0, L.z0)
  root.add(sub)
  const floorWord = flatText('ROBOT GEAR', 3.2, { colors: ['#7dffe4', '#2fe6ff'], outline: '#06263a', outlineWidth: 16 })
  floorWord.rotation.set(-Math.PI / 2, 0, Math.PI)
  floorWord.position.set(cx, FLOOR_Y + 0.03, L.hallEnd - 3.5)
  root.add(floorWord)

  // --- Lamp posts with glowing heads.
  const head = neon('#e9fbff', 2.6)
  for (const [x, z] of [[hx0 + 1.6, L.z0 + 2.2], [hx1 - 1.6, L.z0 + 2.2], [hx0 + 1.6, L.hallEnd - 2], [hx1 - 1.6, L.hallEnd - 2], [bx0 + 1.8, L.barEnd - 2], [bx1 - 1.8, L.barEnd - 2]]) {
    box(statics, 0.24, 5.2, 0.24, wallMat, x, FLOOR_Y, z)
    box(statics, 0.7, 0.9, 0.7, wallMat, x, FLOOR_Y + 5.1, z)
    box(statics, 0.5, 0.6, 0.5, head, x, FLOOR_Y + 5.25, z, false)
    solidPole(0.25, 5.5, x, z, FLOOR_Y)
  }

  // --- Pedestals.
  const pedestals = []
  const dynamic = []
  const pedGeo = (r) => new CylinderGeometry(r, r + 0.35, PED_H, 8)
  const pedMat = std('#34304a', { roughness: 0.55, metalness: 0.25 })
  const topMat = std('#4b4566', { roughness: 0.5, metalness: 0.2 })
  ROBOT_GEAR.forEach((def, i) => {
    if (def.spot) return // placed outside the hall below
    const onBar = def.bar != null
    const r = onBar ? 4.2 : 3.4
    const x = onBar ? cx + (def.bar - 2) * (L.barW / 5) : cx + def.side * 8.6
    const z = onBar ? (L.hallEnd + L.barEnd) / 2 + 1 : L.z0 + 10 + def.row * 13
    const face = onBar ? Math.PI : def.side > 0 ? -Math.PI / 2 : Math.PI / 2 // toward the walkway / entrance
    const base = new Mesh(pedGeo(r), pedMat)
    base.position.set(x, FLOOR_Y + PED_H / 2, z)
    base.rotation.y = Math.PI / 8
    base.castShadow = base.receiveShadow = true
    statics.add(base)
    const cap = new Mesh(new CylinderGeometry(r - 0.5, r - 0.5, 0.06, 8), topMat)
    cap.position.set(x, FLOOR_Y + PED_H + 0.03, z)
    cap.rotation.y = Math.PI / 8
    statics.add(cap)
    const rim = new Mesh(new RingGeometry(r - 0.5, r - 0.05, 8), neon(def.id === 'titan' ? '#ff2a3a' : '#ff9a1a', def.id === 'titan' ? 3.2 : 2.6))
    rim.rotation.set(-Math.PI / 2, 0, Math.PI / 8)
    rim.position.set(x, FLOOR_Y + PED_H + 0.07, z)
    root.add(rim)
    solidPole(r - 0.3, 3.4, x, z, FLOOR_Y)
    // Name plate on the pedestal's front edge.
    const plate = flatText(def.name.toUpperCase(), 0.42, { color: '#ffffff', outline: '#1b1030', outlineWidth: 10 })
    const fx = Math.sin(face)
    const fz = Math.cos(face)
    plate.position.set(x + fx * (r + 0.2), FLOOR_Y + PED_H * 0.55, z + fz * (r + 0.2))
    plate.rotation.y = face
    root.add(plate)

    // Display: the mannequin, plus the vehicle for the transformers and the dropship over Titan.
    const top = FLOOR_Y + PED_H + 0.06
    // Full suits are already a 2x giant around the mannequin (def.size); add-on gear is worn by a
    // mannequin a bit bigger than a player.
    const giant = def.size ?? 1
    const big = giant > 1 ? 0.95 : 1.6
    const m = mannequin(def.id, i * 3 + 1, big)
    const holder = new Group()
    holder.position.set(x, top, z)
    holder.rotation.y = face
    holder.add(m.group)
    root.add(holder)
    const show = { holder, worn: m.worn, base: face, extra: null, kind: null, x, z, top, phase: i * 0.9 }
    if (def.vehicle === 'jet') {
      const v = makeVehicle('jet', 0.42, { display: true })
      v.group.position.set(x, top + 9.5, z)
      root.add(v.group)
      show.extra = v
      show.kind = 'jet'
    } else if (def.vehicle) {
      m.group.position.x = -1.9
      const v = makeVehicle(def.vehicle, 0.32, { display: true })
      v.group.position.set(2.0, 0, -0.6)
      v.group.rotation.y = -0.5
      holder.add(v.group)
      show.extra = v
      show.kind = 'parked'
    } else if (def.ability === 'drop') {
      const ship = makeDropship()
      ship.group.scale.setScalar(0.62)
      ship.group.position.set(x, top + 11, z)
      ship.group.rotation.y = face
      root.add(ship.group)
      show.extra = ship
      show.kind = 'ship'
    }
    dynamic.push(show)
    const card = makeCard(def)
    card.sprite.position.set(x, top + big * giant * 1.9 + 2.6, z)
    root.add(card.sprite)
    // Sparkles rising off the pedestal in the gear's glow colour.
    createEmitter(scene, { boxes: [{ x, y: top + 0.4, z, sx: r * 0.6, sy: 0.3, sz: r * 0.6 }], count: onBar ? 36 : 24, life: 2.4, velocity: [0, 1.1, 0], spread: [0.25, 0.4, 0.25], size: 0.28, color: def.glow, intensity: 2.8, sprite: 'sparkle', twinkle: 6, seed: 40 + i })
    pedestals.push({ def, x, z, r, face, card, top })
  })

  // --- Outside the hall: the LIMITED pad and the showcase pad -----------------------------------------
  // LIMITED: a round dark pad with a glowing red rim and a cyan ring, the gear on a mannequin, a
  // floating "LIMITED" card (struck-out list price, cash price, stock left) and a sign with the countdown.
  const limitedCards = []
  for (const def of ROBOT_GEAR.filter((d) => d.spot === 'limited')) {
    const P = L.limited
    const pad = new Mesh(new CylinderGeometry(P.r, P.r + 0.3, 0.5, 40), std('#1d1d24', { roughness: 0.5, metalness: 0.3 }))
    pad.position.set(P.x, 0.25, P.z)
    pad.castShadow = pad.receiveShadow = true
    statics.add(pad)
    const red = new Mesh(new RingGeometry(P.r - 0.35, P.r + 0.25, 48), neon('#ff2a3a', 3.4))
    red.rotation.x = -Math.PI / 2
    red.position.set(P.x, 0.52, P.z)
    root.add(red)
    const cyan = new Mesh(new RingGeometry(1.05, 1.35, 40), neon('#2fe6ff', 3))
    cyan.rotation.x = -Math.PI / 2
    cyan.position.set(P.x, 0.53, P.z)
    root.add(cyan)
    solidPole(1.4, 3, P.x, P.z, 0)
    solidBox(P.r, 0.25, P.r, P.x, 0.25, P.z)
    const top = 0.52
    const m = mannequin(def.id, 31, 1.15)
    const holder = new Group()
    holder.position.set(P.x, top, P.z)
    holder.rotation.y = Math.PI
    holder.add(m.group)
    root.add(holder)
    // Carried gear stands on its legs: the mannequin is lifted until the lowest claw rests on the pad.
    dynamic.push({ holder, worn: m.worn, base: Math.PI, extra: null, kind: null, x: P.x, z: P.z, top, phase: 2.2, carry: !!def.carry, lift: 0 })
    // Countdown sign leaning against the pad's front (facing the road, -Z).
    const signC = document.createElement('canvas')
    signC.width = 512
    signC.height = 160
    const signTex = new CanvasTexture(signC)
    signTex.colorSpace = SRGBColorSpace
    const sign = new Mesh(new PlaneGeometry(3.6, 1.12), new MeshStandardMaterial({ map: signTex, roughness: 0.6, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.35 }))
    sign.position.set(P.x, 0.95, P.z - P.r - 0.15)
    sign.rotation.set(-0.35, Math.PI, 0)
    root.add(sign)
    box(statics, 3.8, 1.3, 0.16, std('#22222a'), P.x, 0.28, P.z - P.r - 0.05)
    const card = makeLimitedCard(def)
    card.sprite.position.set(P.x, top + 9, P.z)
    card.sprite.scale.multiplyScalar(1.2)
    root.add(card.sprite)
    createEmitter(scene, { boxes: [{ x: P.x, y: top + 0.4, z: P.z, sx: P.r * 0.7, sy: 0.3, sz: P.r * 0.7 }], count: 40, life: 2.4, velocity: [0, 1.3, 0], spread: [0.25, 0.4, 0.25], size: 0.3, color: '#ff3a4a', intensity: 3, sprite: 'sparkle', twinkle: 7, seed: 91 })
    const drawSign = (st) => {
      const g = signC.getContext('2d')
      g.fillStyle = '#16161c'
      g.fillRect(0, 0, 512, 160)
      g.fillStyle = '#2fe6ff'
      g.fillRect(0, 0, 14, 160)
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      outlined(g, def.name.toUpperCase(), 40, 52, '700 50px Fredoka, "Arial Black", sans-serif', '#ffffff', '#000000', 4)
      outlined(g, `ENDS IN ${clockLong(st.endsIn)}`, 40, 118, '700 40px Fredoka, "Arial Black", sans-serif', '#ffd23a', '#3a1a00', 6)
      signTex.needsUpdate = true
    }
    limitedCards.push({ card, drawSign, def })
    pedestals.push({ def, x: P.x, z: P.z, r: P.r - 1, face: Math.PI, card, top })
  }

  // Showcase: one gear out by the road on a hexagonal neon pad (default the Truck Transformer), its
  // robot with the vehicle parked beside it, a title and a hint sign.
  const S = L.showcase
  const sDef = ROBOT_GEAR.find((d) => d.id === S.gear)
  if (sDef) {
    const pad = new Mesh(new CylinderGeometry(S.r, S.r + 0.4, 0.6, 6), std('#2c2742', { roughness: 0.55, metalness: 0.25 }))
    pad.position.set(S.x, 0.3, S.z)
    pad.castShadow = pad.receiveShadow = true
    statics.add(pad)
    const pTop = new Mesh(new CylinderGeometry(S.r - 0.5, S.r - 0.5, 0.06, 6), std('#47406a', { roughness: 0.5 }))
    pTop.position.set(S.x, 0.63, S.z)
    statics.add(pTop)
    const rim = new Mesh(new RingGeometry(S.r - 0.5, S.r, 6), neon(sDef.glow, 3))
    rim.rotation.set(-Math.PI / 2, 0, 0)
    rim.position.set(S.x, 0.67, S.z)
    root.add(rim)
    solidBox(S.r * 0.85, 0.3, S.r * 0.85, S.x, 0.3, S.z)
    solidPole(2, 4, S.x, S.z, 0.6)
    const top = 0.66
    const m = mannequin(sDef.id, 57, 0.95)
    const holder = new Group()
    holder.position.set(S.x, top, S.z)
    holder.rotation.y = 0.6
    m.group.position.x = -1.9
    holder.add(m.group)
    const v = makeVehicle(sDef.vehicle, 0.32, { display: true })
    v.group.position.set(2.1, 0, -0.4)
    v.group.rotation.y = -0.4
    holder.add(v.group)
    root.add(holder)
    dynamic.push({ holder, worn: m.worn, base: 0.6, extra: v, kind: 'parked', x: S.x, z: S.z, top, phase: 4.1 })
    const title = label(sDef.name.toUpperCase(), 1.5, { colors: ['#e7a8ff', '#a45cff'], outline: '#1b0a33', outlineWidth: 18 })
    title.position.set(S.x, 9.2, S.z)
    root.add(title)
    const hint = label(sDef.ability === 'transform' ? `PRESS G: ${sDef.vehicle === 'truck' ? 'TRUCK' : 'VEHICLE'} ⇄ ROBOT!` : 'ROBOT GEAR', 0.6, { color: '#ffffff', outline: '#1b0a33', outlineWidth: 10 })
    hint.position.set(S.x, 8.1, S.z)
    root.add(hint)
    const card = makeCard(sDef)
    card.sprite.position.set(S.x, 5.6 + 0.66, S.z)
    card.sprite.scale.multiplyScalar(0.8)
    root.add(card.sprite)
    const plate = flatText(sDef.name.toUpperCase(), 0.4, { color: '#ffffff', outline: '#1b1030', outlineWidth: 10 })
    plate.position.set(S.x, 0.35, S.z - S.r * 0.87 - 0.12)
    plate.rotation.y = Math.PI
    root.add(plate)
    pedestals.push({ def: sDef, x: S.x, z: S.z, r: S.r - 1, face: Math.PI, card, top })
  }

  root.add(bake(statics, true))
  scene.add(root)

  // The entrance faces the main road: the spot just inside the gate (for the guide / teleports).
  const entrance = { x: cx, z: L.z0 + 3 }
  let limitedT = 0
  return {
    pedestals,
    entrance,
    refresh() {
      for (const p of pedestals) p.card.draw()
    },
    update(dt, elapsed) {
      limitedT -= dt
      if (limitedT <= 0) {
        limitedT = 0.5
        for (const l of limitedCards) {
          const st = limitedStatus(l.def)
          l.card.draw(false, st)
          l.drawSign(st)
        }
      }
      for (const s of dynamic) {
        s.holder.rotation.y = s.base + Math.sin(elapsed * 0.5 + s.phase) * 0.35
        s.worn.update(dt, { t: elapsed + s.phase, thrust: 0.55 + 0.25 * Math.sin(elapsed * 3 + s.phase), building: false, speed: 0, step: elapsed * 1.6, moving: !!s.carry })
        if (s.carry) {
          let low = Infinity
          for (const c of s.worn.points.claws) {
            c.getWorldPosition(tmpV)
            if (tmpV.y < low) low = tmpV.y
          }
          if (low < Infinity) s.lift = Math.max(0, s.lift + (s.top + 0.05 - low) * Math.min(1, dt * 4))
          s.holder.position.y = s.top + s.lift + Math.abs(Math.sin(elapsed * 1.6)) * 0.08
          s.holder.rotation.y = s.base + elapsed * 0.25 // slowly walks round on the spot
          continue
        }
        if (s.kind === 'jet') {
          const a = elapsed * 0.45 + s.phase
          s.extra.group.position.set(s.x + Math.cos(a) * 3.2, s.top + 9.5 + Math.sin(elapsed * 1.3) * 0.5, s.z + Math.sin(a) * 2)
          s.extra.group.rotation.set(0, -a, Math.sin(elapsed * 0.9) * 0.25)
          s.extra.update(dt, { thrust: 0.8, airborne: true })
        } else if (s.kind === 'ship') {
          s.extra.group.position.y = s.top + 11 + Math.sin(elapsed * 1.1) * 0.6
          s.extra.group.rotation.z = Math.sin(elapsed * 0.8) * 0.05
          s.extra.update(dt)
        } else if (s.kind === 'parked') {
          s.extra.update(dt, { thrust: 0, speed: 0 })
        }
      }
    },
  }
}

export { ROBOT }
