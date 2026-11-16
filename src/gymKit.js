import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  DynamicDrawUsage,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bake } from './bake.js'
import { neon, setNeonK, std } from './propkit.js'
import { paintBelt, paintFade, paintHazard, toTexture } from './textures.js'

// Gym models: the bench press and treadmill every pad gets (detailed, coloured per tier), the
// themed decor of each pad, the padlock + force field over a locked pad, and the treadmill's
// live console screen. Builders return `fixed` parts (gym.js bakes them with the rest of the
// gym) and `live` parts that move or glow on their own.
//
// Everything static is painted per vertex on a few shared materials (`finish`), so baking
// merges the whole gym's machines and decor into a handful of meshes whatever the colours.

const tmpC = new Color()
const KIT = {}
const kit = (k, make) => KIT[k] || (KIT[k] = make())
const finish = {
  matte: () => kit('matte', () => std('#ffffff', { vertexColors: true, roughness: 0.62 })),
  soft: () => kit('soft', () => std('#ffffff', { vertexColors: true, roughness: 0.9 })),
  metal: () => kit('metal', () => std('#ffffff', { vertexColors: true, roughness: 0.32, metalness: 0.6 })),
  chrome: () => kit('chrome', () => std('#ffffff', { vertexColors: true, roughness: 0.16, metalness: 0.9 })),
  glow: () => kit('glow', () => neon('#ffffff', 2.4, { vertexColors: true })),
}

function painted(geo, color) {
  tmpC.set(color)
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = tmpC.r
    a[i * 3 + 1] = tmpC.g
    a[i * 3 + 2] = tmpC.b
  }
  geo.setAttribute('color', new Float32BufferAttribute(a, 3))
  return geo
}
// A mesh on a shared finish (`f`), or on its own material when `f` is a Material.
function add(parent, geo, f, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = typeof f === 'string' ? new Mesh(painted(geo, color), finish[f]()) : new Mesh(geo, f)
  m.position.set(x, y, z)
  m.rotation.set(rx, ry, rz)
  m.castShadow = m.receiveShadow = true
  parent.add(m)
  return m
}
// Box / rounded box / upright cylinder with the base at y; a cylinder along X centred at y.
const B = (p, w, h, d, f, c, x, y, z, rx = 0, ry = 0) => add(p, new BoxGeometry(w, h, d), f, c, x, y + h / 2, z, rx, ry)
const RB = (p, w, h, d, r, f, c, x, y, z) => add(p, new RoundedBoxGeometry(w, h, d, 2, r), f, c, x, y + h / 2, z)
const CY = (p, r, h, f, c, x, y, z, seg = 12, rTop = r) => add(p, new CylinderGeometry(rTop, r, h, seg), f, c, x, y + h / 2, z)
const CX = (p, r, len, f, c, x, y, z, seg = 12) => add(p, new CylinderGeometry(r, r, len, seg), f, c, x, y, z, 0, 0, Math.PI / 2)
const TUBE = (p, pts, r, f, c, seg = 14) => add(p, new TubeGeometry(new CatmullRomCurve3(pts.map(([x, y, z]) => new Vector3(x, y, z))), seg, r, 6, false), f, c)
const shade = (hex, k) => '#' + tmpC.set(hex).multiplyScalar(k).getHexString()

// A weight plate (raised hub and rim) turned on a lathe, axis along X.
function plateGeo(R, W) {
  const h = W / 2
  const prof = [
    [0.03, -h * 0.8], [R * 0.24, -h * 0.8], [R * 0.26, -h * 0.45], [R * 0.8, -h * 0.45], [R * 0.84, -h], [R, -h],
    [R, h], [R * 0.84, h], [R * 0.8, h * 0.45], [R * 0.26, h * 0.45], [R * 0.24, h * 0.8], [0.03, h * 0.8],
  ].map(([r, y]) => new Vector2(r, y))
  return new LatheGeometry(prof, 16).rotateZ(-Math.PI / 2)
}

// --- Bench press ------------------------------------------------------------------------------
// Local frame: feet toward +Z, the rack at the head end (-Z), base on the pad at y = 0. The
// bar rests on the J-hooks at barRest, `barZ` from the bench centre; main.js moves it
// between barLow (on the chest) and barHigh (arms locked out). The cushion top is at 0.645.
export const BENCH = { barZ: -1.0, barRest: 1.42, barLow: 1.1, barHigh: 1.52 }

