// Procedural texture painters. Everything is drawn into canvases once at load,
// so the game ships no image files. Each painter returns tileable canvases:
// a colour map plus whatever data maps it needs (height -> bump or a derived
// tangent-space normal map, roughness). Same seed = same look every load.
import { CanvasTexture, DataTexture, NearestFilter, RedFormat, RepeatWrapping, SRGBColorSpace } from 'three'

// Deterministic PRNG.
export function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return c
}

// --- Tileable noise -------------------------------------------------------------
// Value noise on a periodic lattice: the last cell wraps to the first, so the
// result tiles seamlessly. fbm stacks octaves at doubling frequency.
function periodicNoise(size, cells, rand) {
  const lattice = new Float32Array(cells * cells)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  const out = new Float32Array(size * size)
  const s = (t) => t * t * (3 - 2 * t)
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells
    const y0 = Math.floor(fy)
    const ty = s(fy - y0)
    const y1 = (y0 + 1) % cells
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells
      const x0 = Math.floor(fx)
      const tx = s(fx - x0)
      const x1 = (x0 + 1) % cells
      const a = lattice[y0 * cells + x0]
      const b = lattice[y0 * cells + x1]
      const c = lattice[y1 * cells + x0]
      const d = lattice[y1 * cells + x1]
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
    }
  }
  return out
}

export function fbm(size, baseCells, octaves, seed) {
  const rand = mulberry32(seed)
  const out = new Float32Array(size * size)
  let amp = 0.5
  let total = 0
  for (let o = 0; o < octaves; o++) {
    const layer = periodicNoise(size, baseCells << o, rand)
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp
    total += amp
    amp *= 0.5
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

// --- Height -> normal ----------------------------------------------------------
// Sobel over a wrapped height field into an OpenGL-convention tangent-space
// normal map (what three.js expects). `strength` scales the slopes.
export function heightToNormal(heights, size, strength = 2) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const h = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x - 1, y) - h(x - 1, y + 1)) * strength
      const dy = (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1) - h(x - 1, y - 1) - 2 * h(x, y - 1) - h(x + 1, y - 1)) * strength
      // Canvas y runs down while texture v runs up, hence +dy for the green channel.
      let nx = -dx
      let ny = dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz)
      nx /= len
      ny /= len
      nz /= len
      const i = (y * size + x) * 4
      img.data[i] = (nx * 0.5 + 0.5) * 255
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Greyscale canvas from a 0..1 field (bump / roughness maps).
function fieldCanvas(field, size, map = (v) => v) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < field.length; i++) {
    const v = Math.max(0, Math.min(255, map(field[i]) * 255))
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Colour canvas: base hex modulated per pixel by a 0..1 field.
function tintCanvas(field, size, dark, light) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const a = hexRgb(dark)
  const b = hexRgb(light)
  for (let i = 0; i < field.length; i++) {
    const t = field[i]
    img.data[i * 4] = a[0] + (b[0] - a[0]) * t
    img.data[i * 4 + 1] = a[1] + (b[1] - a[1]) * t
    img.data[i * 4 + 2] = a[2] + (b[2] - a[2]) * t
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return c
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Wraps a canvas as a repeating texture. Colour maps are sRGB; data maps stay linear.
export function toTexture(c, { repeat = 1, srgb = false, anisotropy = 8 } = {}) {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = anisotropy
  if (srgb) t.colorSpace = SRGBColorSpace
  return t
}

// --- Painters ----------------------------------------------------------------

// Grass: mottled base, soft blotches, then blade strokes mirrored into a height
// canvas used as a bump map.
export function paintGrass(size = 512) {
  const rand = mulberry32(1337)
  const color = canvas(size)
  const height = canvas(size)
  const c = color.getContext('2d')
  const h = height.getContext('2d')
  c.fillStyle = '#4fb33c'
  c.fillRect(0, 0, size, size)
  h.fillStyle = '#808080'
  h.fillRect(0, 0, size, size)

  // Draws at (x, y) and again at the wrapped offsets so the tile repeats seamlessly.
  const wrapped = (x, y, r, draw) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) continue
        draw(x + ox, y + oy)
      }
    }
  }
  for (let i = 0; i < 90; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 30 + rand() * 70
    const dark = rand() < 0.5
    wrapped(x, y, r, (px, py) => {
      const g = c.createRadialGradient(px, py, 0, px, py, r)
      g.addColorStop(0, dark ? 'rgba(40,90,30,0.28)' : 'rgba(160,210,90,0.2)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.fillRect(px - r, py - r, r * 2, r * 2)
    })
  }
  const greens = ['#3a9a2e', '#4fb33c', '#74b552', '#3f7a2e', '#8cc760']
  for (let i = 0; i < 9000; i++) {
    const x = rand() * size
    const y = rand() * size
    const len = 4 + rand() * 9
    const lean = (rand() - 0.5) * 5
    const shade = greens[Math.floor(rand() * greens.length)]
    const lift = 100 + Math.floor(rand() * 140)
    wrapped(x, y, len + 6, (px, py) => {
      c.strokeStyle = shade
      c.lineWidth = 1.3
      c.beginPath()
      c.moveTo(px, py)
      c.lineTo(px + lean, py - len)
      c.stroke()
      h.strokeStyle = `rgb(${lift},${lift},${lift})`
      h.lineWidth = 1.3
      h.beginPath()
      h.moveTo(px, py)
      h.lineTo(px + lean, py - len)
      h.stroke()
    })
  }
  return { color, height }
}

// Sand: fine fbm speckle, normal map from the same field.
export function paintSand(size = 256) {
  const field = fbm(size, 8, 5, 77)
  const rand = mulberry32(78)
  for (let i = 0; i < field.length; i++) field[i] = field[i] * 0.8 + rand() * 0.2
  return { color: tintCanvas(field, size, '#c9a96e', '#f0d9a4'), normal: heightToNormal(field, size, 1.4) }
}

// Rock cliff: large ridged fbm.
export function paintRock(size = 256) {
  const field = fbm(size, 4, 5, 91)
  for (let i = 0; i < field.length; i++) field[i] = 1 - Math.abs(field[i] * 2 - 1)
  return { color: tintCanvas(field, size, '#4c4640', '#958b7e'), normal: heightToNormal(field, size, 3) }
}

