import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  ShaderMaterial,
  SpotLight,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { LAYOUT, NIGHT_LIGHTS, ROBOT_GEAR } from './config.js'
import { box, cyl, solidBox, solidPole, std } from './propkit.js'
import { mats } from './props.js'
import { bakeStill } from './bake.js'
import { headlampMaterial } from './characters.js'

// Lights for the night, all fading in with the street lamps (lighting.onNightChange):
//  - construction light towers (trailer, telescopic mast, 2x2 lamp head) round the building's
//    foot, aimed up its walls, and one over the Blocks pit
//  - a floodlight on each crane mast, kept a little above the roof and aimed at it
//  - a spotlight pole behind every Robot Gear pedestal, aimed at the mannequin
//  - a headlamp on your hard hat (the beam follows where you face) and a soft glow around you,
//    tinted by the gear you wear
// Every lamp head glows and casts a fake light beam; only the kinds whose tier the graphics
// preset allows (NIGHT_LIGHTS.*.tier <= preset.nightLights) also get a real light. All lights
// are created at boot and only change intensity, so the light count (and the shaders) never change.

const L = NIGHT_LIGHTS

// --- Shared looks ------------------------------------------------------------------------------
const lensMat = new MeshStandardMaterial({ color: '#fffaf0', emissive: L.lens, emissiveIntensity: 0.1, roughness: 0.25 })
const housingMat = std('#30333a', { roughness: 0.6, metalness: 0.4 })