export function buildBench(t) {
  const fixed = new Group()
  const live = new Group()
  const dark = '#24262b'
  const rubber = '#141518'
  const steel = '#b4bbc5'
  // Floor frame: rack foot, foot-end stabiliser, spine and posts.
  B(fixed, 1.56, 0.07, 0.16, 'metal', t.frame, 0, 0, -1.1)
  B(fixed, 0.8, 0.07, 0.14, 'metal', t.frame, 0, 0, 1.08)
  for (const s of [-1, 1]) {
    B(fixed, 0.14, 0.09, 0.22, 'soft', rubber, s * 0.8, 0, -1.1)
    B(fixed, 0.12, 0.09, 0.2, 'soft', rubber, s * 0.42, 0, 1.08)
  }
  B(fixed, 0.12, 0.12, 2.12, 'metal', t.frame, 0, 0.05, -0.02)
  for (const z of [-0.65, 0.6]) B(fixed, 0.1, 0.26, 0.1, 'metal', t.frame, 0, 0.16, z)
  // Board + padded cushion with piping and a glowing badge at the foot end.
  B(fixed, 0.5, 0.04, 2.0, 'matte', dark, 0, 0.42, 0)
  RB(fixed, 0.64, 0.19, 2.2, 0.07, 'soft', t.cushion, 0, 0.455, 0)
  for (const s of [-1, 1]) B(fixed, 0.016, 0.03, 2.04, 'matte', t.trim, s * 0.322, 0.53, 0)
  B(fixed, 0.3, 0.006, 0.14, 'glow', t.color, 0, 0.642, 0.82)
  // Leg roller at the foot end.
  B(fixed, 0.08, 0.3, 0.08, 'metal', t.frame, 0, 0.07, 1.08)
  CX(fixed, 0.022, 0.62, 'chrome', steel, 0, 0.37, 1.08)
  for (const s of [-1, 1]) CX(fixed, 0.085, 0.22, 'soft', t.cushion, s * 0.2, 0.37, 1.08)
  // The rack: uprights with peg holes, J-hooks, spotter arms, braces, plate horns.
  for (const s of [-1, 1]) {
    const x = s * 0.55
    B(fixed, 0.1, 1.7, 0.1, 'metal', t.frame, x, 0.07, -1.1)
    for (let i = 0; i < 10; i++) B(fixed, 0.034, 0.034, 0.012, 'matte', '#0e0f12', x, 0.6 + i * 0.11, -1.05)
    B(fixed, 0.012, 1.0, 0.012, 'glow', t.color, x + s * 0.044, 0.55, -1.046)
    B(fixed, 0.08, 0.04, 0.17, 'chrome', steel, x, 1.35, -0.98)
    B(fixed, 0.08, 0.09, 0.03, 'chrome', steel, x, 1.35, -0.905)
    B(fixed, 0.07, 0.07, 0.5, 'metal', t.trim, x, 0.9, -0.82)
    B(fixed, 0.08, 0.02, 0.48, 'soft', rubber, x, 0.97, -0.82)
    B(fixed, 0.09, 0.08, 0.5, 'metal', t.frame, x, 0, -1.38)
    add(fixed, new BoxGeometry(0.07, 0.95, 0.07), 'metal', t.frame, x, 0.5, -1.3, 0.42)
    CX(fixed, 0.03, 0.36, 'chrome', steel, s * 0.78, 0.36, -1.1)
    CX(fixed, 0.3, 0.06, 'metal', shade(t.color, 0.55), s * 0.72, 0.36, -1.1, 16)
    CX(fixed, 0.22, 0.05, 'metal', t.trim, s * 0.8, 0.36, -1.1, 14)
  }
  B(fixed, 1.2, 0.09, 0.1, 'metal', t.frame, 0, 1.77, -1.1)
  RB(fixed, 0.72, 0.24, 0.06, 0.03, 'matte', t.trim, 0, 1.86, -1.1)
  B(fixed, 0.56, 0.04, 0.01, 'glow', t.color, 0, 1.96, -1.066)

  // The bar (live): shaft, knurling, collars, sleeves, three plates a side, glowing rings.
  const barG = new Group()
  const ringMat = neon(t.color, 2)
  CX(barG, 0.026, 1.62, 'chrome', '#e9edf2', 0, 0, 0)
  for (const s of [-1, 1]) {
    CX(barG, 0.03, 0.36, 'metal', '#7d848e', s * 0.42, 0, 0)
    CX(barG, 0.062, 0.05, 'chrome', '#e9edf2', s * 0.835, 0, 0)
    CX(barG, 0.043, 0.44, 'chrome', '#e9edf2', s * 1.08, 0, 0)
    add(barG, plateGeo(0.38, 0.075), 'metal', t.color, s * 0.9, 0, 0)
    add(barG, plateGeo(0.3, 0.065), 'metal', shade(t.color, 0.55), s * 0.975, 0, 0)
    add(barG, plateGeo(0.22, 0.055), 'metal', t.trim, s * 1.04, 0, 0)
    CX(barG, 0.06, 0.045, 'chrome', '#c9ced6', s * 1.095, 0, 0)
    for (const f of [-1, 1]) add(barG, new TorusGeometry(0.3, 0.014, 4, 28), ringMat, null, s * 0.9 + f * 0.04, 0, 0, 0, Math.PI / 2)
    add(barG, new CylinderGeometry(0.046, 0.046, 0.012, 14), ringMat, null, s * 1.302, 0, 0, 0, 0, Math.PI / 2)
  }
  const bar = new Group()
  bar.add(bake(barG, true))
  bar.position.set(0, BENCH.barRest, BENCH.barZ)
  live.add(bar)
  return { fixed, live, bar, ringMat }
}

// --- Treadmill --------------------------------------------------------------------------------
// Local frame: console at -Z, the runner faces it standing on the belt (deck top 0.3). The
// belt texture scrolls toward the rear (+Z) while someone runs.
export const TREAD = { beltLength: 2.36, beltRepeat: 4 }

