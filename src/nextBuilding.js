import './nextBuilding.css'
import { BUILDINGS, COARSE_POINTER, NEXT_BUILDING as NB } from './config.js'
import { pickBuilding } from './tower.js'
import { buildingThumbs } from './towerThumbs.js'
import { burst, flash } from './juice.js'
import * as sound from './audio/reel.js'

// The Next Building reel. When a finished building starts sinking the screen dims and a
// vertical reel of building portraits (name, chance) spins down past two white arrows,
// easing out onto the next building (tower.js pickBuilding: the same pick the tower makes).
// Then the title turns into its rarity over rotating rays, the neighbours fade, confetti
// rains and the rarity's sound plays; then the screen clears and the building rises.
// Driven from the frame loop (update) so it pauses with the game; it never takes input.

const rarityOf = (i) => NB.rarities[BUILDINGS[i].rarity] ?? NB.rarities.common
const pct = (c) => {
  const total = BUILDINGS.reduce((s, b) => s + (b.chance ?? 1), 0)
  const p = ((c ?? 1) / total) * 100
  return `${p < 10 ? Math.round(p * 10) / 10 : Math.round(p)}%`
}
const rnd = (lo, hi) => lo + Math.random() * (hi - lo)
const easeOut = (u) => 1 - Math.pow(1 - u, 4)
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const OVER = 0.24 // items the reel overshoots before settling back
const LEAD = 2 // items above the start / below the end so the reel is never empty

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

// A random building for the filler items (weighted like the real roll, never twice in a row).
function filler(prev) {
  const total = BUILDINGS.reduce((s, b) => s + (b.chance ?? 1), 0)
  for (let tries = 0; tries < 6; tries++) {
    let r = Math.random() * total
    let pick = BUILDINGS.length - 1
    for (let i = 0; i < BUILDINGS.length; i++) {
      r -= BUILDINGS[i].chance ?? 1
      if (r < 0) {
        pick = i
        break
      }
    }
    if (pick !== prev) return pick
  }
  return (prev + 1) % BUILDINGS.length
}

