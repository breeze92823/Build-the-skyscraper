import { Group, Matrix4, Mesh } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// --- Baking: one mesh per material ------------------------------------------------
// Props are built from many small meshes (a palm is ~20); merging the ones
// that share a look keeps a set piece to a handful of draw calls (mobile).
const matKey = (m) => [m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.vertexColors, m.side, m.flatShading, m.transparent, m.opacity, m.blending, m.map?.uuid, m.roughness, m.metalness, m.userData.k].join('|')
const rel = new Matrix4()
export function bake(root, castShadow = false) {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const groups = new Map() // key -> { mat, geos }
  const out = new Group()
  root.traverse((o) => {
    if (!o.isMesh) return
    rel.multiplyMatrices(inv, o.matrixWorld)
    if (Array.isArray(o.material)) {
      out.add(new Mesh(o.geometry.clone().applyMatrix4(rel), o.material)) // multi-material: kept as is
      return
    }
    const key = matKey(o.material)
    let e = groups.get(key)
    if (!e) groups.set(key, (e = { mat: o.material, geos: [] }))
    e.geos.push((o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(rel))
  })
  for (const { mat, geos } of groups.values()) {
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]))
    for (const g of geos) {
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n)
      g.morphAttributes = {}
      g.clearGroups()
    }
    const merged = mergeGeometries(geos)
    for (const g of geos) g.dispose()
    if (merged) out.add(new Mesh(merged, mat))
  }
  out.traverse((o) => {
    if (o.isMesh) o.castShadow = castShadow
  })
  return out
}

// --- Baking what turns out to be still ------------------------------------------------
// For animated set pieces (the Robot Gear displays): `probe(i)` runs the piece's own animation a few
// times; every mesh that never moves, changes or hides relative to its root in any of those runs is
// merged with the others that share its EXACT material object (so animated materials still animate).
// `live` parts are probed like the rest: the ones the animation actually moves, blinks or rescales stay
// separate. The picture is unchanged, the draw calls drop.
const sameMatrix = (a, b) => {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-5) return false
  return true
}
const geoVersion = (g) => {
  let v = (g.index?.version ?? 0) + g.drawRange.start * 7 + (Number.isFinite(g.drawRange.count) ? g.drawRange.count * 13 : 0)
  for (const n in g.attributes) v += g.attributes[n].version
  return v
}
function shownUnder(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false
  return root.visible
}
const attrSig = (g) =>
  Object.keys(g.attributes)
    .sort()
    .map((n) => `${n}:${g.attributes[n].itemSize}:${g.attributes[n].array.constructor.name}:${g.attributes[n].normalized}`)
    .join(',') + (g.index ? '|i' : '|n')

export function bakeStill(roots, probe, runs = 8) {
  const tmp = new Matrix4()
  const sets = roots.map((root) => {
    const meshes = []
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length) return
      const m = o.material
      // Transparent parts keep their own depth sorting; with one material, geometry groups draw as one call anyway.
      if (!m || Array.isArray(m) || m.transparent || o.geometry.morphAttributes.position) return
      if (Object.prototype.hasOwnProperty.call(o, 'onBeforeRender')) return
      meshes.push(o)
    })
    return { root, meshes, still: meshes.map(() => true), base: null }
  })
  const snap = (s) => {
    s.root.updateMatrixWorld(true)
    const inv = tmp.copy(s.root.matrixWorld).invert()
    return s.meshes.map((o) => ({ m: new Matrix4().multiplyMatrices(inv, o.matrixWorld), shown: shownUnder(o, s.root), v: geoVersion(o.geometry) }))
  }
  for (const s of sets) s.base = snap(s)
  for (let i = 0; i < runs; i++) {
    probe(i)
    for (const s of sets) {
      const now = snap(s)
      now.forEach((e, k) => {
        const b = s.base[k]
        if (!b.shown || !e.shown || e.v !== b.v || !sameMatrix(e.m, b.m)) s.still[k] = false
      })
    }
  }
  let removed = 0
  for (const s of sets) {
    const groups = new Map()
    s.meshes.forEach((o, k) => {
      if (!s.still[k]) return
      const rel = s.base[k].m
      if (rel.determinant() <= 0) return // mirrored parts would flip their faces: leave them
      const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask, o.frustumCulled, attrSig(o.geometry)].join('|')
      let g = groups.get(key)
      if (!g) groups.set(key, (g = []))
      g.push({ o, rel })
    })
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const geos = list.map(({ o, rel }) => {
        const g = o.geometry.clone().applyMatrix4(rel)
        g.clearGroups()
        return g
      })
      const merged = mergeGeometries(geos)
      for (const g of geos) g.dispose()
      if (!merged) continue
      const first = list[0].o
      const mesh = new Mesh(merged, first.material)
      mesh.castShadow = first.castShadow
      mesh.receiveShadow = first.receiveShadow
      mesh.renderOrder = first.renderOrder
      mesh.layers.mask = first.layers.mask
      mesh.frustumCulled = first.frustumCulled
      s.root.add(mesh)
      for (const { o } of list) o.parent?.remove(o)
      removed += list.length - 1
    }
  }
  return removed // draw calls saved
}