export function buildTreadmill(t) {
  const fixed = new Group()
  const live = new Group()
  const dark = '#202227'
  const rubber = '#141518'
  const steel = '#b4bbc5'
  // Deck: side rails with grip strips and trim, feet, the bed under the belt, rollers, rear cap.
  for (const s of [-1, 1]) {
    RB(fixed, 0.2, 0.25, 2.56, 0.05, 'matte', t.frame, s * 0.56, 0.05, 0.12)
    B(fixed, 0.15, 0.012, 2.4, 'soft', '#2b2d33', s * 0.56, 0.296, 0.14)
    B(fixed, 0.012, 0.05, 2.2, 'matte', t.trim, s * 0.664, 0.14, 0.14)
    for (const z of [-0.95, 1.25]) B(fixed, 0.2, 0.05, 0.22, 'soft', rubber, s * 0.56, 0, z)
    CX(fixed, 0.06, 0.06, 'soft', rubber, s * 0.62, 0.06, 1.47)
  }
  B(fixed, 0.94, 0.2, 2.42, 'matte', dark, 0, 0.08, 0.14)
  for (const z of [-1.04, 1.32]) CX(fixed, 0.07, 0.95, 'chrome', steel, 0, 0.22, z)
  RB(fixed, 1.3, 0.16, 0.14, 0.05, 'matte', t.trim, 0, 0.08, 1.44)
  // Motor hood with vents and a glowing badge.
  RB(fixed, 1.32, 0.36, 0.56, 0.09, 'matte', t.frame, 0, 0.02, -1.36)
  for (let i = 0; i < 4; i++) B(fixed, 0.74, 0.012, 0.04, 'matte', '#0e0f12', 0, 0.376, -1.5 + i * 0.08)
  B(fixed, 0.56, 0.06, 0.012, 'glow', t.color, 0, 0.17, -1.076)
  // Uprights, console, handrails, grips, cup holders.
  for (const s of [-1, 1]) add(fixed, new BoxGeometry(0.09, 1.08, 0.12), 'metal', t.frame, s * 0.6, 0.86, -1.5, -0.16)
  const con = new Group()
  con.position.set(0, 1.47, -1.6)
  con.rotation.x = -0.6
  fixed.add(con)
  RB(con, 1.24, 0.42, 0.16, 0.06, 'matte', t.frame, 0, -0.21, 0)
  B(con, 0.7, 0.33, 0.02, 'matte', '#07080a', 0, -0.165, 0.075)
  const keys = ['#3bff7a', '#ffd23a', '#ff4a3a']
  keys.forEach((k, i) => B(con, 0.07, 0.045, 0.025, 'glow', k, -0.48, 0.04 - i * 0.085, 0.075))
  for (const y of [0.07, -0.05]) add(con, new CylinderGeometry(0.045, 0.045, 0.02, 16), 'matte', '#0b0c0e', 0.48, y, 0.08, Math.PI / 2)
  add(con, new CylinderGeometry(0.022, 0.022, 0.05, 10), 'matte', '#ff2a2a', 0.48, -0.15, 0.09, Math.PI / 2)
  B(con, 1.0, 0.025, 0.012, 'glow', t.color, 0, 0.165, 0.08)
  for (const s of [-1, 1]) {
    TUBE(fixed, [[s * 0.6, 1.36, -1.56], [s * 0.64, 1.22, -1.3], [s * 0.63, 1.08, -0.95], [s * 0.6, 1.02, -0.62]], 0.028, 'chrome', steel)
    TUBE(fixed, [[s * 0.632, 1.1, -1.0], [s * 0.61, 1.03, -0.68], [s * 0.6, 1.0, -0.52]], 0.04, 'soft', rubber, 8)
    B(fixed, 0.1, 0.02, 0.05, 'metal', t.frame, s * 0.68, 1.2, -1.33)
    CY(fixed, 0.055, 0.09, 'matte', t.trim, s * 0.74, 1.2, -1.33, 12)
  }
  TUBE(fixed, [[-0.6, 1.3, -1.45], [-0.3, 1.2, -1.32], [0.3, 1.2, -1.32], [0.6, 1.3, -1.45]], 0.026, 'chrome', steel)

  // Live: belt, underglow LEDs, the console screen.
  const beltTex = toTexture(paintBelt(t.color), { srgb: true })
  beltTex.wrapS = beltTex.wrapT = RepeatWrapping
  beltTex.repeat.set(1, TREAD.beltRepeat)
  const belt = new Mesh(new PlaneGeometry(0.92, TREAD.beltLength), std('#ffffff', { map: beltTex, roughness: 0.92 }))
  belt.rotation.x = -Math.PI / 2
  belt.position.set(0, 0.292, 0.14)
  belt.receiveShadow = true
  live.add(belt)
  const ledMat = neon(t.color, 1.2)
  const ledG = new Group()
  for (const s of [-1, 1]) add(ledG, new BoxGeometry(0.02, 0.022, 2.3), ledMat, null, s * 0.668, 0.075, 0.14)
  live.add(bake(ledG))
  const screen = makeScreen(t)
  const sm = new Mesh(new PlaneGeometry(0.62, 0.29), screen.mat)
  const holder = new Group()
  holder.position.copy(con.position)
  holder.rotation.copy(con.rotation)
  sm.position.set(0, 0, 0.087)
  holder.add(sm)
  live.add(holder)
  return { fixed, live, belt: beltTex, ledMat, screen }
}

// The treadmill console: a little canvas display (READY when idle; speed, equaliser bars and
// the rep timer while someone runs). Repainted only while in use.
function makeScreen(t) {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const mat = neon('#ffffff', 1.5, { map: tex })
  const font = (px) => `700 ${px}px Fredoka, "Arial Black", sans-serif`
  const frame = () => {
    ctx.fillStyle = '#04060b'
    ctx.fillRect(0, 0, 128, 64)
    ctx.strokeStyle = t.color
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 2
    ctx.strokeRect(2, 2, 124, 60)
    ctx.globalAlpha = 1
  }
  return {
    mat,
    idle() {
      frame()
      ctx.fillStyle = t.color
      ctx.font = font(22)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('READY', 64, 28)
      ctx.font = font(11)
      ctx.fillStyle = '#9aa3ad'
      ctx.fillText(`${t.label} SPEED`, 64, 48)
      tex.needsUpdate = true
    },
    // kmh: shown speed; rep: 0..1 to the next rep; time: s for the bars.
    run(kmh, rep, time) {
      frame()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#ffffff'
      ctx.font = font(24)
      ctx.fillText(kmh.toFixed(1), 8, 34)
      ctx.font = font(10)
      ctx.fillStyle = t.color
      ctx.fillText('KM/H', 10, 46)
      for (let i = 0; i < 8; i++) {
        const h = 6 + 22 * (0.5 + 0.5 * Math.sin(time * (7 + i * 1.3) + i * 1.7)) * (0.55 + 0.45 * Math.sin(time * 2.1 + i))
        ctx.fillStyle = i % 2 ? t.color : '#ffffff'
        ctx.fillRect(66 + i * 7, 46 - h, 5, h)
      }
      ctx.fillStyle = '#1c2230'
      ctx.fillRect(8, 52, 112, 6)
      ctx.fillStyle = t.color
      ctx.fillRect(8, 52, 112 * rep, 6)
      tex.needsUpdate = true
    },
  }
}