export function createNextBuilding() {
  const root = el('div', 'nb')
  root.hidden = true
  const title = el('div', 'nb-title', '<span>NEXT BUILDING</span>')
  const titleText = title.firstChild
  const stage = el('div', 'nb-stage')
  const rays = el('div', 'nb-rays')
  const glow = el('div', 'nb-glow')
  const reel = el('div', 'nb-reel')
  const arrowL = el('div', 'nb-arrow left')
  const arrowR = el('div', 'nb-arrow right')
  const bonus = el('div', 'nb-bonus')
  const sparkles = el('div', 'nb-sparkles')
  stage.append(rays, glow, reel, arrowL, arrowR, sparkles, bonus)
  const confetti = el('div', 'nb-confetti')
  root.append(title, stage, confetti)
  document.body.append(root)

  let items = [] // { node, i (BUILDINGS index) }
  let phase = 'idle' // 'in' | 'spin' | 'settle' | 'reveal' | 'out' | 'idle'
  let t = 0
  let start = LEAD
  let end = LEAD
  let pos = LEAD
  let lastSlot = 0
  let riserAt = 0
  let riserDone = false
  let target = 0
  let unit = 8 // px per layout unit (min of 1% height and 1.35% width)

  function measure() {
    unit = Math.min(window.innerHeight / 100, (window.innerWidth * 1.35) / 100)
    root.style.setProperty('--nbu', `${unit}px`)
  }
  window.addEventListener('resize', () => {
    if (phase === 'idle') return
    measure()
    layout()
  })

  function buildReel(seq) {
    const thumbs = buildingThumbs()
    reel.textContent = ''
    items = seq.map((i) => {
      const def = BUILDINGS[i]
      const r = rarityOf(i)
      const node = el('div', 'nb-item')
      const inner = el('div', 'nb-in')
      const pic = el('div', 'nb-pic')
      if (thumbs[i]) {
        const img = new Image()
        img.src = thumbs[i]
        img.alt = ''
        img.draggable = false
        pic.append(img)
      } else {
        // No WebGL portrait: a glass-coloured block in the building's shape of a tower.
        const block = el('div', 'nb-block')
        block.style.setProperty('--glass', def.glass)
        block.style.setProperty('--frame', def.frame)
        pic.append(block)
      }
      const chance = el('span', 'nb-pct')
      chance.textContent = pct(def.chance)
      chance.style.color = r.color
      pic.append(chance)
      const name = el('div', 'nb-name')
      name.textContent = def.name
      inner.append(pic, name)
      node.append(inner)
      reel.append(node)
      return { node, i }
    })
  }

  // Places every item for the reel position `pos` (item index at the arrows).
  function layout() {
    const spacing = 26 * unit
    for (let k = 0; k < items.length; k++) {
      const it = items[k]
      const d = k - pos
      const ad = Math.abs(d)
      if (ad > 2.7) {
        if (it.shown !== false) {
          it.node.style.visibility = 'hidden'
          it.shown = false
        }
        continue
      }
      if (it.shown !== true) {
        it.node.style.visibility = 'visible'
        it.shown = true
      }
      const s = 1 / (1 + 0.7 * ad)
      it.node.style.transform = `translate(-50%, -50%) translateY(${(-d * spacing).toFixed(1)}px) scale(${s.toFixed(3)})`
      if (phase !== 'reveal' && phase !== 'out') it.node.style.opacity = Math.max(0, Math.min(1, 1.25 - 0.5 * ad)).toFixed(3)
      it.node.style.zIndex = String(100 - Math.round(ad * 10))
    }
  }

  // Paper squares raining over the whole screen.
  function rain(colors) {
    const n = COARSE_POINTER ? 34 : 70
    const H = window.innerHeight
    for (let k = 0; k < n; k++) {
      const p = el('span', 'nb-paper')
      p.style.background = colors[k % colors.length]
      p.style.left = `${rnd(0, 100)}%`
      const w = rnd(7, 13)
      p.style.width = `${w}px`
      p.style.height = `${w * rnd(0.45, 0.7)}px`
      confetti.append(p)
      const life = rnd(2.4, 3.8)
      const sway = rnd(-60, 60)
      const spin = rnd(-720, 720)
      const y0 = -rnd(0.04, 0.6) * H // staggered above the screen, so it rains rather than drops as a sheet
      const anim = p.animate(
        [
          { transform: `translate(0, ${y0}px) rotate(0deg) rotateX(0deg)`, opacity: 1 },
          { transform: `translate(${sway}px, ${y0 + (H * 1.1 - y0) * 0.5}px) rotate(${spin * 0.5}deg) rotateX(360deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${-sway * 0.6}px, ${H * 1.08}px) rotate(${spin}deg) rotateX(720deg)`, opacity: 0.9 },
        ],
        { duration: life * 1000, delay: rnd(0, 500), easing: 'linear', fill: 'both' },
      )
      anim.onfinish = anim.oncancel = () => p.remove()
    }
  }

  // Little stars twinkling round the picked building.
  function twinkle(color) {
    sparkles.textContent = ''
    const n = COARSE_POINTER ? 7 : 12
    for (let k = 0; k < n; k++) {
      const s = el('span', 'nb-spark')
      const a = (k / n) * Math.PI * 2 + rnd(-0.3, 0.3)
      const r = rnd(15, 23)
      s.style.left = `calc(50% + ${(Math.cos(a) * r).toFixed(2)} * var(--nbu))`
      s.style.top = `calc(50% + ${(Math.sin(a) * r * 1.25).toFixed(2)} * var(--nbu))`
      s.style.animationDelay = `${rnd(0, 1.2).toFixed(2)}s`
      s.style.color = k % 3 === 0 ? '#ffffff' : color
      sparkles.append(s)
    }
  }

  function reveal() {
    phase = 'reveal'
    pos = end
    layout()
    const r = rarityOf(target)
    root.style.setProperty('--rar', r.color)
    root.style.setProperty('--rar-dark', r.dark)
    root.classList.add('reveal')
    root.classList.toggle('high', r.level >= 4)
    titleText.textContent = r.name
    title.classList.remove('pop')
    void title.offsetWidth
    title.classList.add('pop')
    items.forEach((it, k) => {
      if (k === end) it.node.classList.add('chosen')
      else it.node.style.opacity = '0'
    })
    bonus.textContent = r.bonus > 1 ? `x${r.bonus} BUILDING BONUS` : ''
    bonus.hidden = !(r.bonus > 1)
    twinkle(r.color)
    rain([r.color, '#ffffff', '#ffd23a', '#ff5f8f', '#5fe8ff', '#7dff6b', '#b77bff'])
    const cx = window.innerWidth / 2
    const cy = stage.getBoundingClientRect().top + stage.clientHeight / 2
    burst(cx, cy, r.level >= 3 ? 'big' : 'stars')
    if (r.level >= 4) flash('gold')
    else if (r.level >= 2) flash('white')
    sound.reveal(r.level)
  }

  function reset() {
    root.hidden = true
    root.classList.remove('open', 'reveal', 'high', 'spinning')
    title.classList.remove('pop')
    titleText.textContent = 'NEXT BUILDING'
    sparkles.textContent = ''
    confetti.textContent = ''
    bonus.hidden = true
    phase = 'idle'
  }

  return {
    get active() {
      return phase !== 'idle'
    },
    // Starts the reel for building n; returns how long the whole show takes (s).
    show(n) {
      reset()
      target = pickBuilding(n)
      // The strip: fillers, the pick at `end`, and (for the common ones) a rare one just past
      // it, so the reel stops one short of something big now and then.
      start = LEAD
      end = LEAD + NB.items
      const seq = []
      let prev = -1
      for (let k = 0; k < end + LEAD + 1; k++) {
        const i = k === end ? target : filler(prev)
        seq.push(i)
        prev = i
      }
      if (rarityOf(target).level < 3 && Math.random() < 0.55) {
        const rare = BUILDINGS.map((b, i) => i).filter((i) => rarityOf(i).level >= 4)
        if (rare.length) seq[end + 1] = rare[Math.floor(Math.random() * rare.length)]
      }
      if (seq[end - 1] === target) seq[end - 1] = filler(target)
      buildReel(seq)
      measure()
      pos = start
      lastSlot = Math.round(pos)
      t = 0
      riserDone = false
      riserAt = NB.fadeIn + NB.spin - 1.5
      phase = 'in'
      root.hidden = false
      layout()
      void root.offsetWidth
      root.classList.add('open', 'spinning')
      sound.open()
      return NB.fadeIn + NB.spin + NB.settle + NB.hold + NB.fadeOut
    },
    update(dt) {
      if (phase === 'idle') return
      t += Math.min(dt, 0.1)
      const spinAt = NB.fadeIn
      const settleAt = spinAt + NB.spin
      const revealAt = settleAt + NB.settle
      const outAt = revealAt + NB.hold
      const doneAt = outAt + NB.fadeOut
      if (phase === 'in' && t >= spinAt) phase = 'spin'
      if (phase === 'spin') {
        const u = Math.min(1, (t - spinAt) / NB.spin)
        pos = start + (end - start + OVER) * easeOut(u)
        if (!riserDone && t >= riserAt) {
          riserDone = true
          sound.riser(settleAt - t)
        }
        if (u >= 1) {
          phase = 'settle'
          sound.land()
        }
      }
      if (phase === 'settle') {
        const u = Math.min(1, (t - settleAt) / NB.settle)
        pos = end + OVER * (1 - easeInOut(u))
        if (u >= 1) root.classList.remove('spinning')
      }
      if ((phase === 'spin' || phase === 'settle') && Math.round(pos) !== lastSlot) {
        lastSlot = Math.round(pos)
        const u = Math.min(1, (t - spinAt) / NB.spin)
        sound.tick(u * u)
        arrowL.classList.remove('kick')
        arrowR.classList.remove('kick')
        void arrowL.offsetWidth
        arrowL.classList.add('kick')
        arrowR.classList.add('kick')
      }
      if (phase === 'spin' || phase === 'settle' || phase === 'in') layout()
      if (phase === 'settle' && t >= revealAt) reveal()
      if (phase === 'reveal' && t >= outAt) {
        phase = 'out'
        root.classList.remove('open')
        sound.close()
      }
      if (phase === 'out' && t >= doneAt) reset()
    },
  }
}