// Stone plaza: a 4x4 grid of bevelled tiles with grout. Height drives a normal
// map, and the grout is rougher than the worn tile faces (roughness map).
export function paintTiles(size = 512, perSide = 4) {
  const rand = mulberry32(4242)
  const grain = fbm(size, 8, 4, 4243)
  const tile = size / perSide
  const grout = 5
  const bevel = 10
  const tints = []
  for (let i = 0; i < perSide * perSide; i++) tints.push(0.82 + rand() * 0.18)
  const heights = new Float32Array(size * size)
  const rough = new Float32Array(size * size)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const lx = x % tile
      const ly = y % tile
      const edge = Math.min(lx, ly, tile - 1 - lx, tile - 1 - ly)
      const g = grain[i]
      let hgt
      let r
      let shade
      if (edge < grout / 2) {
        hgt = 0.1
        r = 1
        shade = 0.45 + g * 0.15
      } else {
        const t = Math.min(1, (edge - grout / 2) / bevel)
        hgt = 0.35 + 0.65 * Math.sqrt(t) + (g - 0.5) * 0.12
        r = 0.62 + g * 0.25
        shade = tints[Math.floor(y / tile) * perSide + Math.floor(x / tile)] * (0.82 + g * 0.3)
      }
      heights[i] = hgt
      rough[i] = r
      img.data[i * 4] = 200 * shade
      img.data[i * 4 + 1] = 192 * shade
      img.data[i * 4 + 2] = 180 * shade
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color, normal: heightToNormal(heights, size, 2.5), roughness: fieldCanvas(rough, size) }
}

// Wood planks running along U: per-plank tint, wavy grain, dark seams.
export function paintPlanks(size = 512, planks = 6, seed = 9) {
  const rand = mulberry32(seed)
  const warp = fbm(size, 4, 3, seed + 1)
  const plankH = size / planks
  const offsets = Array.from({ length: planks }, () => rand() * 40)
  const tints = Array.from({ length: planks }, () => 0.8 + rand() * 0.25)
  const heights = new Float32Array(size * size)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / plankH)
    const ly = y - row * plankH
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const seam = ly < 2 || ly > plankH - 2
      const grain = 0.5 + 0.5 * Math.sin((y + warp[i] * 30) * 0.9 + offsets[row] + Math.sin(x * 0.02 + row) * 2)
      const shade = seam ? 0.35 : tints[row] * (0.78 + grain * 0.22)
      heights[i] = seam ? 0 : 0.7 + grain * 0.08
      img.data[i * 4] = 168 * shade
      img.data[i * 4 + 1] = 112 * shade
      img.data[i * 4 + 2] = 66 * shade
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color, normal: heightToNormal(heights, size, 1.5) }
}

// Crate face: planks inside a frame with a diagonal brace (one face, not tiled).
export function paintCrate(size = 256) {
  const { color: planks } = paintPlanks(size, 4, 21)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.drawImage(planks, 0, 0)
  const frame = size * 0.12
  ctx.fillStyle = '#7a4e26'
  ctx.fillRect(0, 0, size, frame)
  ctx.fillRect(0, size - frame, size, frame)
  ctx.fillRect(0, 0, frame, size)
  ctx.fillRect(size - frame, 0, frame, size)
  ctx.save()
  ctx.translate(size / 2, size / 2)
  ctx.rotate(-Math.PI / 4)
  ctx.fillRect(-size * 0.7, -frame / 2, size * 1.4, frame)
  ctx.restore()
  ctx.strokeStyle = 'rgba(40,20,5,0.6)'
  ctx.lineWidth = 3
  ctx.strokeRect(frame, frame, size - frame * 2, size - frame * 2)
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3)
  // Nail heads in the frame corners.
  ctx.fillStyle = '#3a3a3a'
  for (const x of [frame / 2, size - frame / 2]) {
    for (const y of [frame / 2, size - frame / 2]) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  return { color: c }
}

// Water ripple normal map: a sum of sines on integer frequencies (so it tiles).
export function paintWaterNormal(size = 256) {
  const rand = mulberry32(31)
  const waves = Array.from({ length: 10 }, () => ({
    fx: Math.floor(rand() * 6) + 1,
    fy: Math.floor(rand() * 6) - 3,
    phase: rand() * Math.PI * 2,
    amp: 0.3 + rand() * 0.7,
  }))
  const heights = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let h = 0
      for (const w of waves) h += Math.sin(((x * w.fx + y * w.fy) / size) * Math.PI * 2 + w.phase) * w.amp
      heights[y * size + x] = h * 0.1
    }
  }
  return heightToNormal(heights, size, 2)
}

// 3-step gradient for MeshToonMaterial (hard cel bands).
export function toonGradient() {
  const t = new DataTexture(new Uint8Array([70, 160, 255]), 3, 1, RedFormat)
  t.minFilter = t.magFilter = NearestFilter
  t.needsUpdate = true
  return t
}

// Brushed metal: horizontal streaks as a roughness map.
export function paintBrushed(size = 256) {
  const rand = mulberry32(55)
  const field = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    let v = rand()
    for (let x = 0; x < size; x++) {
      v += (rand() - 0.5) * 0.08
      v = Math.max(0, Math.min(1, v))
      field[y * size + x] = 0.25 + v * 0.35
    }
  }
  return fieldCanvas(field, size)
}

// Cracked beach sand: pale cells (tileable Voronoi, wrapped distances) split by
// thin darker cracks, each cell a slightly different shade, plus fine speckle.
// Height is low in the cracks, so the derived normal map reads them as grooves.
export function paintCrackedSand(size = 512, cells = 9, seed = 404) {
  const rand = mulberry32(seed)
  const pts = []
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) pts.push({ x: (gx + 0.15 + rand() * 0.7) / cells, y: (gy + 0.15 + rand() * 0.7) / cells, shade: rand() })
  }
  const speckle = fbm(size, 16, 3, seed + 1)
  const height = new Float32Array(size * size)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const base = hexRgb('#eed39c')
  const alt = hexRgb('#e6c88b')
  const crack = hexRgb('#c9a263')
  const crackWidth = 0.0045
  for (let y = 0; y < size; y++) {
    const v = y / size
    const cy = Math.floor(v * cells)
    for (let x = 0; x < size; x++) {
      const u = x / size
      const cx = Math.floor(u * cells)
      let d1 = 9
      let d2 = 9
      let owner = null
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const gx = cx + ox
          const gy = cy + oy
          const p = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)]
          const px = p.x + Math.floor(gx / cells)
          const py = p.y + Math.floor(gy / cells)
          const d = Math.hypot(u - px, v - py)
          if (d < d1) {
            d2 = d1
            d1 = d
            owner = p
          } else if (d < d2) d2 = d
        }
      }
      const edge = Math.min(1, Math.max(0, (d2 - d1) / crackWidth)) // 0 in the crack, 1 inside a cell
      const s = speckle[y * size + x]
      const i = y * size + x
      height[i] = edge * 0.6 + s * 0.15
      const t = owner.shade * 0.6 + s * 0.4
      const k = 1 - edge
      for (let ch = 0; ch < 3; ch++) {
        const cell = base[ch] + (alt[ch] - base[ch]) * t
        img.data[i * 4 + ch] = cell + (crack[ch] - cell) * k
      }
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(height, size, 1.2) }
}