// --- Locked pad: a glowing force field round the edge and a floating padlock -------------------
const fieldTime = { value: 0 }
export function setFieldTime(t) {
  fieldTime.value = t
}
export function buildLock(S, height, color) {
  const g = new Group()
  const sides = []
  for (let i = 0; i < 4; i++) {
    const p = new PlaneGeometry(S, height)
    p.translate(0, height / 2, S / 2)
    p.rotateY((i * Math.PI) / 2)
    sides.push(p)
  }
  const mat = new ShaderMaterial({
    uniforms: { uTime: fieldTime, uColor: { value: new Color(color) }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float h = vUv.y;
        vec2 p = vec2(vUv.x * 26.0, h * 6.0);
        float cells = smoothstep(0.92, 1.0, abs(sin((p.x + p.y) * 3.14159))) + smoothstep(0.92, 1.0, abs(sin((p.x - p.y) * 3.14159)));
        float band = exp(-pow((fract(h * 0.8 - uTime * 0.35) - 0.5) * 8.0, 2.0));
        float base = pow(1.0 - h, 2.0);
        float a = base * (0.16 + 0.4 * cells) + band * 0.3 * (1.0 - h) + smoothstep(0.05, 0.0, h) * 0.5;
        gl_FragColor = vec4(uColor * (1.4 + band * 1.5), a * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
  })
  const field = new Mesh(mergeGeometries(sides), mat)
  field.renderOrder = 2
  g.add(field)
  // Padlock: body + shackle in one glowing mesh, a dark keyhole.
  const lockMat = neon(color, 1.8, { transparent: true, opacity: 0.92 })
  const shackle = new TorusGeometry(0.25, 0.065, 8, 20, Math.PI).translate(0, 0.31, 0)
  const body = new RoundedBoxGeometry(0.82, 0.62, 0.26, 2, 0.08)
  const padlock = new Group()
  padlock.add(new Mesh(mergeGeometries([body.toNonIndexed(), shackle.toNonIndexed()]), lockMat))
  const hole = new Mesh(new CylinderGeometry(0.07, 0.07, 0.28, 12).rotateX(Math.PI / 2), new MeshBasicMaterial({ color: '#0b0c10' }))
  hole.position.y = 0.04
  padlock.add(hole)
  const slot = new Mesh(new BoxGeometry(0.05, 0.16, 0.28), hole.material)
  slot.position.y = -0.06
  padlock.add(slot)
  g.add(padlock)
  return { group: g, field, fieldMat: mat, padlock }
}

// --- Theme decor ------------------------------------------------------------------------------
// ctx: { fixed, live (both in pad space: +Z toward the walkway, y = 0 on the pad top), S, t
// (tier), emit(opts) (an ambient emitter, boxes in pad space), solid(lx, lz, hx, hz, h)
// (a collider standing on the pad), anims (per-frame (dt, time) callbacks), fx }.
// Machines take |x| 1.0..3.9, |z| < 1.7; the front (+Z) edge stays clear to walk in.
export const DECOR = {
  basic(ctx) {
    const { fixed, solid } = ctx
    // Dumbbell rack along the back.
    const rz = -4.3
    for (const s of [-1, 1]) {
      add(fixed, new BoxGeometry(0.1, 1.05, 0.5), 'metal', '#3a3e46', s * 1.45, 0.525, rz)
      B(fixed, 0.12, 0.06, 0.7, 'soft', '#141518', s * 1.45, 0, rz)
    }
    for (const [y, z] of [[0.48, rz + 0.08], [0.88, rz - 0.06]]) {
      add(fixed, new BoxGeometry(2.9, 0.05, 0.36), 'metal', '#8f99a6', 0, y, z, 0.18)
      for (let i = 0; i < 5; i++) {
        const x = -1.1 + i * 0.55
        const r = 0.065 + i * 0.012
        CX(fixed, 0.022, 0.34, 'chrome', '#d9dee5', x, y + 0.03 + r, z)
        for (const s of [-1, 1]) CX(fixed, r, 0.09, 'matte', '#25272d', x + s * 0.19, y + 0.03 + r, z, 6)
      }
    }
    solid(0, rz, 1.55, 0.35, 1.05)
    // Kettlebells in one back corner, a water cooler in the other.
    for (let i = 0; i < 3; i++) {
      const x = -4.4 + i * 0.45
      const r = 0.14 + i * 0.03
      add(fixed, new SphereGeometry(r, 14, 10), 'matte', ['#ff7a1a', '#3fb6ff', '#2b2e35'][i], x, r * 0.9, -4.6)
      add(fixed, new TorusGeometry(r * 0.6, 0.025, 6, 14, Math.PI), 'matte', '#2b2e35', x, r * 1.7, -4.6)
    }
    B(fixed, 0.42, 0.9, 0.42, 'matte', '#f2f4f7', 4.5, 0, -4.6)
    CY(fixed, 0.17, 0.48, 'matte', '#7fcfff', 4.5, 0.9, -4.6, 16, 0.12)
    B(fixed, 0.05, 0.05, 0.05, 'glow', '#3fb6ff', 4.5, 0.6, -4.38)
    solid(4.5, -4.6, 0.22, 0.22, 1.4)
  },

  hazard(ctx) {
    const { fixed, live, solid, anims } = ctx
    const stripes = kit('hazardTex', () => std('#ffffff', { map: toTexture(paintHazard(), { srgb: true }), roughness: 0.55 }))
    const beacons = new Group()
    const beaconMat = neon('#ffb01a', 2)
    for (const [x, z] of [[-4.8, -4.8], [4.8, -4.8], [-4.8, 4.8], [4.8, 4.8]]) {
      add(fixed, new CylinderGeometry(0.16, 0.18, 0.95, 16), stripes, null, x, 0.475, z)
      CY(fixed, 0.2, 0.05, 'matte', '#24252b', x, 0, z, 16)
      add(beacons, new SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), beaconMat, null, x, 0.95, z)
      solid(x, z, 0.2, 0.2, 1)
    }
    live.add(bake(beacons))
    anims.push((dt, time) => setNeonK(beaconMat, 0.8 + 3 * Math.max(0, Math.sin(time * 5))))
    // Steel beams and cones at the back.
    for (let i = 0; i < 3; i++) {
      const y = i * 0.32
      const z = -4.4 + (i % 2) * 0.1
      B(fixed, 3.2, 0.04, 0.3, 'metal', '#d9601a', 0, y, z)
      B(fixed, 3.2, 0.22, 0.04, 'metal', '#d9601a', 0, y + 0.04, z)
      B(fixed, 3.2, 0.04, 0.3, 'metal', '#d9601a', 0, y + 0.26, z)
    }
    solid(0, -4.4, 1.65, 0.2, 0.95)
    for (const x of [-2.4, 2.4]) {
      B(fixed, 0.5, 0.05, 0.5, 'matte', '#1b1c20', x, 0, -4.5)
      CY(fixed, 0.2, 0.7, 'matte', '#ff6a1a', x, 0.05, -4.5, 14, 0.03)
      CY(fixed, 0.15, 0.12, 'matte', '#ffffff', x, 0.3, -4.5, 14, 0.115)
    }
  },

  ice(ctx) {
    const { fixed, emit, solid } = ctx
    const ice = kit('ice', () => std('#bff1ff', { transparent: true, opacity: 0.82, roughness: 0.06, metalness: 0.1, emissive: '#35c8ff', emissiveIntensity: 0.35 }))
    const rand = ctx.rand
    const cluster = (cx, cz, n, tall) => {
      for (let i = 0; i < n; i++) {
        const h = tall * (0.45 + rand() * 0.55)
        const w = 0.16 + rand() * 0.16
        const geo = new OctahedronGeometry(1, 0).scale(w, h, w)
        const x = cx + (rand() - 0.5) * 0.7
        const z = cz + (rand() - 0.5) * 0.7
        add(fixed, geo, ice, null, x, h * 0.6, z, (rand() - 0.5) * 0.5, rand() * 3, (rand() - 0.5) * 0.5)
        if (i % 2 === 0) add(fixed, new OctahedronGeometry(1, 0).scale(w * 0.35, h * 0.5, w * 0.35), 'glow', '#7fe6ff', x, h * 0.6, z)
      }
      solid(cx, cz, 0.45, 0.45, tall)
    }
    for (const [x, z] of [[-4.6, -4.6], [4.6, -4.6], [-4.7, 4.7], [4.7, 4.7]]) cluster(x, z, 5, 1.3)
    cluster(0, -4.4, 7, 2.4)
    emit({ boxes: [[-4.6, -4.6], [4.6, -4.6], [0, -4.4]].map(([x, z]) => ({ x, y: 0.9, z, sx: 0.6, sy: 0.8, sz: 0.6 })), count: 40, life: 2.2, velocity: [0, 0.4, 0], spread: [0.2, 0.2, 0.2], size: 0.24, color: '#7fe6ff', intensity: 3, sprite: 'sparkle', twinkle: 8 })
  },

  neon(ctx) {
    const { fixed, live, solid, anims, t } = ctx
    const pink = '#ff4fd8'
    for (const [x, z] of [[-4.8, -4.8], [4.8, -4.8], [-4.8, 4.8], [4.8, 4.8]]) {
      B(fixed, 0.5, 0.12, 0.5, 'metal', '#1a1028', x, 0, z)
      CY(fixed, 0.07, 2.6, 'metal', t.frame, x, 0.12, z, 10)
      ;[1.2, 1.8, 2.4].forEach((y, i) => add(fixed, new TorusGeometry(0.22, 0.035, 8, 24), 'glow', i % 2 ? pink : t.color, x, y, z, Math.PI / 2))
      add(fixed, new SphereGeometry(0.1, 12, 8), 'glow', '#ffffff', x, 2.78, z)
      solid(x, z, 0.25, 0.25, 2.8)
    }
    // A big neon triangle on two posts at the back.
    for (const s of [-1, 1]) CY(fixed, 0.06, 2.4, 'metal', t.frame, s * 1.0, 0, -4.7, 10)
    B(fixed, 2.3, 0.08, 0.08, 'metal', t.frame, 0, 2.4, -4.7)
    solid(0, -4.7, 1.1, 0.12, 2.5)
    const triMat = neon(t.color, 2.6)
    const tri = new Group()
    add(tri, new TorusGeometry(1.0, 0.07, 8, 3), triMat, null, 0, 0, 0, 0, 0, Math.PI / 2)
    add(tri, new TorusGeometry(0.62, 0.05, 8, 3), neon(pink, 2.6), null, 0, -0.1, 0.02, 0, 0, Math.PI / 2)
    const triB = bake(tri)
    triB.position.set(0, 1.4, -4.62)
    live.add(triB)
    anims.push((dt, time) => {
      triB.rotation.z = Math.sin(time * 0.8) * 0.06
      setNeonK(triMat, 2 + Math.sin(time * 3) * 0.8)
    })
  },

  lava(ctx) {
    const { fixed, live, emit, solid, anims, S } = ctx
    const e = S / 2 - 0.35
    const spike = (x, z) => {
      CY(fixed, 0.15, 0.6, 'metal', '#16110f', x, 0, z, 8, 0.0)
      CY(fixed, 0.19, 0.04, 'glow', '#ff4a1a', x, 0, z, 8)
    }
    for (let x = -4.5; x <= 4.51; x += 1.125) spike(x, -e)
    for (const s of [-1, 1]) for (let z = -3.4; z <= 2.3; z += 1.14) spike(s * e, z)
    solid(0, -e, S / 2, 0.2, 0.6)
    for (const s of [-1, 1]) solid(s * e, -0.6, 0.2, 3.1, 0.6)
    // Fire braziers at the corners: stone pedestal, iron bowl, glowing coals, flames.
    const flames = new Group()
    const outer = neon('#ff5a1a', 2.2, { transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false })
    const inner = neon('#ffd84a', 2.8, { transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false })
    const spots = [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]]
    for (const [x, z] of spots) {
      CY(fixed, 0.3, 0.7, 'matte', '#3a3236', x, 0, z, 8, 0.22)
      CY(fixed, 0.25, 0.32, 'metal', '#1d1a1b', x, 0.7, z, 14, 0.48)
      CY(fixed, 0.42, 0.04, 'glow', '#ff6a1a', x, 0.98, z, 14)
      add(flames, new ConeGeometry(0.34, 0.95, 12, 1, true), outer, null, x, 1.47, z)
      add(flames, new ConeGeometry(0.18, 0.6, 10, 1, true), inner, null, x, 1.3, z)
      solid(x, z, 0.45, 0.45, 1.2)
    }
    const fl = bake(flames)
    live.add(fl)
    anims.push((dt, time) => {
      const f = 0.85 + 0.15 * Math.sin(time * 17) * Math.sin(time * 11.3)
      fl.scale.set(1, f, 1)
      fl.position.y = (1 - f) * 1.2
      setNeonK(outer, 1.8 + Math.sin(time * 13) * 0.4)
    })
    emit({ boxes: spots.flatMap(([x, z]) => [{ x, y: 1.2, z, sx: 0.22, sy: 0.05, sz: 0.22, color: '#ff6a1a' }, { x, y: 1.15, z, sx: 0.12, sy: 0.05, sz: 0.12, color: '#ffd84a' }]), count: 90, life: 0.8, velocity: [0, 1.9, 0], spread: [0.25, 0.4, 0.25], size: 0.42, grow: 0.15, intensity: 3.2, sprite: 'dot' })
    // An obelisk with glowing cracks at the back.
    B(fixed, 1.1, 0.3, 1.1, 'matte', '#2a2224', 0, 0, -4.3)
    add(fixed, new CylinderGeometry(0.28, 0.48, 2.6, 4), 'matte', '#1d1719', 0, 1.6, -4.3, 0, Math.PI / 4)
    for (const [dx, dz, ry] of [[0, 0.3, 0], [0.3, 0, Math.PI / 2], [-0.3, 0, Math.PI / 2]]) add(fixed, new BoxGeometry(0.04, 1.8, 0.02), 'glow', '#ff5a1a', dx, 1.55, -4.3 + dz, 0.12, ry)
    solid(0, -4.3, 0.55, 0.55, 2.9)
  },

  toxic(ctx) {
    const { fixed, live, emit, solid, anims } = ctx
    const barrel = (x, z, tilt = 0) => {
      add(fixed, new CylinderGeometry(0.3, 0.3, 0.9, 18), 'metal', '#2c6a3a', x, 0.45, z, 0, 0, tilt)
      for (const y of [0.25, 0.65]) add(fixed, new TorusGeometry(0.3, 0.02, 6, 20), 'metal', '#1d4a28', x, y, z, Math.PI / 2)
      add(fixed, new CylinderGeometry(0.305, 0.305, 0.12, 18), 'matte', '#ffd21a', x, 0.45, z)
      CY(fixed, 0.24, 0.02, 'glow', '#4dff8a', x, 0.9, z, 16)
    }
    for (const [x, z] of [[-4.6, -4.6], [-4.0, -4.7], [-4.55, -3.95], [4.6, -4.6], [4.0, -4.7], [4.65, 4.6], [-4.65, 4.6]]) barrel(x, z)
    for (const [x, z] of [[-4.4, -4.4], [4.4, -4.6]]) solid(x, z, 0.6, 0.6, 0.95)
    for (const s of [-1, 1]) solid(s * 4.65, 4.6, 0.32, 0.32, 0.95)
    // A glass vat of glowing goo with pipes, bubbles rising inside.
    const z0 = -4.35
    B(fixed, 1.8, 0.3, 1.8, 'metal', '#26332b', 0, 0, z0)
    const glass = kit('vatGlass', () => std('#9dffc0', { transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.2 }))
    add(fixed, new CylinderGeometry(0.75, 0.75, 2.2, 24, 1, true), glass, null, 0, 1.4, z0)
    CY(fixed, 0.8, 0.18, 'metal', '#3a4a40', 0, 2.5, z0, 24)
    for (const s of [-1, 1]) TUBE(fixed, [[s * 0.6, 2.6, z0], [s * 1.0, 2.5, z0 + 0.2], [s * 1.2, 1.4, z0 + 0.3], [s * 1.25, 0.1, z0 + 0.3]], 0.07, 'metal', '#5a6a60', 16)
    const gooMat = neon('#2bd96b', 1.4)
    const goo = new Mesh(new CylinderGeometry(0.68, 0.68, 1.7, 24), gooMat)
    goo.position.set(0, 1.18, z0)
    live.add(goo)
    anims.push((dt, time) => setNeonK(gooMat, 1.2 + 0.4 * Math.sin(time * 2.2)))
    solid(0, z0, 0.95, 0.95, 2.7)
    emit({ boxes: [{ x: 0, y: 0.5, z: z0, sx: 0.5, sy: 0.1, sz: 0.5 }], count: 30, life: 1.8, velocity: [0, 0.95, 0], spread: [0.05, 0.2, 0.05], size: 0.14, color: '#d6ffe3', intensity: 2.2, sprite: 'dot' })
  },

  solar(ctx) {
    const { fixed, live, emit, solid, anims, t } = ctx
    const rings = []
    const ringMat = neon('#ffb347', 2.6)
    const corners = [[-4.7, -4.7], [4.7, -4.7], [-4.7, 4.7], [4.7, 4.7]]
    for (const [x, z] of corners) {
      B(fixed, 0.7, 0.2, 0.7, 'metal', '#5a3416', x, 0, z)
      add(fixed, new CylinderGeometry(0.1, 0.28, 2.2, 4), 'metal', '#b06a2a', x, 1.3, z, 0, Math.PI / 4)
      add(fixed, new SphereGeometry(0.22, 16, 12), 'glow', '#ffd27a', x, 2.75, z)
      const r = new Mesh(new TorusGeometry(0.4, 0.025, 6, 32), ringMat)
      r.position.set(x, 2.75, z)
      live.add(r)
      rings.push(r)
      solid(x, z, 0.35, 0.35, 2.4)
    }
    emit({ boxes: corners.map(([x, z]) => ({ x, y: 2.75, z, sx: 0.15, sy: 0.15, sz: 0.15 })), count: 36, life: 1.4, velocity: [0, 0.6, 0], spread: [0.6, 0.6, 0.6], size: 0.2, color: '#ffd27a', intensity: 3.2, sprite: 'sparkle', twinkle: 9 })
    // A sun disk on a stand at the back, turning slowly.
    B(fixed, 1.2, 0.25, 0.7, 'metal', '#5a3416', 0, 0, -4.6)
    CY(fixed, 0.1, 1.4, 'metal', t.frame, 0, 0.25, -4.6, 10)
    solid(0, -4.6, 0.6, 0.4, 3.4)
    const sun = new Group()
    add(sun, new TorusGeometry(0.85, 0.08, 10, 40), 'glow', '#ffa040')
    add(sun, new SphereGeometry(0.5, 20, 14), 'glow', '#ffe28a')
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      add(sun, new ConeGeometry(0.1, 0.42, 6), 'glow', '#ff8a2a', Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0, 0, 0, a - Math.PI / 2)
    }
    const sunB = bake(sun)
    sunB.position.set(0, 2.45, -4.6)
    live.add(sunB)
    anims.push((dt, time) => {
      sunB.rotation.z = time * 0.35
      rings.forEach((r, i) => {
        r.rotation.set(time * (0.9 + i * 0.2), time * 1.3, 0)
        r.position.y = 2.75 + Math.sin(time * 2 + i) * 0.08
      })
    })
  },

  storm(ctx) {
    const { fixed, live, emit, solid, anims, fx, world } = ctx
    const tops = []
    for (const s of [-1, 1]) {
      const x = s * 4.3
      const z = -4.3
      B(fixed, 0.9, 0.4, 0.9, 'metal', '#1a2142', x, 0, z)
      CY(fixed, 0.2, 2.1, 'matte', '#1c2240', x, 0.4, z, 16)
      for (let i = 0; i < 11; i++) add(fixed, new TorusGeometry(0.235, 0.024, 6, 20), 'metal', '#d9823a', x, 0.7 + i * 0.12, z, Math.PI / 2)
      add(fixed, new TorusGeometry(0.42, 0.13, 10, 28), 'chrome', '#c9d2e0', x, 2.62, z, Math.PI / 2)
      add(fixed, new SphereGeometry(0.13, 12, 10), 'glow', '#bcd6ff', x, 2.62, z)
      tops.push(new Vector3(x, 2.62, z))
      solid(x, z, 0.5, 0.5, 2.8)
    }
    for (const s of [-1, 1]) {
      CY(fixed, 0.18, 0.8, 'matte', '#1c2240', s * 4.7, 0, 4.7, 14)
      CY(fixed, 0.2, 0.08, 'glow', '#5f9bff', s * 4.7, 0.8, 4.7, 14)
      solid(s * 4.7, 4.7, 0.22, 0.22, 0.9)
    }
    emit({ boxes: tops.map((p) => ({ x: p.x, y: p.y, z: p.z, sx: 0.4, sy: 0.3, sz: 0.4 })), count: 40, life: 0.5, velocity: [0, 0.5, 0], spread: [1.5, 1.5, 1.5], size: 0.18, color: '#cfe0ff', intensity: 4, sprite: 'sparkle', twinkle: 20 })
    // Lightning: jagged bolts of thin boxes between the coils and down to the pad, redrawn
    // several times a second.
    const SEG = 8
    const BOLTS = 3
    const boltMat = neon('#a8c8ff', 3.2)
    const bolts = new InstancedMesh(new BoxGeometry(1, 1, 1), boltMat, SEG * BOLTS)
    bolts.instanceMatrix.setUsage(DynamicDrawUsage)
    bolts.frustumCulled = false
    live.add(bolts)
    const m4 = new Matrix4()
    const q = new Quaternion()
    const sc = new Vector3()
    const a = new Vector3()
    const b = new Vector3()
    const d = new Vector3()
    const up = new Vector3(0, 1, 0)
    const hidden = new Matrix4().makeScale(0, 0, 0)
    const pts = Array.from({ length: SEG + 1 }, () => new Vector3())
    let next = 0
    const bolt = (k, from, to, jag) => {
      for (let i = 0; i <= SEG; i++) {
        pts[i].lerpVectors(from, to, i / SEG)
        if (i > 0 && i < SEG) pts[i].add(d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(jag))
      }
      for (let i = 0; i < SEG; i++) {
        a.copy(pts[i])
        b.copy(pts[i + 1])
        d.subVectors(b, a)
        const len = d.length()
        q.setFromUnitVectors(up, d.normalize())
        sc.set(0.045, len, 0.045)
        m4.compose(a.add(b).multiplyScalar(0.5), q, sc)
        bolts.setMatrixAt(k * SEG + i, m4)
      }
    }
    const hide = (k) => {
      for (let i = 0; i < SEG; i++) bolts.setMatrixAt(k * SEG + i, hidden)
    }
    const ground = new Vector3()
    anims.push((dt) => {
      next -= dt
      if (next > 0) return
      next = 0.05 + Math.random() * 0.1
      if (Math.random() < 0.75) bolt(0, tops[0], tops[1], 0.7)
      else hide(0)
      for (let k = 1; k < BOLTS; k++) {
        if (Math.random() < 0.5) {
          const top = tops[k - 1]
          ground.set(top.x * 0.55 + (Math.random() - 0.5) * 1.5, 0.05, top.z + 1.2 + Math.random() * 1.2)
          bolt(k, top, ground, 0.5)
          if (fx && Math.random() < 0.35) {
            const w = world(ground.x, ground.y, ground.z)
            fx.sparks(w.x, w.y, w.z, { count: 5, colors: ['#cfe0ff', '#5f9bff'], speed: 3, size: 0.2, life: 0.35, up: 1 })
          }
        } else hide(k)
      }
      bolts.instanceMatrix.needsUpdate = true
      setNeonK(boltMat, 2.6 + Math.random() * 1.6)
    })
  },

  elite(ctx) {
    const { fixed, live, solid, anims, S, t } = ctx
    const e = S / 2 - 0.25
    const posts = [[-e, -e], [e, -e], [-e, e], [e, e]]
    for (const [x, z] of posts) {
      CY(fixed, 0.11, 1.55, 'chrome', '#d9dce4', x, 0, z, 14)
      RB(fixed, 0.28, 0.5, 0.28, 0.06, 'soft', t.color, x, 0.95, z)
    }
    // Ropes on the back and both sides (the front, with the steps, stays open).
    const ropes = [[[-e, -e], [e, -e]], [[-e, -e], [-e, e]], [[e, -e], [e, e]]]
    for (const [[x1, z1], [x2, z2]] of ropes) {
      ;[0.45, 0.85, 1.25].forEach((y, i) => {
        const len = Math.hypot(x2 - x1, z2 - z1)
        const g = new CylinderGeometry(0.035, 0.035, len, 8).rotateX(Math.PI / 2)
        add(fixed, g, i === 1 ? 'glow' : 'soft', i === 1 ? t.color : '#ff8ad8', (x1 + x2) / 2, y, (z1 + z2) / 2, 0, Math.atan2(x2 - x1, z2 - z1))
      })
    }
    solid(0, -e, e, 0.1, 1.4)
    for (const s of [-1, 1]) solid(s * e, 0, 0.1, e, 1.4)
    // Spotlights on stands at the back corners, their beams sweeping the pad.
    const beamTex = kit('beamTex', () => {
      const tex = new CanvasTexture(paintFade('#ffffff', 128))
      tex.colorSpace = SRGBColorSpace
      return tex
    })
    const beamMat = new MeshBasicMaterial({ color: t.color, map: beamTex, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
    const beams = []
    for (const s of [-1, 1]) {
      const x = s * 4.6
      const z = -4.6
      CY(fixed, 0.06, 3.4, 'metal', '#2b2d33', x, 0, z, 10)
      B(fixed, 0.6, 0.06, 0.06, 'metal', '#2b2d33', x, 0, z)
      const lamp = new Group()
      lamp.position.set(x, 3.5, z)
      live.add(lamp)
      add(lamp, new CylinderGeometry(0.16, 0.22, 0.4, 14), std('#1d1e23', { metalness: 0.6, roughness: 0.3 }), null, 0, -0.1, 0)
      add(lamp, new CylinderGeometry(0.19, 0.19, 0.02, 14), neon('#ffffff', 3), null, 0, -0.31, 0)
      const geo = new ConeGeometry(1.2, 4.2, 24, 1, true).translate(0, -2.1, 0)
      // The fade texture runs bottom (opaque) to top; flip so the beam is bright at the lamp.
      const uv = geo.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
      const beam = new Mesh(geo, beamMat)
      beam.renderOrder = 2
      lamp.add(beam)
      beams.push({ lamp, s })
      solid(x, z, 0.12, 0.12, 3.4)
    }
    const dir = new Vector3()
    const down = new Vector3(0, -1, 0)
    anims.push((dt, time) => {
      for (const { lamp, s } of beams) {
        const a = time * 0.6 + (s > 0 ? Math.PI : 0)
        dir.set(Math.cos(a) * 2.2 - lamp.position.x, -lamp.position.y, Math.sin(a) * 1.6 - lamp.position.z).normalize()
        lamp.quaternion.setFromUnitVectors(down, dir)
      }
      beamMat.opacity = 0.26 + 0.08 * Math.sin(time * 3)
    })
  },

  legend(ctx) {
    const { fixed, live, emit, solid, anims, S } = ctx
    const gold = '#ffcf3a'
    const e = S / 2 - 0.2
    // Railings on the back and both sides.
    const rail = (x1, z1, x2, z2) => {
      const len = Math.hypot(x2 - x1, z2 - z1)
      const ry = Math.atan2(x2 - x1, z2 - z1)
      for (const [y, r] of [[1.0, 0.05], [0.55, 0.03]]) add(fixed, new CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2), 'metal', gold, (x1 + x2) / 2, y, (z1 + z2) / 2, 0, ry)
      const n = Math.round(len / 0.6)
      for (let i = 0; i <= n; i++) {
        const k = i / n
        const big = i % 4 === 0
        CY(fixed, big ? 0.05 : 0.022, 1.0, 'metal', gold, x1 + (x2 - x1) * k, 0, z1 + (z2 - z1) * k, 8)
        if (big) add(fixed, new SphereGeometry(0.07, 10, 8), 'metal', gold, x1 + (x2 - x1) * k, 1.05, z1 + (z2 - z1) * k)
      }
    }
    rail(-e, -e, e, -e)
    rail(-e, -e, -e, e)
    rail(e, -e, e, e)
    solid(0, -e, e, 0.08, 1.05)
    for (const s of [-1, 1]) solid(s * e, 0, 0.08, e, 1.05)
    // Fluted gold pillars with a glowing flame orb, a light beam rising from each.
    const pillars = [[-4.55, -4.55], [4.55, -4.55], [-4.55, 4.55], [4.55, 4.55]]
    const beams = new Group()
    const beamTex = kit('beamTex', () => {
      const tex = new CanvasTexture(paintFade('#ffffff', 128))
      tex.colorSpace = SRGBColorSpace
      return tex
    })
    const beamMat = new MeshBasicMaterial({ color: '#ffd24a', map: beamTex, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
    for (const [x, z] of pillars) {
      B(fixed, 0.8, 0.25, 0.8, 'matte', '#f4efe6', x, 0, z)
      B(fixed, 0.66, 0.08, 0.66, 'metal', gold, x, 0.25, z)
      CY(fixed, 0.24, 2.3, 'metal', gold, x, 0.33, z, 16)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        B(fixed, 0.04, 2.1, 0.04, 'metal', '#c8901a', x + Math.cos(a) * 0.24, 0.43, z + Math.sin(a) * 0.24)
      }
      B(fixed, 0.66, 0.16, 0.66, 'metal', gold, x, 2.63, z)
      CY(fixed, 0.16, 0.18, 'metal', '#c8901a', x, 2.79, z, 14, 0.3)
      add(fixed, new SphereGeometry(0.22, 16, 12), 'glow', '#fff2b8', x, 3.18, z)
      add(beams, new CylinderGeometry(0.3, 0.42, 26, 18, 1, true), beamMat, null, x, 3.2 + 13, z)
      solid(x, z, 0.4, 0.4, 3.2)
    }
    live.add(bake(beams))
    emit({ boxes: pillars.map(([x, z]) => ({ x, y: 3.2, z, sx: 0.2, sy: 0.1, sz: 0.2 })), count: 50, life: 1.5, velocity: [0, 1.4, 0], spread: [0.5, 0.4, 0.5], size: 0.24, color: '#fff2b8', intensity: 3.4, sprite: 'sparkle', twinkle: 8 })
    // A turning golden trophy on a marble pedestal at the back.
    B(fixed, 1.1, 0.9, 1.1, 'matte', '#f4efe6', 0, 0, -4.4)
    B(fixed, 1.16, 0.08, 1.16, 'metal', gold, 0, 0.9, -4.4)
    B(fixed, 1.16, 0.08, 1.16, 'metal', gold, 0, 0, -4.4)
    solid(0, -4.4, 0.58, 0.58, 2.6)
    const cup = new Group()
    const prof = [[0, 0], [0.32, 0], [0.32, 0.08], [0.12, 0.14], [0.08, 0.45], [0.16, 0.55], [0.42, 0.8], [0.46, 1.2], [0.4, 1.22], [0.36, 0.85], [0, 0.7]].map(([r, y]) => new Vector2(r, y))
    add(cup, new LatheGeometry(prof, 28), 'metal', gold)
    for (const s of [-1, 1]) add(cup, new TorusGeometry(0.22, 0.04, 8, 18, Math.PI), 'metal', gold, s * 0.46, 0.95, 0, 0, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2)
    add(cup, new OctahedronGeometry(0.16, 0), 'glow', '#fff2b8', 0, 1.45, 0)
    const cupB = bake(cup, true)
    cupB.position.set(0, 0.98, -4.4)
    live.add(cupB)
    anims.push((dt, time) => {
      cupB.rotation.y = time * 0.7
      beamMat.opacity = 0.36 + 0.12 * Math.sin(time * 2.4)
    })
  },
}
