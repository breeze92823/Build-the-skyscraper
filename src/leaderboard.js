import { CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace } from 'three'
import { LAYOUT } from './config.js'
import { bake } from './bake.js'
import { box, label, solidBox, std } from './propkit.js'
import { buildDefaultCharacter } from './avatar/character.js'
import { short } from './stats.js'

// The leaderboard wall south of the plaza: six boards (Most Strength, Speed, Blocks, Cash,
// Buildings, Playtime) redrawn every few seconds, and a podium in front with gold / silver / bronze
// statues of the top three builders. Each board lists the server's top saved players (net.js hands
// them to setRemote) and you (your live numbers), sorted; without a server it is just you.

const BOARDS = [
  { key: 'strength', title: 'Most Strength', color: '#ff9a3b' },
  { key: 'speed', title: 'Most Speed', color: '#3bc8ff' },
  { key: 'blocks', title: 'Most Blocks', color: '#7dff6b' },
  { key: 'cash', title: 'Most Cash', color: '#ffd23a' },
  { key: 'buildings', title: 'Most Buildings', color: '#ff6bd9' },
  { key: 'playtime', title: 'Most Playtime', color: '#b48cff' },
]

function fmt(key, v) {
  if (key === 'playtime') {
    const m = Math.floor(v / 60)
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
  }
  if (key === 'cash') return `$${short(v)}`
  return short(v)
}