// Barrier wall face: white chevrons on red, pointing along +U (repeat along the wall).
export function paintChevrons(bg = '#e0262b', fg = '#ffffff', w = 256, h = 128) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = fg
  for (const x0 of [w * 0.12, w * 0.58]) {
    ctx.beginPath()
    ctx.moveTo(x0, h * 0.14)
    ctx.lineTo(x0 + w * 0.16, h * 0.14)
    ctx.lineTo(x0 + w * 0.34, h * 0.5)
    ctx.lineTo(x0 + w * 0.16, h * 0.86)
    ctx.lineTo(x0, h * 0.86)
    ctx.lineTo(x0 + w * 0.18, h * 0.5)
    ctx.closePath()
    ctx.fill()
  }
  return c
}

// Vertical 0..1 alpha ramp (glow curtains, light beams): opaque at the bottom.
export function paintFade(color = '#ffffff', h = 128) {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = h
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, h, 0, 0)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, h)
  return c
}

// Outlined game-sign text on a transparent canvas, sized to fit. `draw` can be
// called again once the web font has loaded (the canvas is repainted in place).
// '\n' splits lines; `colors` gives each line its own colour (else `color`).
export function paintText(text, { color = '#ffffff', colors = null, outline = '#0b1a3a', font = '700 96px Fredoka, "Arial Black", sans-serif', pad = 24, bg = null, outlineWidth = 14 } = {}) {
  const c = document.createElement('canvas')
  const lines = String(text).split('\n')
  const draw = () => {
    const ctx = c.getContext('2d')
    ctx.font = font
    const width = Math.max(...lines.map((l) => ctx.measureText(l).width))
    const px = parseInt(font.match(/(\d+)px/)[1], 10)
    const lineH = px * 1.2
    c.width = Math.ceil(width + pad * 2)
    c.height = Math.ceil(lineH * lines.length + px * 0.1 + pad * 2)
    ctx.font = font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (bg) {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, c.width, c.height)
    }
    ctx.lineJoin = 'round'
    lines.forEach((line, i) => {
      const y = pad + lineH * (i + 0.5) + px * 0.05
      if (outline) {
        ctx.lineWidth = outlineWidth
        ctx.strokeStyle = outline
        ctx.strokeText(line, c.width / 2, y)
      }
      ctx.fillStyle = colors?.[i] ?? color
      ctx.fillText(line, c.width / 2, y)
    })
  }
  draw()
  return { canvas: c, draw }
}

// Feather flag: red with one white diagonal band (UVs span the flag 0..1).
export function paintFlag(red = '#e3262e', white = '#ffffff', w = 64, h = 256) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = red
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = white
  ctx.beginPath()
  ctx.moveTo(0, h * 0.62)
  ctx.lineTo(w, h * 0.36)
  ctx.lineTo(w, h * 0.5)
  ctx.lineTo(0, h * 0.78)
  ctx.closePath()
  ctx.fill()
  return c
}

// Waterfall sheet: vertical white streaks of varying width over blue (scroll offset.y).
export function paintWaterfall(size = 256) {
  const rand = mulberry32(808)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, '#1690ff')
  g.addColorStop(0.5, '#4cc8ff')
  g.addColorStop(1, '#1690ff')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 70; i++) {
    const x = rand() * size
    const w = 1 + rand() * 5
    const y = rand() * size
    const len = size * (0.2 + rand() * 0.6)
    ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`
    ctx.fillRect(x, y, w, len)
    ctx.fillRect(x, y - size, w, len) // wrap vertically so it tiles
  }
  return c
}

// Particle sprites (white, tinted in the shader). Soft dot: a radial falloff.
export function paintSoftDot(size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

// Sparkle: a four-point star with a bright core.
export function paintSparkle(size = 64) {
  const c = paintSoftDot(size)
  const ctx = c.getContext('2d')
  const m = size / 2
  ctx.globalCompositeOperation = 'lighter'
  for (const [w, h] of [[size * 0.07, size * 0.5], [size * 0.5, size * 0.07]]) {
    const g = ctx.createRadialGradient(m, m, 0, m, m, Math.max(w, h))
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(m, m, w, h, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

// Treadmill water: bright blue with wavy white ripple lines across it, tiling
// vertically (scroll offset.y to run the belt).
export function paintLaneWater(base = '#0b63f0', size = 128) {
  const rand = mulberry32(512)
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size, 0)
  g.addColorStop(0, base)
  g.addColorStop(0.5, '#2fa4ff')
  g.addColorStop(1, base)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.lineWidth = 2
  for (let i = 0; i < 9; i++) {
    const y0 = (i / 9) * size
    const amp = 2 + rand() * 4
    const f = 1 + Math.floor(rand() * 3)
    const ph = rand() * Math.PI * 2
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + rand() * 0.4})`
    ctx.beginPath()
    for (let x = 0; x <= size; x += 4) {
      const y = y0 + Math.sin((x / size) * Math.PI * 2 * f + ph) * amp
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  return c
}

// Quilted shop floor: a pink base with a softly shaded diamond grid (one
// diamond per tile; repeat it per ~2 m).
export function paintQuilt(base = '#ff5fa8', size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.55)
  g.addColorStop(0, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(120,0,40,0.12)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = 'rgba(150,10,60,0.35)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(size / 2, 0)
  ctx.lineTo(size, size / 2)
  ctx.lineTo(size / 2, size)
  ctx.lineTo(0, size / 2)
  ctx.closePath()
  ctx.stroke()
  return c
}

// City pavement: `slabs` x `slabs` square paving slabs, each its own shade, with
// sunken joints and a fine speckle -> colour + derived normal map (City ground).
export function paintPavement({ base, alt, joint }, size = 512, slabs = 4, seed = 505) {
  const rand = mulberry32(seed)
  const shades = Array.from({ length: slabs * slabs }, () => rand())
  const speckle = fbm(size, 32, 3, seed + 1)
  const stain = fbm(size, 4, 3, seed + 2)
  const height = new Float32Array(size * size)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const a = hexRgb(base)
  const b = hexRgb(alt)
  const j = hexRgb(joint)
  const cell = size / slabs
  const half = 2.2 // px: half a joint's width
  for (let y = 0; y < size; y++) {
    const gy = Math.floor(y / cell)
    const dy = Math.min(y % cell, cell - (y % cell))
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / cell)
      const dx = Math.min(x % cell, cell - (x % cell))
      const edge = Math.min(1, Math.max(0, (Math.min(dx, dy) - half) / 1.5)) // 0 in a joint
      const i = y * size + x
      const s = speckle[i]
      height[i] = edge * 0.5 + s * 0.12
      const t = shades[gy * slabs + gx] * 0.7 + s * 0.3
      const dirt = 1 - Math.max(0, stain[i] - 0.55) * 0.35
      for (let ch = 0; ch < 3; ch++) {
        const v = (a[ch] + (b[ch] - a[ch]) * t) * dirt
        img.data[i * 4 + ch] = v + (j[ch] - v) * (1 - edge)
      }
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color: c, normal: heightToNormal(height, size, 1.4) }
}

