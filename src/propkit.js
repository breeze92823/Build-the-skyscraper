import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three'
import { NEON } from './config.js'
import { RAPIER, addFixed } from './physics.js'
import { paintText } from './textures.js'

// Shared building blocks for hand-built props: material shorthands, a mesh
// placer, fixed-collider helpers, neon (glowing) materials and outlined text sprites.

export const std = (color, extra) => new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...extra })
export const glow = (color, opacity = 0.85) => new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })

export function put(parent, geo, mat, x = 0, y = 0, z = 0, shadows = true) {
  const m = new Mesh(geo, mat)
  m.position.set(x, y, z)
  if (shadows) {
    m.castShadow = true
    m.receiveShadow = true
  }
  parent.add(m)
  return m
}

// Box by size with its base at y (a lot of props are stacked boxes).
const boxCache = new Map()
export function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`
  let g = boxCache.get(k)
  if (!g) boxCache.set(k, (g = new BoxGeometry(w, h, d)))
  return g
}
export function box(parent, w, h, d, mat, x = 0, y = 0, z = 0, shadows = true) {
  return put(parent, boxGeo(w, h, d), mat, x, y + h / 2, z, shadows)
}
export function cyl(parent, r, h, mat, x = 0, y = 0, z = 0, seg = 12, shadows = true) {
  return put(parent, new CylinderGeometry(r, r, h, seg), mat, x, y + h / 2, z, shadows)
}

export const yawQuat = (yaw) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
export function solidBox(hx, hy, hz, x, y, z, yaw = 0) {
  return addFixed(RAPIER.ColliderDesc.cuboid(hx, hy, hz), { x, y, z }, yawQuat(yaw))
}
export function solidPole(radius, height, x, z, y = 0) {
  return addFixed(RAPIER.ColliderDesc.cylinder(height / 2, radius), { x, y: y + height / 2, z })
}

// A footprint box collider for a prop group placed at (x, z) with yaw: local box centre
// (cx, cz), half sizes (hx, hz) and height h.
export function solidFootprint(x, z, yaw, cx, cz, hx, hz, h) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return solidBox(hx, h / 2, hz, x + cx * c + cz * s, h / 2, z - cx * s + cz * c, yaw)
}

// --- Neon: unlit materials that glow ----------------------------------------------
// With bloom on, a neon material's colour is pushed to `k` times its base so
// it clears the bloom threshold (bloom measures luminance, so blues need a
// bigger k than greens to glow). With bloom off the same k would just tone-map
// to a washed-out white, so it is capped at NEON.plainMax. main.js flips this
// with the graphics preset via setNeonBloom.
const neonMats = new Set() // dropped again when a material is disposed
let neonBloom = false
function applyNeon(m) {
  const { base, k } = m.userData
  m.color.copy(base).multiplyScalar(neonBloom ? k : Math.min(k, NEON.plainMax))
}
// `extra` takes MeshBasicMaterial options (e.g. additive, transparent flames).
export function neon(color, k = NEON.k, extra = {}) {
  const m = new MeshBasicMaterial(extra)
  m.userData.base = new Color(color)
  m.userData.k = k
  applyNeon(m)
  neonMats.add(m)
  m.addEventListener('dispose', () => neonMats.delete(m))
  return m
}
export function setNeonColor(m, color) {
  m.userData.base.set(color)
  applyNeon(m)
}
export function setNeonBloom(on) {
  neonBloom = on
  for (const m of neonMats) applyNeon(m)
}

// --- Labels: outlined text sprites, repainted once Fredoka has loaded --------
export const fontReady = document.fonts?.load ? Promise.all([document.fonts.load('700 96px Fredoka'), document.fonts.load('600 96px Fredoka')]).catch(() => null) : Promise.resolve()
export function label(text, height, opts) {
  const t = paintText(text, opts)
  const tex = new CanvasTexture(t.canvas)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
  const fit = () => sprite.scale.set((height * t.canvas.width) / t.canvas.height, height, 1)
  fit()
  fontReady.then(() => {
    t.draw()
    tex.dispose() // the canvas may have changed size
    tex.needsUpdate = true
    fit()
  })
  return sprite
}

// A flat sign: outlined text painted on a plane (reads like a decal, does not face the camera).
export function flatText(text, height, opts) {
  const t = paintText(text, opts)
  const tex = new CanvasTexture(t.canvas)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 8
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
  const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
  const fit = () => mesh.scale.set((height * t.canvas.width) / t.canvas.height, height, 1)
  fit()
  fontReady.then(() => {
    t.draw()
    tex.dispose()
    tex.needsUpdate = true
    fit()
  })
  return mesh
}

export { Group }