export function createLeaderboard(scene) {
  const L = LAYOUT.leaderboard
  const root = new Group()
  root.name = 'leaderboard'
  const statics = new Group()
  const W = 6.6
  const H = 9.2
  const gap = 0.5
  const total = BOARDS.length * W + (BOARDS.length - 1) * gap
  // Frame: dark back wall, yellow/black hazard trim, posts.
  const frame = std('#1d1f25', { roughness: 0.7 })
  const boardG = new Group()
  box(boardG, total + 1.6, H + 1.6, 0.6, frame, 0, 0.8, 0)
  box(boardG, total + 2, 0.4, 0.9, std('#ffc21a'), 0, H + 2.3, 0)
  box(boardG, total + 2, 0.8, 1.2, std('#2b2d33'), 0, 0, 0)
  for (const x of [-total / 2 - 0.6, total / 2 + 0.6]) box(boardG, 0.6, H + 2.6, 0.9, std('#ffc21a'), x, 0, 0)
  boardG.position.set(L.x, 0, L.z)
  boardG.rotation.y = Math.PI // faces north, toward the plaza
  statics.add(boardG)
  solidBox(total / 2 + 1, (H + 2.6) / 2, 0.5, L.x, (H + 2.6) / 2, L.z)

  const panels = BOARDS.map((b, i) => {
    const c = document.createElement('canvas')
    c.width = 384
    c.height = 560
    const tex = new CanvasTexture(c)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 8
    const m = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ map: tex, toneMapped: false }))
    // Board i from the left as seen from the plaza (looking south, +X is on the left).
    const x = L.x + total / 2 - W / 2 - i * (W + gap)
    m.position.set(x, 1.4 + H / 2, L.z - 0.32)
    m.rotation.y = Math.PI
    root.add(m)
    return { ...b, canvas: c, tex }
  })
  const title = label('LEADERBOARDS', 1.8, { color: '#ffd23a', outline: '#2a1600', outlineWidth: 18 })
  title.position.set(L.x, H + 4.4, L.z - 0.4)
  root.add(title)

  // Podium + statues.
  const podium = new Group()
  const P = [
    { place: 1, h: 2.2, x: 0, color: '#ffd23a', metal: '#ffcc33' },
    { place: 2, h: 1.6, x: 3, color: '#dfe6ee', metal: '#cfd6df' },
    { place: 3, h: 1.1, x: -3, color: '#e09a5a', metal: '#cd7f32' },
  ]
  const pz = L.z - 9
  const statues = P.map((p) => {
    box(statics, 2.8, p.h, 2.8, std(p.color, { roughness: 0.45 }), L.x + p.x, 0, pz)
    solidBox(1.4, p.h / 2, 1.4, L.x + p.x, p.h / 2, pz)
    const num = label(String(p.place), 1.1, { color: '#ffffff', outline: '#1d1d1d', outlineWidth: 14 })
    num.position.set(L.x + p.x, p.h * 0.5, pz - 1.45)
    root.add(num)
    const body = buildDefaultCharacter()
    const metal = new MeshStandardMaterial({ color: p.metal, metalness: 0.85, roughness: 0.25 })
    body.traverse((o) => {
      if (o.isMesh) o.material = metal
    })
    body.scale.multiplyScalar(1.15)
    body.position.set(L.x + p.x, p.h, pz)
    body.rotation.y = Math.PI // face the plaza
    // A victory pose: one arm up.
    const n = body.nodes
    if (n.ArmR1) n.ArmR1.rotation.x = -2.6 + p.place * 0.3
    if (n.ArmL1) n.ArmL1.rotation.z = 0.25
    root.add(body)
    const tag = label('---', 0.6, { color: '#ffffff', outline: '#1d1d1d', outlineWidth: 10 })
    tag.position.set(L.x + p.x, p.h + 2.9, pz)
    root.add(tag)
    return { tag, p }
  })
  root.add(podium)
  root.add(bake(statics, true))
  scene.add(root)

  function drawPanel(panel, rows, youName) {
    const g = panel.canvas.getContext('2d')
    const w = panel.canvas.width
    const h = panel.canvas.height
    const bg = g.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, '#20232c')
    bg.addColorStop(1, '#14161c')
    g.fillStyle = bg
    g.fillRect(0, 0, w, h)
    g.fillStyle = panel.color
    g.fillRect(0, 0, w, 64)
    g.font = '700 34px Fredoka, "Arial Black", sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 6
    g.strokeStyle = '#141414'
    g.strokeText(panel.title, w / 2, 34)
    g.fillStyle = '#ffffff'
    g.fillText(panel.title, w / 2, 34)
    const rowH = 48
    rows.slice(0, 10).forEach((r, i) => {
      const y = 76 + i * rowH
      const you = r.name === youName
      g.fillStyle = you ? 'rgba(80,170,255,0.35)' : i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'
      g.fillRect(8, y, w - 16, rowH - 6)
      const medal = ['#ffd23a', '#dfe6ee', '#e09a5a'][i]
      g.fillStyle = medal ?? '#3a3e48'
      g.beginPath()
      g.arc(34, y + rowH / 2 - 3, 15, 0, Math.PI * 2)
      g.fill()
      g.font = '700 20px Fredoka, sans-serif'
      g.fillStyle = medal ? '#1d1d1d' : '#ffffff'
      g.fillText(String(i + 1), 34, y + rowH / 2 - 2)
      g.textAlign = 'left'
      g.font = '600 22px Fredoka, sans-serif'
      g.fillStyle = you ? '#9fd4ff' : '#ffffff'
      const name = r.name.length > 14 ? `${r.name.slice(0, 13)}…` : r.name
      g.fillText(name, 60, y + rowH / 2 - 2)
      g.textAlign = 'right'
      g.fillStyle = panel.color
      g.font = '700 22px Fredoka, sans-serif'
      g.fillText(fmt(panel.key, r[panel.key]), w - 18, y + rowH / 2 - 2)
      g.textAlign = 'center'
    })
    panel.tex.needsUpdate = true
  }

  let since = 99
  let remote = null // the server's `leaderboard` boards: { blocks: [{ name, value }], ... }

  // One board's rows: the server's players (minus anyone we have live numbers for: you),
  // the live entries, best first.
  function rowsFor(key, entries) {
    const live = new Set(entries.map((e) => e.name))
    const rows = entries.map((e) => ({ name: e.name, [key]: e[key] }))
    for (const r of remote?.[key] ?? []) {
      if (typeof r?.name === 'string' && Number.isFinite(r.value) && !live.has(r.name)) rows.push({ name: r.name, [key]: r.value })
    }
    return rows.sort((a, b) => b[key] - a[key]).slice(0, 10)
  }

  return {
    // The server's boards arrived: redraw at once.
    setRemote(data) {
      remote = data?.boards && typeof data.boards === 'object' ? data.boards : null
      since = 99
    },
    // entries: [{ name, strength, speed, blocks, cash, buildings, playtime }]
    update(dt, entries, youName) {
      since += dt
      if (since < 4) return
      since = 0
      for (const p of panels) drawPanel(p, rowsFor(p.key, entries), youName)
      const top = rowsFor('blocks', entries)
      statues.forEach((s, i) => {
        const e = top[i]
        const text = e ? e.name : '---'
        if (s.tag.userData.text === text) return
        s.tag.userData.text = text
        const t = label(text, 0.6, { color: '#ffffff', outline: '#1d1d1d', outlineWidth: 10 })
        s.tag.material.map?.dispose()
        s.tag.material = t.material
        s.tag.scale.copy(t.scale)
      })
    },
  }
}