// Building facade: `cols` window columns x `rows` storeys per tile on a white wall
// (the material's colour tints it), plus a black canvas with only the lit windows
// (the emissive map). The top-left pixel is plain wall: roofs and floors sample it.
export function paintFacade(glass = '#2b4f7e', size = 512, cols = 8, rows = 4, seed = 606) {
  const rand = mulberry32(seed)
  const color = canvas(size)
  const lit = canvas(size)
  const c = color.getContext('2d')
  const l = lit.getContext('2d')
  c.fillStyle = '#ffffff'
  c.fillRect(0, 0, size, size)
  l.fillStyle = '#000000'
  l.fillRect(0, 0, size, size)
  const cw = size / cols
  const ch = size / rows
  for (let r = 0; r < rows; r++) {
    // A darker band where each floor slab meets the wall.
    c.fillStyle = 'rgba(0, 0, 0, 0.08)'
    c.fillRect(0, (r + 1) * ch - ch * 0.08, size, ch * 0.08)
    for (let k = 0; k < cols; k++) {
      const x = k * cw + cw * 0.2
      const y = r * ch + ch * 0.16
      const w = cw * 0.6
      const h = ch * 0.62
      c.fillStyle = 'rgba(0, 0, 0, 0.35)' // frame
      c.fillRect(x - 2, y - 2, w + 4, h + 4)
      const g = c.createLinearGradient(0, y, 0, y + h)
      g.addColorStop(0, '#c9e4ff')
      g.addColorStop(0.35, glass)
      g.addColorStop(1, glass)
      c.fillStyle = g
      c.fillRect(x, y, w, h)
      if (rand() < 0.38) {
        const warm = 0.75 + rand() * 0.25
        l.fillStyle = `rgb(${255 * warm}, ${236 * warm}, ${190 * warm})`
        l.fillRect(x, y, w, h)
        c.fillStyle = 'rgba(255, 222, 150, 0.55)'
        c.fillRect(x, y, w, h)
      }
    }
  }
  return { color, lit }
}

// Two-tone checkerboard (2x2 squares per tile), e.g. the pink statue walkway.
export function paintChecker(a = '#ff5fa8', b = '#ff7fbc', size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  ctx.fillStyle = a
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = b
  ctx.fillRect(0, 0, size / 2, size / 2)
  ctx.fillRect(size / 2, size / 2, size / 2, size / 2)
  return c
}

// =====================================================================================
// Construction-site painters (Build the Skyscraper)
// =====================================================================================

function rgba(hex, a) {
  const [r, g, b] = hexRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

// Wind-blown desert sand: warm base, soft fbm blotches and long wavy ripples. Returns
// { color, normal } tileable canvases (the ripples come out of the normal map).
export function paintDuneSand(base = '#eba45c', dark = '#c9773a', light = '#ffd391', size = 512, seed = 77) {
  const blot = fbm(size, 4, 4, seed)
  const fine = fbm(size, 32, 2, seed + 1)
  const warp = fbm(size, 3, 2, seed + 2)
  const height = new Float32Array(size * size)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const img = ctx.createImageData(size, size)
  const a = hexRgb(dark)
  const m = hexRgb(base)
  const b = hexRgb(light)
  const waves = 9 // ripples per tile (integer so it tiles)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const w = warp[i] * 2 - 1
      // Asymmetric ripple: gentle windward slope, steep lee face.
      const ph = (y / size) * waves + w * 1.2 + Math.sin((x / size) * Math.PI * 2 * 2 + w * 3) * 0.18
      const f = ph - Math.floor(ph)
      const ripple = f < 0.78 ? f / 0.78 : 1 - (f - 0.78) / 0.22
      height[i] = ripple * 0.75 + fine[i] * 0.25
      let t = 0.5 + (blot[i] - 0.5) * 0.9 + (ripple - 0.5) * 0.18 + (fine[i] - 0.5) * 0.15
      t = Math.max(0, Math.min(1, t))
      const lo = t < 0.5 ? a : m
      const hi = t < 0.5 ? m : b
      const k = t < 0.5 ? t * 2 : (t - 0.5) * 2
      img.data[i * 4] = lo[0] + (hi[0] - lo[0]) * k
      img.data[i * 4 + 1] = lo[1] + (hi[1] - lo[1]) * k
      img.data[i * 4 + 2] = lo[2] + (hi[2] - lo[2]) * k
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return { color, normal: heightToNormal(height, size, 3.2) }
}

// Asphalt: dark speckled grey, along U; `lines`: 'dashed' centre line, 'edge' solid edges.
export function paintAsphalt({ dashed = true, edges = true, edgeColor = '#ffd23a' } = {}, size = 256) {
  const n = fbm(size, 16, 3, 909)
  const c = tintCanvas(n, size, '#34373d', '#4b4f57')
  const ctx = c.getContext('2d')
  const rand = mulberry32(910)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)'
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2)
  }
  // U runs along the road, V across it (0..1 = full width).
  if (dashed) {
    ctx.fillStyle = '#f4f4f4'
    ctx.fillRect(size * 0.08, size * 0.485, size * 0.42, size * 0.03)
  }
  if (edges) {
    ctx.fillStyle = edgeColor
    ctx.fillRect(0, size * 0.035, size, size * 0.022)
    ctx.fillRect(0, size * 0.943, size, size * 0.022)
  }
  return c
}

