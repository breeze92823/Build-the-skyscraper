import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three'

// 2D footprint helpers for the towers. A footprint is an array of [x, z] points (metres,
// relative to the tower centre), counter-clockwise seen from above (+Y), finely
// subdivided so the roof parapet and window UVs follow curves smoothly.

const TAU = Math.PI * 2

function polar(fn, n = 72) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    const r = fn(a)
    // Counter-clockwise from above means x = cos, z = -sin.
    pts.push([Math.cos(a) * r, -Math.sin(a) * r])
  }
  return pts
}

function subdivide(pts, maxLen = 2.5) {
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % pts.length]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxLen))
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
  }
  return out
}

// Footprint for a BUILDINGS `shape` of characteristic half-size `s`.
export function footprint(shape, s) {
  return ensureCCW(rawFootprint(shape, s))
}
function rawFootprint(shape, s) {
  switch (shape) {
    case 'chamfer': {
      const c = s * 0.3
      return subdivide([[s, -s + c], [s, s - c], [s - c, s], [-s + c, s], [-s, s - c], [-s, -s + c], [-s + c, -s], [s - c, -s]])
    }
    case 'blob':
      return polar((a) => s * (0.84 + 0.2 * Math.cos(2 * a) + 0.05 * Math.cos(4 * a)))
    case 'hex': {
      // Vertices east and west, so the north and south walls are flat.
      const pts = []
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU
        pts.push([Math.cos(a) * s * 1.1, -Math.sin(a) * s * 1.1])
      }
      return subdivide(pts)
    }
    case 'round':
      return polar(() => s, 64)
    case 'cross': {
      const w = s * 0.5
      return subdivide([[w, -s], [w, -w], [s, -w], [s, w], [w, w], [w, s], [-w, s], [-w, w], [-s, w], [-s, -w], [-w, -w], [-w, -s]])
    }
    case 'star':
      return polar((a) => s * (0.86 + 0.14 * Math.cos(5 * (a - Math.PI / 2))), 90)
    default:
      return polar(() => s, 48)
  }
}

export function signedArea(pts) {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    a += x1 * -z2 - x2 * -z1 // in (x, -z) space, CCW from above is positive
  }
  return a / 2
}
function ensureCCW(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts
}

// Polygon grown (d > 0) or shrunk (d < 0) along the averaged vertex normals.
export function offset(pts, d) {
  pts = ensureCCW(pts)
  const n = pts.length
  const out = []
  for (let i = 0; i < n; i++) {
    const [px, pz] = pts[(i - 1 + n) % n]
    const [x, z] = pts[i]
    const [nx, nz] = pts[(i + 1) % n]
    // Outward normals of the two edges (CCW from above: outward is to the right of travel in x,-z space).
    const e1 = norm(x - px, z - pz)
    const e2 = norm(nx - x, nz - z)
    const n1 = [-e1[1], e1[0]]
    const n2 = [-e2[1], e2[0]]
    let mx = n1[0] + n2[0]
    let mz = n1[1] + n2[1]
    const ml = Math.hypot(mx, mz) || 1
    mx /= ml
    mz /= ml
    const cos = Math.max(0.35, mx * n1[0] + mz * n1[1]) // miter, capped
    out.push([x + (mx * d) / cos, z + (mz * d) / cos])
  }
  return out
}
function norm(x, z) {
  const l = Math.hypot(x, z) || 1
  return [x / l, z / l]
}

export function pointInPolygon(x, z, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i]
    const [xj, zj] = pts[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// Largest z (the southern wall) where the vertical line at x crosses the footprint, or null.
export function southEdgeAt(pts, x) {
  let best = null
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i]
    const [x2, z2] = pts[(i + 1) % pts.length]
    if ((x1 <= x && x <= x2) || (x2 <= x && x <= x1)) {
      const t = x2 === x1 ? 0 : (x - x1) / (x2 - x1)
      const z = z1 + (z2 - z1) * t
      if (best === null || z > best) best = z
    }
  }
  return best
}
// The southern wall's furthest-out z over [x0, x1].
export function southEdgeMax(pts, x0, x1) {
  let best = -Infinity
  for (let i = 0; i <= 12; i++) {
    const z = southEdgeAt(pts, x0 + ((x1 - x0) * i) / 12)
    if (z !== null && z > best) best = z
  }
  return best
}