// A cone of light in the air: brightest at the lamp, fading along its length and toward the
// silhouette edges, added on top of the scene (no real light).
const beamVertex = /* glsl */ `
  varying float vAlong;
  varying float vFacing;
  void main() {
    vAlong = uv.y; // 1 at the lamp, 0 at the far end
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }`
const beamFragment = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlong;
  varying float vFacing;
  void main() {
    // clamp: pow() of a value interpolated a hair below 0 is NaN on some drivers (black boxes with bloom).
    float a = opacity * pow(clamp(vAlong, 0.0, 1.0), 1.6) * pow(clamp(vFacing, 0.0, 1.0), 1.4);
    gl_FragColor = vec4(color * a, 1.0);
  }`
function beamMaterial(color, opacity) {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(color) }, opacity: { value: 0 } },
    userData: { max: opacity },
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  })
}
// Unit cone: apex at the origin, opening along +z (length 1, end radius 1); scaled per beam.
const beamGeo = new ConeGeometry(1, 1, 24, 1, true)
beamGeo.translate(0, -0.5, 0)
beamGeo.rotateX(-Math.PI / 2)

let haloTex = null
function haloTexture() {
  if (haloTex) return haloTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,240,210,0.55)')
  grad.addColorStop(1, 'rgba(255,220,170,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  haloTex = new CanvasTexture(c)
  haloTex.colorSpace = SRGBColorSpace
  return haloTex
}
const haloMat = new SpriteMaterial({ map: null, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false })
haloMat.visible = false // shown once night fades the halos in (setLevel)

// A lamp head facing +z: `cols` x `rows` lamp panels on a bar, each with a lens and a halo.
function makeHead(cols, rows, size = 0.8) {
  const g = new Group()
  const w = cols * size + (cols - 1) * 0.08
  const h = rows * size * 0.8 + (rows - 1) * 0.08
  box(g, w + 0.2, 0.14, 0.14, mats.dark(), 0, -h / 2 - 0.2, -0.1)
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = -w / 2 + size / 2 + i * (size + 0.08)
      const y = -h / 2 + (size * 0.8) / 2 + j * (size * 0.8 + 0.08)
      box(g, size, size * 0.8, 0.36, housingMat, x, y - size * 0.4, -0.05)
      box(g, size * 0.86, size * 0.66, 0.04, lensMat, x, y - size * 0.33, 0.14, false)
      const halo = new Sprite(haloMat)
      halo.position.set(x, y, 0.3)
      halo.scale.setScalar(size * 3.2)
      g.add(halo)
    }
  }
  bakeStill([g], () => {}, 0) // the head's parts never move against it: one mesh per material (the head itself still aims)
  return g
}

// A mobile light tower: trailer, outriggers, a telescopic mast and a 2x2 lamp head on top.
function makeLightTower(mast) {
  const g = new Group()
  const y = mats.yellow()
  box(g, 3.0, 0.9, 1.6, y, 0, 0.45, 0)
  box(g, 2.6, 0.5, 1.4, y, 0, 1.35, 0)
  for (const s of [-1, 1]) {
    const wheel = cyl(g, 0.42, 0.3, mats.dark(), 0, 0, 0, 12)
    wheel.rotation.x = Math.PI / 2
    wheel.position.set(-0.2, 0.42, s * 0.95)
    box(g, 0.14, 0.14, 1.3, mats.dark(), 1.3, 0.1, s * 1.2) // outrigger
    box(g, 0.14, 0.14, 1.3, mats.dark(), -1.3, 0.1, s * 1.2)
  }
  box(g, 1.2, 0.12, 0.12, mats.dark(), 2.0, 0.55, 0) // tow bar
  cyl(g, 0.16, mast, mats.white(), 0.6, 1.8, 0, 8)
  cyl(g, 0.11, 0.8, mats.dark(), 0.6, 1.8 + mast, 0, 8)
  const head = makeHead(2, 2)
  head.position.set(0.6, 2.8 + mast, 0)
  g.add(head)
  return { group: g, head }
}

// A spotlight pole for a gear pedestal: a dark pole with one lamp on a short arm.
function makePole(h) {
  const g = new Group()
  cyl(g, 0.28, 0.3, mats.dark(), 0, 0, 0, 8)
  cyl(g, 0.09, h, mats.dark(), 0, 0, 0, 8)
  const head = makeHead(1, 1, 0.7)
  head.position.set(0, h + 0.2, 0.35)
  g.add(head)
  return { group: g, head }
}

export function createNightLights({ scene, lighting, tower, cranes, hall, preset }) {
  const group = new Group()
  group.name = 'nightLights'
  scene.add(group)
  const tier = preset?.nightLights ?? 1
  haloMat.map = haloTexture()
  const beams = [] // { mesh, mat }
  const spots = [] // { light, max }
  const tmp = new Vector3()

  // A beam from `from` toward `to`, `angle` wide (radians, half-angle), `len` metres long.
  const beamMats = new Map()
  function addBeam(from, to, angle, len, color = L.beam.color, opacity = L.beam.opacity) {
    const key = `${color}|${opacity}`
    let mat = beamMats.get(key)
    if (!mat) beamMats.set(key, (mat = beamMaterial(color, opacity)))
    const mesh = new Mesh(beamGeo, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    group.add(mesh)
    const b = { mesh, angle, len }
    aimBeam(b, from, to)
    beams.push(b)
    return b
  }
  function aimBeam(b, from, to) {
    const r = Math.tan(b.angle) * b.len
    b.mesh.position.copy(from)
    b.mesh.scale.set(r, r, b.len)
    b.mesh.lookAt(to)
  }
  // A real spotlight (only if the preset allows this kind's tier).
  function addSpot(kind, color, intensity, angle, penumbra, distance = 0) {
    if (kind.tier > tier) return null
    const light = new SpotLight(color, 0, distance, angle, penumbra, 2)
    group.add(light, light.target)
    spots.push({ light, max: intensity })
    return light
  }
  function aimSpot(light, from, to) {
    if (!light) return
    light.position.copy(from)
    light.target.position.copy(to)
    light.target.updateMatrixWorld()
  }
  // Lamp head world position (its lens face), for beams and lights.
  const lensPoint = (head, out) => out.set(0, 0, 0.35).applyMatrix4(head.matrixWorld)

  // --- Light towers round the building's foot (moved when the next building starts) -----------
  const G = L.ground
  const towers = [0, 1, 2, 3].map(() => {
    const t = makeLightTower(G.mast)
    group.add(t.group)
    return { ...t, collider: solidBox(1.5, 0.9, 0.8, 0, -40, 0), light: addSpot(G, G.color, G.intensity, G.angle, G.penumbra), beam: null }
  })
  const towerFrom = new Vector3()
  function placeTowers() {
    const C = tower.center
    const s = tower.spec.size
    const d = s + G.out
    // North corners, and the south corners outside the elevator / stairs.
    const at = [[-d, -d], [d, -d], [-d - 4, d - 4], [d + 4, d - 4]]
    towers.forEach((t, i) => {
      const x = C.x + at[i][0]
      const z = C.z + at[i][1]
      const yaw = Math.atan2(C.x - x, C.z - z)
      t.group.position.set(x, 0, z)
      t.group.rotation.y = yaw - Math.PI / 2 // trailer side-on, tow bar pointing round the corner
      t.collider.setTranslation({ x, y: 0.9, z })
      t.collider.setRotation({ x: 0, y: Math.sin((yaw - Math.PI / 2) / 2), z: 0, w: Math.cos((yaw - Math.PI / 2) / 2) })
      t.group.updateMatrixWorld(true)
      // Aim the head up the building's wall (lower while it is still short).
      const aim = tmp.set(C.x, Math.max(1, Math.min(G.aimY, tower.visibleTop * 0.5)), C.z)
      t.head.lookAt(aim)
      t.head.updateMatrixWorld(true)
      const from = lensPoint(t.head, towerFrom)
      if (t.beam) aimBeam(t.beam, from, aim)
      else t.beam = addBeam(from, aim, G.angle * 0.55, Math.min(26, from.distanceTo(aim) * 0.8))
      aimSpot(t.light, from, aim)
    })
  }
  placeTowers()
  tower.on('building', placeTowers)
  tower.on('height', placeTowers)

  // --- Pit light tower -----------------------------------------------------------------------------
  {
    const P = L.pit
    const t = makeLightTower(P.mast)
    const pit = LAYOUT.pit
    const yaw = Math.atan2(pit.x - P.x, pit.z - P.z)
    t.group.position.set(P.x, 0, P.z)
    t.group.rotation.y = yaw - Math.PI / 2
    group.add(t.group)
    solidBox(1.5, 0.9, 0.8, P.x, 0.9, P.z, yaw - Math.PI / 2)
    t.group.updateMatrixWorld(true)
    const aim = new Vector3(pit.x, 0, pit.z)
    t.head.lookAt(aim)
    t.head.updateMatrixWorld(true)
    const from = lensPoint(t.head, new Vector3())
    addBeam(from, aim, P.angle * 0.55, from.distanceTo(aim) * 0.85)
    aimSpot(addSpot(P, G.color, P.intensity, P.angle, P.penumbra), from, aim)
  }

  // --- Crane-mast floodlights on the roof -------------------------------------------------------------
  const R = L.roof
  const floods = cranes.masts.map((pos) => {
    const g = new Group()
    box(g, 0.2, 0.2, 1.8, mats.dark(), 0, -0.1, -0.9) // bracket back to the mast
    const head = makeHead(3, 1, 0.9)
    g.add(head)
    group.add(g)
    return { pos, g, head, light: addSpot(R, R.color, R.intensity, R.angle, R.penumbra), beam: null, y: -1 }
  })
  const roofAim = new Vector3()
  const floodFrom = new Vector3()
  function placeFloods() {
    const C = tower.center
    const top = tower.visibleTop
    for (const f of floods) {
      const y = top + R.above
      if (Math.abs(y - f.y) < 0.01 && f.beam) continue
      f.y = y
      // Hang the head on the tower side of the mast, aimed at the middle of the roof.
      const dx = C.x - f.pos.x
      const dz = C.z - f.pos.z
      const len = Math.hypot(dx, dz) || 1
      f.g.position.set(f.pos.x + (dx / len) * 2.2, y, f.pos.z + (dz / len) * 2.2)
      roofAim.set(C.x, top, C.z)
      f.g.lookAt(roofAim)
      f.g.updateMatrixWorld(true)
      lensPoint(f.head, floodFrom)
      if (f.beam) aimBeam(f.beam, floodFrom, roofAim)
      else f.beam = addBeam(floodFrom, roofAim, R.angle * 0.5, floodFrom.distanceTo(roofAim) * 0.75)
      aimSpot(f.light, floodFrom, roofAim)
    }
  }
  placeFloods()

  // --- Robot Gear hall: a spotlight pole behind every pedestal ------------------------------------------
  const GR = L.gear
  const gearSpots = []
  for (const p of hall?.pedestals ?? []) {
    // Behind the pedestal (opposite the side its mannequin faces), leaning in over it.
    const bx = p.x - Math.sin(p.face) * (p.r + 0.9)
    const bz = p.z - Math.cos(p.face) * (p.r + 0.9)
    const pole = makePole(GR.pole)
    pole.group.position.set(bx, p.top - 0.06, bz)
    pole.group.rotation.y = p.face
    group.add(pole.group)
    solidPole(0.25, GR.pole, bx, bz, p.top - 0.06)
    pole.group.updateMatrixWorld(true)
    const aim = new Vector3(p.x, p.top + 1.2, p.z)
    pole.head.lookAt(aim)
    pole.head.updateMatrixWorld(true)
    const from = lensPoint(pole.head, new Vector3())
    const glow = ROBOT_GEAR.find((d) => d.id === p.def.id)?.glow ?? L.beam.color
    addBeam(from, new Vector3(p.x, p.top, p.z), GR.angle * 0.6, from.distanceTo(aim) * 1.25, glow, L.beam.opacity * 1.3)
    gearSpots.push({ from, aim })
  }
  // Real lights: two of them light the whole hall (one over the walkway, one over the bar of the T).
  if (gearSpots.length && GR.tier <= tier) {
    const H = LAYOUT.robot
    const mid = new Vector3(H.x, 0.4, (H.z0 + H.hallEnd) / 2)
    const bar = new Vector3(H.x, 0.4, (H.hallEnd + H.barEnd) / 2)
    aimSpot(addSpot(GR, GR.color, GR.intensity, 0.95, 0.7), tmp.set(H.x, 18, mid.z - 8), mid)
    aimSpot(addSpot(GR, GR.color, GR.intensity, 0.95, 0.7), tmp.set(H.x, 18, bar.z - 10), bar)
  }

  // --- You: a headlamp on the hard hat + a soft glow over you ----------------------------------------
  const HL = L.headlamp
  const headlamp = addSpot(HL, HL.color, HL.intensity, HL.angle, HL.penumbra, HL.distance)
  const AU = L.aura
  let aura = null
  if (AU.tier <= tier) {
    aura = new PointLight(AU.color, 0, AU.distance, 2)
    group.add(aura)
  }
  const auraColor = new Color(AU.color)
  const gearColor = new Color()
  let auraMax = 0
  const headBeam = addBeam(new Vector3(), new Vector3(0, 0, 1), HL.angle * 0.55, HL.reach * 1.1, HL.color, L.beam.opacity * 0.8)
  let lampObj = null // the avatar's hard-hat lamp
  let lampOf = null
  const shown = (o) => {
    for (; o; o = o.parent) if (!o.visible) return false
    return true
  }
  const eye = new Vector3()
  const ahead = new Vector3()

  // --- Day / night ------------------------------------------------------------------------------------
  let level = 0
  function setLevel(f) {
    level = f
    lensMat.emissiveIntensity = 0.1 + f * 5
    headlampMaterial.emissiveIntensity = 0.15 + f * 5
    haloMat.opacity = Math.min(1, f * 0.9)
    haloMat.visible = haloMat.opacity > 0.001 // fully faded by day: skip the draw calls
    for (const m of beamMats.values()) m.uniforms.opacity.value = m.userData.max * f
    const on = f > 0.02
    for (const b of beams) b.mesh.visible = on
    for (const s of spots) s.light.intensity = s.max * f
    auraMax = AU.intensity * f
  }
  lighting.onNightChange((night, lampFactor) => setLevel(lampFactor))

  return {
    // Every frame: the roof floods follow the roof, the headlamp follows your head and facing.
    update(dt, { group: you, avatar, facing, gearOn }) {
      placeFloods()
      if (level <= 0.02) {
        headBeam.mesh.visible = false
        if (aura) aura.intensity = 0
        return
      }
      if (avatar !== lampOf) {
        lampOf = avatar
        lampObj = avatar?.getObjectByName('headlamp') ?? null
      }
      const scale = you.scale.y || 1
      if (lampObj && shown(lampObj)) lampObj.getWorldPosition(eye)
      else eye.set(you.position.x, you.position.y + 1.75 * scale, you.position.z) // under a helmet / as a vehicle
      const fx = Math.sin(facing)
      const fz = Math.cos(facing)
      eye.x += fx * 0.15
      eye.z += fz * 0.15
      ahead.set(eye.x + fx * HL.reach, eye.y - Math.tan(HL.pitch) * HL.reach, eye.z + fz * HL.reach)
      aimSpot(headlamp, eye, ahead)
      aimBeam(headBeam, eye, ahead)
      headBeam.mesh.visible = you.visible
      if (aura) {
        aura.position.set(you.position.x, you.position.y + AU.height * scale, you.position.z)
        const glow = gearOn ? ROBOT_GEAR.find((d) => d.id === gearOn)?.glow : null
        aura.color.copy(glow ? gearColor.set(glow).lerp(auraColor, 0.35) : auraColor)
        aura.intensity = you.visible ? auraMax * (glow ? 1.4 : 1) : 0
      }
    },
  }
}
