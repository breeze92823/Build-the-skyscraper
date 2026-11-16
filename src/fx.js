import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  Euler,
} from 'three'
import { blockMaterial } from './site.js'
import { paintSoftDot, paintSparkle } from './textures.js'

// One-shot 3D effects, all pooled (no allocation per effect):
//  - sparks(): additive glowing particles with gravity (bursts, fireworks, gym reps)
//  - dust(): soft brown/grey puffs that drift and grow (the tower sinking, landings)
//  - confetti(): tumbling coloured paper squares (floor / building complete)
//  - flyBlock(): a small stone block arcing from A to B (pit -> bag, bag -> roof)
//  - ring(): an expanding glowing ring (floor complete shockwave)
// `scale` (graphics preset particles) trims the counts on weak devices.

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uViewport;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
    gl_PointSize = aSize * projectionMatrix[1][1] * 0.5 * uViewport / max(-mv.z, 0.1);
  }`
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`

function pointPool(scene, n, sprite, blending) {
  const pos = new Float32Array(n * 3)
  const size = new Float32Array(n)
  const alpha = new Float32Array(n)
  const color = new Float32Array(n * 3)
  const geo = new BufferGeometry()
  const attr = (a, k) => {
    const b = new BufferAttribute(a, k)
    b.setUsage(DynamicDrawUsage)
    return b
  }
  geo.setAttribute('position', attr(pos, 3))
  geo.setAttribute('aSize', attr(size, 1))
  geo.setAttribute('aAlpha', attr(alpha, 1))
  geo.setAttribute('aColor', attr(color, 3))
  const tex = new CanvasTexture(sprite)
  tex.colorSpace = SRGBColorSpace
  const mat = new ShaderMaterial({
    uniforms: { map: { value: tex }, uViewport: { value: 800 } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending,
  })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = 3
  scene.add(points)
  const P = []
  for (let i = 0; i < n; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s0: 1, s1: 1, r: 1, gr: 1, b: 1 })
  let next = 0
  return {
    mat,
    spawn(o) {
      const p = P[next]
      next = (next + 1) % n
      Object.assign(p, o)
      p.life = p.max
      return p
    },
    update(dt) {
      for (let i = 0; i < n; i++) {
        const p = P[i]
        if (p.life <= 0) {
          alpha[i] = 0
          continue
        }
        p.life -= dt
        const k = 1 - Math.max(0, p.life) / p.max
        const d = Math.max(0, 1 - p.drag * dt)
        p.vx *= d
        p.vy = p.vy * d - p.g * dt
        p.vz *= d
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
        pos[i * 3] = p.x
        pos[i * 3 + 1] = p.y
        pos[i * 3 + 2] = p.z
        size[i] = p.s0 + (p.s1 - p.s0) * k
        alpha[i] = (k < 0.1 ? k / 0.1 : 1) * (1 - Math.max(0, (k - 0.55) / 0.45)) * (p.a ?? 1)
        color[i * 3] = p.r
        color[i * 3 + 1] = p.gr
        color[i * 3 + 2] = p.b
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.aSize.needsUpdate = true
      geo.attributes.aAlpha.needsUpdate = true
      geo.attributes.aColor.needsUpdate = true
    },
  }
}

export function createFx(scene) {
  let scale = 1
  const sparkPool = pointPool(scene, 1400, paintSparkle(), AdditiveBlending)
  const dustPool = pointPool(scene, 260, paintSoftDot(), NormalBlending)
  const c = new Color()

  // Confetti: thin coloured quads (instanced).
  const CONF = 320
  const confetti = new InstancedMesh(new PlaneGeometry(0.35, 0.22), new MeshBasicMaterial({ side: DoubleSide, toneMapped: false }), CONF)
  confetti.instanceMatrix.setUsage(DynamicDrawUsage)
  confetti.frustumCulled = false
  const confColors = ['#ff4d6d', '#ffd23a', '#3bd9ff', '#7dff6b', '#b45cff', '#ff9a3b', '#ffffff']
  for (let i = 0; i < CONF; i++) confetti.setColorAt(i, c.set(confColors[i % confColors.length]))
  const CP = Array.from({ length: CONF }, () => ({ life: 0, p: new Vector3(), v: new Vector3(), r: new Euler(), w: new Vector3() }))
  let confNext = 0
  scene.add(confetti)

  // Flying blocks.
  const FLY = 80
  const flyMesh = new InstancedMesh(new BoxGeometry(0.42, 0.42, 0.42), blockMaterial(), FLY)
  flyMesh.instanceMatrix.setUsage(DynamicDrawUsage)
  flyMesh.frustumCulled = false
  flyMesh.castShadow = true
  const FP = Array.from({ length: FLY }, () => ({ t: 1, dur: 1, a: new Vector3(), b: new Vector3(), h: 2, spin: new Vector3(), target: null }))
  let flyNext = 0
  scene.add(flyMesh)

  // Rings.
  const rings = []
  for (let i = 0; i < 6; i++) {
    const m = new Mesh(new RingGeometry(0.92, 1, 64), new MeshBasicMaterial({ color: '#7dffa0', transparent: true, opacity: 0, side: DoubleSide, blending: AdditiveBlending, depthWrite: false }))
    m.rotation.x = -Math.PI / 2
    m.visible = false
    m.userData = { t: 1, dur: 1, r0: 1, r1: 10 }
    scene.add(m)
    rings.push(m)
  }
  let ringNext = 0

  const tmpM = new Matrix4()
  const tmpQ = new Quaternion()
  const tmpS = new Vector3()
  const tmpV = new Vector3()
  const tmpE = new Euler()
  const hidden = new Matrix4().makeScale(0, 0, 0)
  for (let i = 0; i < CONF; i++) confetti.setMatrixAt(i, hidden)
  for (let i = 0; i < FLY; i++) flyMesh.setMatrixAt(i, hidden)

  const rnd = (a, b) => a + Math.random() * (b - a)
  function rgb(hex, k = 1) {
    c.set(hex)
    return { r: c.r * k, gr: c.g * k, b: c.b * k }
  }

  const api = {
    setScale(s) {
      scale = s
    },
    // Glowing sparks out of a point. o: { count, speed, up, gravity, size, life, colors, spread, intensity }
    sparks(x, y, z, o = {}) {
      const n = Math.round((o.count ?? 30) * scale)
      const colors = o.colors ?? ['#ffffff', '#ffe27a']
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const el = (o.flat ? rnd(-0.1, 0.25) : rnd(-0.6, 1)) * (Math.PI / 2)
        const v = (o.speed ?? 8) * rnd(0.4, 1)
        sparkPool.spawn({
          x: x + rnd(-1, 1) * (o.spread ?? 0),
          y,
          z: z + rnd(-1, 1) * (o.spread ?? 0),
          vx: Math.cos(a) * Math.cos(el) * v,
          vy: Math.sin(el) * v + (o.up ?? 2),
          vz: Math.sin(a) * Math.cos(el) * v,
          g: o.gravity ?? 9,
          drag: o.drag ?? 1.2,
          max: (o.life ?? 1.1) * rnd(0.6, 1.2),
          s0: o.size ?? 0.45,
          s1: (o.size ?? 0.45) * 0.3,
          a: 1,
          ...rgb(colors[i % colors.length], o.intensity ?? 3),
        })
      }
    },
    // Directed sparks (speed trails, rising power): every particle leaves (x, y, z) at
    // (vx, vy, vz) plus jitter. o: { count, jitter, spread, spreadY, gravity, drag, size,
    // shrink, life, colors, intensity }
    streak(x, y, z, vx, vy, vz, o = {}) {
      const n = Math.max(1, Math.round((o.count ?? 1) * scale))
      const colors = o.colors ?? ['#ffffff']
      const j = o.jitter ?? 0.4
      const sp = o.spread ?? 0
      const spy = o.spreadY ?? sp
      const s = o.size ?? 0.25
      for (let i = 0; i < n; i++) {
        sparkPool.spawn({
          x: x + rnd(-sp, sp),
          y: y + rnd(-spy, spy),
          z: z + rnd(-sp, sp),
          vx: vx + rnd(-j, j),
          vy: vy + rnd(-j, j),
          vz: vz + rnd(-j, j),
          g: o.gravity ?? 0,
          drag: o.drag ?? 1.5,
          max: (o.life ?? 0.45) * rnd(0.7, 1.2),
          s0: s,
          s1: s * (o.shrink ?? 0.3),
          a: 1,
          ...rgb(colors[i % colors.length], o.intensity ?? 3),
        })
      }
    },
    // Soft puffs (dust, smoke). o: { count, size, grow, life, color, rise, spread }
    dust(x, y, z, o = {}) {
      const n = Math.round((o.count ?? 12) * scale)
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const r = rnd(0, o.spread ?? 2)
        const sz = (o.size ?? 2) * rnd(0.7, 1.3)
        dustPool.spawn({
          x: x + Math.cos(a) * r,
          y: y + rnd(0, o.height ?? 0.5),
          z: z + Math.sin(a) * r,
          vx: Math.cos(a) * rnd(0.5, 2) * (o.push ?? 1),
          vy: rnd(0.3, 1) * (o.rise ?? 1.5),
          vz: Math.sin(a) * rnd(0.5, 2) * (o.push ?? 1),
          g: 0,
          drag: 0.8,
          max: (o.life ?? 1.6) * rnd(0.7, 1.2),
          s0: sz,
          s1: sz * (o.grow ?? 2.4),
          a: o.alpha ?? 0.55,
          ...rgb(o.color ?? '#d9b48a', 1),
        })
      }
    },
    confetti(x, y, z, count = 120, spread = 6) {
      const n = Math.round(count * scale)
      for (let i = 0; i < n; i++) {
        const p = CP[confNext]
        confNext = (confNext + 1) % CONF
        p.life = rnd(2.2, 3.6)
        p.p.set(x + rnd(-spread, spread), y + rnd(0, 2), z + rnd(-spread, spread))
        p.v.set(rnd(-4, 4), rnd(6, 13), rnd(-4, 4))
        p.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6))
        p.w.set(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8))
      }
    },
    // A block arcing from a to b over `dur` seconds; b may be a function returning a Vector3
    // (a moving target such as the player's back).
    flyBlock(a, b, dur = 0.5, h = 2) {
      const p = FP[flyNext]
      flyNext = (flyNext + 1) % FLY
      p.t = 0
      p.dur = dur
      p.a.copy(a)
      if (typeof b === 'function') {
        p.target = b
        p.b.copy(b())
      } else {
        p.target = null
        p.b.copy(b)
      }
      p.h = h
      p.spin.set(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9))
    },
    ring(x, y, z, r0, r1, color = '#7dffa0', dur = 0.9) {
      const m = rings[ringNext]
      ringNext = (ringNext + 1) % rings.length
      m.position.set(x, y, z)
      m.material.color.set(color)
      m.userData = { t: 0, dur, r0, r1 }
      m.visible = true
    },
    // A firework shell bursting at (x, y, z).
    firework(x, y, z) {
      const palette = [['#ff4d6d', '#ffd1dc'], ['#ffd23a', '#fff4c2'], ['#3bd9ff', '#d1f6ff'], ['#7dff6b', '#e0ffd8'], ['#b45cff', '#ecd9ff']]
      const col = palette[Math.floor(Math.random() * palette.length)]
      api.sparks(x, y, z, { count: 70, speed: 16, up: 0, gravity: 4, size: 1.6, life: 1.8, colors: col, drag: 1.1, intensity: 4 })
    },
    update(dt, viewportHeight) {
      sparkPool.mat.uniforms.uViewport.value = viewportHeight
      dustPool.mat.uniforms.uViewport.value = viewportHeight
      sparkPool.update(dt)
      dustPool.update(dt)
      let anyConf = false
      for (let i = 0; i < CONF; i++) {
        const p = CP[i]
        if (p.life <= 0) continue
        anyConf = true
        p.life -= dt
        p.v.y -= 9 * dt
        p.v.multiplyScalar(1 - 1.6 * dt)
        p.v.y = Math.max(p.v.y, -3.5) // flutters down
        p.p.addScaledVector(p.v, dt)
        p.r.x += p.w.x * dt
        p.r.y += p.w.y * dt
        p.r.z += p.w.z * dt
        tmpQ.setFromEuler(p.r)
        const s = p.life <= 0 ? 0 : Math.min(1, p.life * 2)
        confetti.setMatrixAt(i, p.life <= 0 ? hidden : tmpM.compose(p.p, tmpQ, tmpS.set(s, s, s)))
      }
      if (anyConf) confetti.instanceMatrix.needsUpdate = true
      let anyFly = false
      for (let i = 0; i < FLY; i++) {
        const p = FP[i]
        if (p.t >= 1) continue
        anyFly = true
        p.t = Math.min(1, p.t + dt / p.dur)
        if (p.target) p.b.copy(p.target())
        const t = p.t
        tmpV.lerpVectors(p.a, p.b, t)
        tmpV.y += Math.sin(t * Math.PI) * p.h
        tmpQ.setFromEuler(tmpE.set(p.spin.x * t, p.spin.y * t, p.spin.z * t))
        const s = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 + 0.2 : 1
        flyMesh.setMatrixAt(i, p.t >= 1 ? hidden : tmpM.compose(tmpV, tmpQ, tmpS.set(s, s, s)))
      }
      if (anyFly) flyMesh.instanceMatrix.needsUpdate = true
      for (const m of rings) {
        const u = m.userData
        if (u.t >= 1) {
          m.visible = false
          continue
        }
        u.t = Math.min(1, u.t + dt / u.dur)
        const r = u.r0 + (u.r1 - u.r0) * (1 - (1 - u.t) * (1 - u.t))
        m.scale.set(r, r, r)
        m.material.opacity = (1 - u.t) * 0.9
      }
    },
  }
  return api
}

export { MeshStandardMaterial }