// Grey herringbone-ish pavers for walkways and the plaza: { color, normal }.
export function paintPavers(size = 512, base = '#8d9097', seed = 515) {
  const rand = mulberry32(seed)
  const color = canvas(size)
  const ctx = color.getContext('2d')
  const height = new Float32Array(size * size)
  ctx.fillStyle = '#5d6067'
  ctx.fillRect(0, 0, size, size)
  const u = size / 16
  const [br, bg, bb] = hexRgb(base)
  const brick = (x, y, w, h) => {
    const v = (rand() - 0.5) * 26
    ctx.fillStyle = `rgb(${br + v},${bg + v},${bb + v + 3})`
    const g = 1.5
    for (const ox of [0, -size, size]) for (const oy of [0, -size, size]) ctx.fillRect(x + ox + g, y + oy + g, w - g * 2, h - g * 2)
    for (let yy = Math.floor(y + g); yy < y + h - g; yy++) for (let xx = Math.floor(x + g); xx < x + w - g; xx++) height[((yy + size) % size) * size + ((xx + size) % size)] = 1
  }
  for (let by = 0; by < 16; by += 2) {
    for (let bx = 0; bx < 16; bx += 2) {
      const flip = ((bx + by) / 2) % 2 === 0
      if (flip) {
        brick(bx * u, by * u, u * 2, u)
        brick(bx * u, (by + 1) * u, u * 2, u)
      } else {
        brick(bx * u, by * u, u, u * 2)
        brick((bx + 1) * u, by * u, u, u * 2)
      }
    }
  }
  return { color, normal: heightToNormal(height, size, 1.2) }
}