// Triangles of a footprint, each wound counter-clockwise seen from above (normal +Y).
function triangulate(pts) {
  const contour = pts.map(([x, z]) => new Vector2(x, -z))
  return ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => {
    const A = contour[a]
    const B = contour[b]
    const C = contour[c]
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x)
    return cross >= 0 ? [a, b, c] : [a, c, b]
  })
}

// --- Geometry ------------------------------------------------------------------------------
// One storey: a slab band (group 0, footprint grown by `slabOut`) from 0 to `slab` with top
// and bottom caps, and the glass wall (group 1) from `slab` to `height`, its U running
// along the perimeter in metres and V 0..1 up the glass.
export function floorGeometry(pts, height, slab, slabOut = 0.35, glassIn = 0.12) {
  const pos = []
  const nrm = []
  const uv = []
  const idx = []
  const groups = []
  const slabPts = offset(pts, slabOut)
  const glassPts = offset(pts, -glassIn)
  let start = 0
  const sides = (poly, y0, y1, uScale) => {
    let u = 0
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i]
      const [bx, bz] = poly[(i + 1) % poly.length]
      const len = Math.hypot(bx - ax, bz - az)
      const [ex, ez] = norm(bx - ax, bz - az)
      // Outward normal (CCW from above): the edge direction turned to its right, (-ez, ex).
      const o = pos.length / 3
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az)
      for (let k = 0; k < 4; k++) nrm.push(-ez, 0, ex)
      uv.push(u * uScale, 0, (u + len) * uScale, 0, (u + len) * uScale, 1, u * uScale, 1)
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
      u += len
    }
    return u
  }
  const cap = (poly, y, up) => {
    const o = pos.length / 3
    for (const [x, z] of poly) {
      pos.push(x, y, z)
      nrm.push(0, up ? 1 : -1, 0)
      uv.push(x / 4, z / 4)
    }
    for (const [a, b, c] of triangulate(poly)) {
      if (up) idx.push(o + a, o + b, o + c)
      else idx.push(o + a, o + c, o + b)
    }
  }
  sides(slabPts, 0, slab, 1 / 4)
  cap(slabPts, slab, true)
  cap(slabPts, 0, false)
  groups.push([start, idx.length - start, 0])
  start = idx.length
  const perim = sides(glassPts, slab, height, 1)
  groups.push([start, idx.length - start, 1])
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  for (const [s, c, m] of groups) g.addGroup(s, c, m)
  g.userData.perimeter = perim
  return g
}

// A flat cap (roof) at y = 0, UVs in metres / tile.
export function capGeometry(pts, tile = 4) {
  const pos = []
  const uv = []
  const idx = []
  for (const [x, z] of pts) {
    pos.push(x, 0, z)
    uv.push(x / tile, z / tile)
  }
  for (const [a, b, c] of triangulate(pts)) idx.push(a, b, c)
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// A flat ribbon between the footprint and an inset copy (the glowing roof edge).
export function ringGeometry(pts, width) {
  const inner = offset(pts, -width)
  const pos = []
  const idx = []
  for (let i = 0; i < pts.length; i++) {
    pos.push(pts[i][0], 0, pts[i][1], inner[i][0], 0, inner[i][1])
  }
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = i * 2
    const b = ((i + 1) % n) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// Closed prism as a triangle soup for a Rapier trimesh: walls from y0 to y1 plus the top cap.
export function prismTrimesh(pts, y0, y1, cx = 0, cz = 0) {
  const v = []
  const ix = []
  const n = pts.length
  for (const [x, z] of pts) v.push(x + cx, y0, z + cz)
  for (const [x, z] of pts) v.push(x + cx, y1, z + cz)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    ix.push(i, j, n + j, i, n + j, n + i)
  }
  for (const [a, b, c] of triangulate(pts)) ix.push(n + a, n + b, n + c)
  return { vertices: new Float32Array(v), indices: new Uint32Array(ix) }
}