// Poured concrete: soft mottling, a few hairline cracks and formwork tie holes.
export function paintConcrete(size = 256, light = '#c4c6c8', dark = '#9a9ea3', seed = 616) {
  const n = fbm(size, 8, 4, seed)
  const c = tintCanvas(n, size, dark, light)
  const ctx = c.getContext('2d')
  const rand = mulberry32(seed + 1)
  ctx.strokeStyle = 'rgba(60,60,60,0.18)'
  ctx.lineWidth = 1
  for (let i = 0; i < 5; i++) {
    let x = rand() * size
    let y = rand() * size
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 8; s++) {
      x += (rand() - 0.5) * 30
      y += (rand() - 0.5) * 30
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.08})`
    ctx.beginPath()
    ctx.arc(rand() * size, rand() * size, 0.6 + rand() * 1.6, 0, Math.PI * 2)
    ctx.fill()
  }
  return c
}

// A stone building block: concrete face with a bevelled darker rim (UV 0..1 per face).
export function paintBlock(size = 128) {
  const c = paintConcrete(size, '#bfc3c7', '#8d9298', 717)
  const ctx = c.getContext('2d')
  const r = size * 0.06
  ctx.strokeStyle = 'rgba(40,44,50,0.45)'
  ctx.lineWidth = r
  ctx.strokeRect(r / 2, r / 2, size - r, size - r)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 2
  ctx.strokeRect(r * 1.2, r * 1.2, size - r * 2.4, size - r * 2.4)
  return c
}

// Curtain-wall glass for one floor: `cols` panes across a tile, one storey tall.
// Returns { color, emissive }: the emissive map lights random panes for the night.
export function paintWindows(glass = '#3fd3e6', frame = '#e9f7ff', cols = 6, seed = 818, w = 512, h = 128) {
  const rand = mulberry32(seed)
  const color = document.createElement('canvas')
  color.width = w
  color.height = h
  const emissive = document.createElement('canvas')
  emissive.width = w
  emissive.height = h
  const c = color.getContext('2d')
  const e = emissive.getContext('2d')
  c.fillStyle = frame
  c.fillRect(0, 0, w, h)
  e.fillStyle = '#000'
  e.fillRect(0, 0, w, h)
  const pw = w / cols
  const mull = Math.max(3, pw * 0.07)
  const [gr, gg, gb] = hexRgb(glass)
  for (let i = 0; i < cols; i++) {
    const x = i * pw + mull / 2
    const y = h * 0.08
    const ww = pw - mull
    const hh = h * 0.84
    const g = c.createLinearGradient(x, y, x + ww * 0.6, y + hh)
    const k = 0.85 + rand() * 0.25
    g.addColorStop(0, `rgb(${Math.min(255, gr * 1.25 * k + 30)},${Math.min(255, gg * 1.2 * k + 30)},${Math.min(255, gb * 1.15 * k + 30)})`)
    g.addColorStop(0.55, `rgb(${gr * k},${gg * k},${gb * k})`)
    g.addColorStop(1, `rgb(${gr * 0.62},${gg * 0.62},${gb * 0.7})`)
    c.fillStyle = g
    c.fillRect(x, y, ww, hh)
    // A transom bar and a sky reflection streak.
    c.fillStyle = rgba(frame, 0.85)
    c.fillRect(x, y + hh * 0.7, ww, mull * 0.6)
    c.fillStyle = 'rgba(255,255,255,0.22)'
    c.beginPath()
    c.moveTo(x + ww * 0.15, y)
    c.lineTo(x + ww * 0.38, y)
    c.lineTo(x + ww * 0.12, y + hh)
    c.lineTo(x - ww * 0.1, y + hh)
    c.closePath()
    c.fill()
    // Night: about half the panes are lit, warm or cool.
    if (rand() < 0.55) {
      const warm = rand() < 0.7
      e.fillStyle = warm ? `rgb(255,${200 + rand() * 40},${120 + rand() * 50})` : 'rgb(170,220,255)'
      e.globalAlpha = 0.55 + rand() * 0.45
      e.fillRect(x, y, ww, hh)
      e.globalAlpha = 1
    }
  }
  return { color, emissive }
}

// Yellow steel lattice (crane masts, elevator shaft): an X-braced square on a transparent
// background, used with alphaTest. One tile = one bay.
export function paintLattice(color = '#ffcf1f', size = 128) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, size, size)
  const t = size * 0.08
  ctx.strokeStyle = color
  ctx.lineCap = 'butt'
  // The two chords down the edges.
  ctx.lineWidth = t * 2
  ctx.beginPath()
  ctx.moveTo(t, 0)
  ctx.lineTo(t, size)
  ctx.moveTo(size - t, 0)
  ctx.lineTo(size - t, size)
  ctx.stroke()
  // Horizontal struts at the tile seams (half each side, so they tile into one).
  ctx.lineWidth = t * 1.6
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(size, 0)
  ctx.moveTo(0, size)
  ctx.lineTo(size, size)
  ctx.stroke()
  // The X bracing.
  ctx.lineWidth = t
  ctx.beginPath()
  ctx.moveTo(t, t)
  ctx.lineTo(size - t, size - t)
  ctx.moveTo(size - t, t)
  ctx.lineTo(t, size - t)
  ctx.stroke()
  // A darker shadow edge makes the steel read as 3D.
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = 'rgba(120,70,0,0.25)'
  ctx.fillRect(size * 0.55, 0, size * 0.45, size)
  ctx.globalCompositeOperation = 'source-over'
  return c
}

// Horizontal rock strata for the mesas (UV v = height).
export function paintStrata(base = '#b8673a', size = 256, seed = 919) {
  const rand = mulberry32(seed)
  const n = fbm(size, 8, 4, seed)
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const [r0, g0, b0] = hexRgb(base)
  const bands = []
  for (let i = 0; i < 14; i++) bands.push(0.78 + rand() * 0.38)
  for (let y = 0; y < size; y++) {
    const band = bands[Math.floor((y / size) * bands.length)]
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const k = band * (0.85 + n[i] * 0.3)
      img.data[i * 4] = Math.min(255, r0 * k)
      img.data[i * 4 + 1] = Math.min(255, g0 * k)
      img.data[i * 4 + 2] = Math.min(255, b0 * k)
      img.data[i * 4 + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Diagonal black / yellow hazard stripes.
export function paintHazard(size = 128, a = '#ffcc1a', b = '#1d1d22') {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = a
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = b
  const w = size / 4
  for (let i = -2; i < 6; i++) {
    ctx.beginPath()
    ctx.moveTo(i * w * 2, 0)
    ctx.lineTo(i * w * 2 + w, 0)
    ctx.lineTo(i * w * 2 + w - size, size)
    ctx.lineTo(i * w * 2 - size, size)
    ctx.closePath()
    ctx.fill()
  }
  return c
}

// Corrugated metal sheet (roofs, containers): vertical ridges.
export function paintCorrugated(base = '#3b6fd6', size = 128) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, size / 8, 0)
  const [r, gg, b] = hexRgb(base)
  g.addColorStop(0, `rgb(${r * 0.7},${gg * 0.7},${b * 0.7})`)
  g.addColorStop(0.5, `rgb(${Math.min(255, r * 1.15)},${Math.min(255, gg * 1.15)},${Math.min(255, b * 1.15)})`)
  g.addColorStop(1, `rgb(${r * 0.7},${gg * 0.7},${b * 0.7})`)
  ctx.fillStyle = g
  for (let x = 0; x < size; x += size / 8) {
    ctx.save()
    ctx.translate(x, 0)
    ctx.fillRect(0, 0, size / 8, size)
    ctx.restore()
  }
  return c
}

// --- Gym (gym.js, gymKit.js) ------------------------------------------------------------
// A gym pad's floor by theme, covering the whole pad (not tiled): { map, glow }. `glow` is
// an emissive mask at half size (black = unlit, colour = the glowing lines) or null.
export function paintGymFloor(theme, { base, alt, line }, size = 512, seed = 31) {
  const rand = mulberry32(seed)
  const S = size
  const map = canvas(S)
  const ctx = map.getContext('2d')
  let glow = null
  let g = null
  if (theme !== 'basic' && theme !== 'hazard') {
    glow = canvas(S / 2)
    g = glow.getContext('2d')
    g.fillStyle = '#000'
    g.fillRect(0, 0, S / 2, S / 2)
    g.scale(0.5, 0.5)
  }
  // Path drawn on the glow mask as a soft bright line.
  const glowLine = (draw, width, color = line, blur = 10) => {
    if (!g) return
    g.save()
    g.strokeStyle = color
    g.lineWidth = width
    g.shadowColor = color
    g.shadowBlur = blur
    g.lineCap = g.lineJoin = 'round'
    draw(g)
    g.stroke()
    g.restore()
  }
  const strokeOn = (c, draw, width, color, alpha = 1) => {
    c.save()
    c.globalAlpha = alpha
    c.strokeStyle = color
    c.lineWidth = width
    c.lineCap = c.lineJoin = 'round'
    draw(c)
    c.stroke()
    c.restore()
  }
  const rect = (inset) => (c) => {
    c.beginPath()
    c.rect(inset, inset, S - inset * 2, S - inset * 2)
  }
  const circle = (r) => (c) => {
    c.beginPath()
    c.arc(S / 2, S / 2, r, 0, Math.PI * 2)
  }
  const tiles = (n, joint, vary = 0.06) => {
    const t = S / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = (i + j) % 2 ? alt : base
        ctx.fillRect(i * t, j * t, t, t)
        ctx.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${rand() * vary})` : `rgba(0,0,0,${rand() * vary * 1.5})`
        ctx.fillRect(i * t, j * t, t, t)
      }
    }
    ctx.fillStyle = joint
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * t - 2, 0, 4, S)
      ctx.fillRect(0, i * t - 2, S, 4)
    }
  }
  const speckle = (n, color, amax, r = 1.6) => {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rgba(color, rand() * amax)
      ctx.beginPath()
      ctx.arc(rand() * S, rand() * S, r * (0.5 + rand()), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const noisy = (dark, light, cells, octaves, curve = (v) => v) => {
    const f = fbm(S, cells, octaves, seed + 7)
    for (let i = 0; i < f.length; i++) f[i] = curve(f[i])
    ctx.drawImage(tintCanvas(f, S, dark, light), 0, 0)
  }
  // A wandering polyline: `steps` segments of `len` from (x, y), heading drifting by `wobble`.
  // Points are generated once so the colour map and the glow mask get the same line.
  const wander = (x, y, heading, steps, len, wobble) => {
    const pts = [[x, y]]
    for (let i = 0; i < steps; i++) {
      heading += (rand() * 2 - 1) * wobble
      x += Math.cos(heading) * len
      y += Math.sin(heading) * len
      pts.push([x, y])
    }
    return (c) => {
      c.beginPath()
      pts.forEach(([px, py], i) => c[i ? 'lineTo' : 'moveTo'](px, py))
    }
  }
  const star = (c, cx, cy, points, r0, r1, rot = -Math.PI / 2) => {
    c.beginPath()
    for (let i = 0; i <= points * 2; i++) {
      const r = i % 2 ? r1 : r0
      const a = rot + (i / (points * 2)) * Math.PI * 2
      c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r)
    }
    c.closePath()
  }

  switch (theme) {
    case 'basic': {
      tiles(4, '#1d1f23')
      speckle(2400, '#ffffff', 0.16, 0.6)
      strokeOn(ctx, rect(16), 10, line, 0.9)
      strokeOn(ctx, rect(34), 3, line, 0.5)
      break
    }
    case 'hazard': {
      tiles(4, '#17181c')
      speckle(700, '#ffffff', 0.12)
      // Hazard stripes round the edge.
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, S, S)
      ctx.rect(44, 44, S - 88, S - 88)
      ctx.clip('evenodd')
      ctx.fillStyle = line
      ctx.fillRect(0, 0, S, S)
      ctx.fillStyle = '#1b1c20'
      for (let i = -S; i < S * 2; i += 44) {
        ctx.beginPath()
        ctx.moveTo(i, 0)
        ctx.lineTo(i + 22, 0)
        ctx.lineTo(i + 22 - S, S)
        ctx.lineTo(i - S, S)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      strokeOn(ctx, rect(56), 4, line, 0.8)
      break
    }
    case 'ice': {
      noisy(base, alt, 4, 4)
      speckle(500, '#ffffff', 0.7, 1.2)
      for (let i = 0; i < 16; i++) {
        const crack = wander(rand() * S, rand() * S, rand() * Math.PI * 2, 6 + Math.floor(rand() * 6), 14 + rand() * 18, 0.7)
        strokeOn(ctx, crack, 2, '#ffffff', 0.85)
        glowLine(crack, 3, line, 8)
      }
      strokeOn(ctx, rect(14), 8, line, 0.85)
      glowLine(rect(14), 8)
      break
    }
    case 'neon': {
      const rg = ctx.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.75)
      rg.addColorStop(0, alt)
      rg.addColorStop(1, base)
      ctx.fillStyle = rg
      ctx.fillRect(0, 0, S, S)
      const grid = (step) => (c) => {
        c.beginPath()
        for (let p = step; p < S; p += step) {
          c.moveTo(p, 0)
          c.lineTo(p, S)
          c.moveTo(0, p)
          c.lineTo(S, p)
        }
      }
      strokeOn(ctx, grid(S / 16), 1.5, line, 0.35)
      strokeOn(ctx, grid(S / 4), 4, line, 0.8)
      glowLine(grid(S / 16), 1.5, line, 0)
      glowLine(grid(S / 4), 5, line, 12)
      strokeOn(ctx, rect(12), 8, line, 0.9)
      glowLine(rect(12), 9)
      break
    }
    case 'lava': {
      // Basalt hexes over molten rock: the gaps glow, a few cells smoulder.
      ctx.fillStyle = '#5a1206'
      ctx.fillRect(0, 0, S, S)
      if (g) {
        g.fillStyle = line
        g.fillRect(0, 0, S, S)
      }
      const r = S / 13
      const w = r * Math.sqrt(3)
      for (let row = -1; row * r * 1.5 < S + r; row++) {
        for (let col = -1; col * w < S + w; col++) {
          const cx = col * w + (row % 2 ? w / 2 : 0)
          const cy = row * r * 1.5
          const hex = (c, rr) => {
            c.beginPath()
            for (let k = 0; k < 6; k++) {
              const a = Math.PI / 6 + (k * Math.PI) / 3
              c[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
            }
            c.closePath()
          }
          hex(ctx, r - 4)
          ctx.fillStyle = rand() < 0.5 ? base : alt
          ctx.fill()
          ctx.fillStyle = `rgba(255,255,255,${rand() * 0.05})`
          ctx.fill()
          if (g) {
            hex(g, r - 4)
            g.fillStyle = rand() < 0.12 ? '#3a0c02' : '#000'
            g.fill()
          }
        }
      }
      speckle(400, '#ff8a3a', 0.25, 1.2)
      strokeOn(ctx, rect(10), 10, line, 0.9)
      glowLine(rect(10), 10)
      break
    }
    case 'toxic': {
      tiles(3, '#121714', 0.05)
      const t = S / 3
      ctx.fillStyle = 'rgba(255,255,255,0.22)'
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          for (const [dx, dy] of [[14, 14], [t - 14, 14], [14, t - 14], [t - 14, t - 14]]) {
            ctx.beginPath()
            ctx.arc(i * t + dx, j * t + dy, 4, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      // Glowing puddles.
      for (let i = 0; i < 7; i++) {
        const cx = 60 + rand() * (S - 120)
        const cy = 60 + rand() * (S - 120)
        const blobs = Array.from({ length: 4 }, () => [cx + (rand() - 0.5) * 30, cy + (rand() - 0.5) * 30, 10 + rand() * 22, 8 + rand() * 16, rand() * 3])
        const puddle = (c) => {
          c.beginPath()
          for (const [x, y, a, b, rot] of blobs) {
            c.moveTo(x + a, y)
            c.ellipse(x, y, a, b, rot, 0, Math.PI * 2)
          }
        }
        puddle(ctx)
        ctx.fillStyle = '#1fae52'
        ctx.fill()
        if (g) {
          g.save()
          g.shadowColor = line
          g.shadowBlur = 12
          g.fillStyle = line
          puddle(g)
          g.fill()
          g.restore()
        }
      }
      const dash = (c) => {
        c.setLineDash([26, 16])
        rect(16)(c)
      }
      strokeOn(ctx, dash, 7, line, 0.9)
      glowLine(dash, 7)
      break
    }
    case 'solar': {
      const rg = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.72)
      rg.addColorStop(0, alt)
      rg.addColorStop(1, base)
      ctx.fillStyle = rg
      ctx.fillRect(0, 0, S, S)
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * Math.PI * 2
        const a1 = ((i + 0.5) / 24) * Math.PI * 2
        ctx.fillStyle = 'rgba(255,190,90,0.10)'
        ctx.beginPath()
        ctx.moveTo(S / 2, S / 2)
        ctx.arc(S / 2, S / 2, S, a0, a1)
        ctx.closePath()
        ctx.fill()
      }
      const rays = (c) => {
        c.beginPath()
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2
          c.moveTo(S / 2 + Math.cos(a) * S * 0.16, S / 2 + Math.sin(a) * S * 0.16)
          c.lineTo(S / 2 + Math.cos(a) * S * 0.46, S / 2 + Math.sin(a) * S * 0.46)
        }
      }
      strokeOn(ctx, rays, 3, line, 0.6)
      glowLine(rays, 3, line, 8)
      for (const r of [S * 0.12, S * 0.15]) {
        strokeOn(ctx, circle(r), 4, line, 0.8)
        glowLine(circle(r), 4)
      }
      strokeOn(ctx, rect(12), 8, line, 0.9)
      glowLine(rect(12), 8)
      break
    }
    case 'storm': {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, S, S)
      // Diamond tread plate.
      ctx.fillStyle = alt
      const st = S / 24
      for (let y = 0; y < S + st; y += st) {
        for (let x = 0; x < S + st; x += st) {
          ctx.save()
          ctx.translate(x + ((y / st) % 2 ? st / 2 : 0), y)
          ctx.rotate(((Math.round((x + y) / st) % 2) ? 1 : -1) * 0.7)
          ctx.fillRect(-st * 0.3, -2, st * 0.6, 4)
          ctx.restore()
        }
      }
      // Lightning cracks out from the middle.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rand() * 0.6
        const bolt = wander(S / 2 + Math.cos(a) * 30, S / 2 + Math.sin(a) * 30, a, 9, 22, 0.9)
        strokeOn(ctx, bolt, 3, '#cfe0ff', 0.9)
        glowLine(bolt, 4, line, 12)
      }
      strokeOn(ctx, rect(12), 8, line, 0.9)
      glowLine(rect(12), 8)
      break
    }
    case 'elite': {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, S, S)
      ctx.fillStyle = alt
      ctx.fillRect(40, 40, S - 80, S - 80)
      speckle(600, '#ffffff', 0.12)
      const starPath = (c) => star(c, S / 2, S / 2, 5, S * 0.2, S * 0.085)
      starPath(ctx)
      ctx.fillStyle = base
      ctx.fill()
      strokeOn(ctx, starPath, 5, line, 0.95)
      glowLine(starPath, 5)
      strokeOn(ctx, circle(S * 0.27), 4, line, 0.8)
      glowLine(circle(S * 0.27), 4)
      strokeOn(ctx, rect(40), 6, line, 0.9)
      glowLine(rect(40), 6)
      strokeOn(ctx, rect(10), 6, line, 0.6)
      break
    }
    case 'legend': {
      // White marble with grey and gold veins, a gold border and a star emblem.
      noisy(alt, base, 3, 5, (v) => Math.min(1, v * 1.25))
      for (let i = 0; i < 18; i++) {
        const vein = wander(rand() * S, rand() * S, rand() * Math.PI * 2, 10, 18, 0.5)
        strokeOn(ctx, vein, 1.5 + rand() * 1.5, rand() < 0.3 ? '#c9a24a' : '#9c9488', 0.45)
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, S, S)
      ctx.rect(30, 30, S - 60, S - 60)
      ctx.clip('evenodd')
      const gg = ctx.createLinearGradient(0, 0, S, S)
      gg.addColorStop(0, '#ffe27a')
      gg.addColorStop(0.5, '#c8901a')
      gg.addColorStop(1, '#ffe27a')
      ctx.fillStyle = gg
      ctx.fillRect(0, 0, S, S)
      ctx.restore()
      strokeOn(ctx, rect(44), 4, '#d9a21f', 0.9)
      glowLine(rect(44), 4)
      const emblem = (c) => star(c, S / 2, S / 2, 8, S * 0.17, S * 0.09, 0)
      emblem(ctx)
      ctx.fillStyle = 'rgba(255,200,60,0.35)'
      ctx.fill()
      strokeOn(ctx, emblem, 5, '#d9a21f', 1)
      glowLine(emblem, 5)
      strokeOn(ctx, circle(S * 0.22), 4, '#d9a21f', 0.9)
      glowLine(circle(S * 0.22), 4)
      break
    }
  }
  return { map, glow }
}

// Treadmill belt: ribbed dark rubber with dashed accent lines near both edges (they make the
// belt's motion readable). Tiles vertically; scroll offset.y to run it.
export function paintBelt(accent = '#ffd23a', w = 64, h = 128) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#1e2024'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#2c2f35'
  for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 3)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 1)
  ctx.fillStyle = accent
  for (let y = 0; y < h; y += 32) {
    ctx.fillRect(4, y, 3, 14)
    ctx.fillRect(w - 7, y, 3, 14)
  }
  return c
}

// Soft glowing ring (white, tinted by the material): the floor aura under a machine in use.
export function paintGlowRing(size = 128) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')
  const m = size / 2
  const g = ctx.createRadialGradient(m, m, 0, m, m, m)
  g.addColorStop(0, 'rgba(255,255,255,0.18)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.3)')
  g.addColorStop(0.78, 'rgba(255,255,255,1)')
  g.addColorStop(0.86, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

// --- Lobby (lobby.js) ----------------------------------------------------------------
// Carpet: a soft mottled base with a fine diamond lattice in a lighter shade (one tile).
export function paintCarpet(base = '#123a36', size = 256, seed = 1201) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  const rand = mulberry32(seed)
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)'
    ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 3, 2 + rand() * 3)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.07)'
  ctx.lineWidth = 2
  const n = 4
  for (let i = -n; i <= n * 2; i++) {
    ctx.beginPath()
    ctx.moveTo((i * size) / n, 0)
    ctx.lineTo((i * size) / n + size, size)
    ctx.moveTo((i * size) / n, 0)
    ctx.lineTo((i * size) / n - size, size)
    ctx.stroke()
  }
  return c
}

// Window mullions seen from inside: a post on the left edge, a sill and a transom, the rest
// transparent (alpha-tested). One tile is one window bay.
export function paintMullions(frame = '#e8e2d6', w = 128, h = 512) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = frame
  ctx.fillRect(0, 0, 10, h) // post
  ctx.fillRect(0, h - 26, w, 26) // sill
  ctx.fillRect(0, h * 0.34, w, 9) // transom
  ctx.fillRect(0, 0, w, 10) // head
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.fillRect(10, 0, 3, h)
  return c
}

// Coffered ceiling: warm glowing panels between pale beams (MeshBasic, so it reads lit).
export function paintCoffers(beam = '#efe6d2', light = '#fff1c4', size = 128) {
  const c = canvas(size)
  const ctx = c.getContext('2d')
  ctx.fillStyle = beam
  ctx.fillRect(0, 0, size, size)
  const m = size * 0.12
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.5)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.6, light)
  g.addColorStop(1, '#d9c79c')
  ctx.fillStyle = g
  ctx.fillRect(m, m, size - m * 2, size - m * 2)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'
  ctx.lineWidth = 3
  ctx.strokeRect(m, m, size - m * 2, size - m * 2)
  return c
}
