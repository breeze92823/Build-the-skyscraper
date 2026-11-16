import './spinUi.css'
import { SPIN } from './config.js'
import { ICONS } from './hudIcons.js'
import { burst, centre } from './juice.js'
import { createWindow, replay, uiButton } from './uiWindow.js'
import { sfx } from './audio/index.js'
import { petSvg } from './petArt.js'
import { applyPrize, cashPrize, jackpotPrize, prizeLabel, rollSlice } from './spinPrizes.js'
import * as S from './stats.js'

// The Spin Wheel window: the Pity meter (Mystery Jackpot every SPIN.pity spins) on the left,
// the wheel in the middle (its hub is the SPIN! button), and on the right the Normal / Golden
// spin toggles and the spin packs, all bought with cash. Every building you help finish
// gives a free spin. onSpin(kind, index, offset) lets the 3D wheel play the same spin.

const { state } = S
const TAU = 360
const money = (n) => `$${S.short(n)}`

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

// An icon dropped into the wheel's SVG at (x, y), size s.
function inlineIcon(svg, x, y, s) {
  return svg.replace(/^<svg viewBox="([^"]+)"[^>]*>/, `<svg x="${x}" y="${y}" width="${s}" height="${s}" viewBox="$1">`)
}
function sliceIcon(p) {
  if (p.kind === 'cash') return ICONS.cash
  if (p.kind === 'gym') return ICONS.strength
  if (p.kind === 'pet') return petSvg(S.petDef(p.pet), p.gold ?? 0)
  return ICONS.spinGold
}

function wheelSvg(slices) {
  const n = slices.length
  const step = TAU / n
  const r = 100
  const rad = (d) => (d * Math.PI) / 180
  const parts = slices.map((p, i) => {
    const a = -90 + i * step
    const a0 = rad(a - step / 2)
    const a1 = rad(a + step / 2)
    const path = `M0 0 L${(r * Math.cos(a0)).toFixed(2)} ${(r * Math.sin(a0)).toFixed(2)} A${r} ${r} 0 0 1 ${(r * Math.cos(a1)).toFixed(2)} ${(r * Math.sin(a1)).toFixed(2)} Z`
    const [l1, l2] = prizeLabel(p)
    const pct = `${p.chance}%`
    return `<path d="${path}" fill="${p.color}" stroke="#1b1b24" stroke-width="1.6"/>
      <g transform="rotate(${a + 90})">
        <text y="-84" class="sp-pct">${pct}</text>
        <text y="-71" class="sp-l1">${l1}</text>
        ${l2 ? `<text y="-62" class="sp-l2">${l2}</text>` : ''}
        ${inlineIcon(sliceIcon(p), -11, -56, 22)}
      </g>`
  })
  return `<svg viewBox="-112 -112 224 224" class="sp-wheel-svg"><circle r="${r + 7}" fill="#ffc21a" stroke="#1b1b24" stroke-width="3"/>${parts.join('')}${slices
    .map((_, i) => {
      const a = rad(-90 + (i + 0.5) * step)
      return `<circle cx="${((r + 3.5) * Math.cos(a)).toFixed(2)}" cy="${((r + 3.5) * Math.sin(a)).toFixed(2)}" r="3.2" fill="#ff9a1a" stroke="#1b1b24" stroke-width="1.2"/>`
    })
    .join('')}</svg>`
}

export function createSpinWindow({ say, onSpin }) {
  let mode = 'normal'
  let rot = 0 // degrees the wheel has turned clockwise; slice i is on top at -i * step
  let spinning = false
  const win = createWindow({ title: 'Spin Wheel', icon: ICONS.spin, className: 'w-spin', onOpen: () => render() })

  // Static frame, re-rendered parts inside.
  const body = win.body
  const wrap = el('div', 'sp-wrap')
  const pity = el('div', 'sp-pity')
  const mid = el('div', 'sp-mid')
  const right = el('div', 'sp-right')
  wrap.append(pity, mid, right)
  const foot = el('div', 'sp-foot pt-txt', `Finish a building = +${SPIN.perBuilding} FREE spin!`)
  const result = el('div', 'sp-result')
  result.hidden = true
  body.append(wrap, foot, result)

  const pointer = el('div', 'sp-pointer')
  const wheelBox = el('div', 'sp-wheel')
  const rotor = el('div', 'sp-rotor')
  wheelBox.append(rotor, pointer)
  const hub = el('button', 'sp-hub', '<span class="pt-txt">SPIN!</span><small class="pt-txt"></small>')
  hub.type = 'button'
  hub.addEventListener('click', () => spin())
  wheelBox.append(hub)
  mid.append(wheelBox)

  function render() {
    const slices = SPIN[mode]
    rotor.innerHTML = wheelSvg(slices)
    rotor.style.transform = `rotate(${rot}deg)`
    wheelBox.classList.toggle('golden', mode === 'golden')
    hub.querySelector('small').textContent = `${state.spins[mode]} left`
    renderPity()
    renderRight()
  }
  function renderPity() {
    const left = SPIN.pity - state.spins.pity
    pity.innerHTML = `<div class="sp-pt pt-txt">PITY</div><div class="sp-coin">?</div><div class="sp-jp pt-txt">MYSTERY JACKPOT</div><div class="sp-meter"><div style="height:${(state.spins.pity / SPIN.pity) * 100}%"></div></div><div class="sp-count pt-txt">${state.spins.pity} / ${SPIN.pity}</div><div class="sp-togo pt-txt">${left} spin${left === 1 ? '' : 's'} to go</div>`
  }
  function renderRight() {
    right.innerHTML = ''
    for (const k of ['normal', 'golden']) {
      const b = el('button', `sp-mode ${k}${mode === k ? ' on' : ''}`, `<span class="pt-txt">${k === 'normal' ? 'NORMAL' : 'GOLDEN'}<br>SPIN</span><b class="pt-txt">x${state.spins[k]}</b>`)
      b.type = 'button'
      b.addEventListener('click', () => {
        if (spinning) return
        mode = k
        render()
      })
      right.append(b)
    }
    const scale = S.spinScale()
    for (const pack of SPIN.buy) {
      const price = Math.round(pack.price * scale)
      const row = el('div', 'sp-pack', `${pack.tag ? `<div class="sp-tag pt-txt">${pack.tag}</div>` : ''}<div class="sp-pn pt-txt">${pack.n} SPIN${pack.n > 1 ? 'S' : ''}</div>`)
      const btn = uiButton(money(price), state.cash >= price ? 'green' : 'red', () => {
        if (!S.spend(price)) {
          replay(btn, 'shake')
          say(`Need ${money(price - state.cash)} more!`, false)
          return
        }
        S.addSpins('normal', pack.n)
        sfx.purchase()
        burst(...centre(btn), 'coins')
        say(`+${pack.n} spin${pack.n > 1 ? 's' : ''}!`, true)
        render()
      }, 'sp-buy')
      row.append(btn)
      right.append(row)
    }
  }

  function showResult(r, jackpot = false) {
    result.hidden = false
    result.className = `sp-result ${r.kind}${jackpot ? ' jackpot' : ''}`
    const icon = r.kind === 'pet' && r.pet ? petSvg(r.pet, r.tier) : r.kind === 'gym' ? ICONS.strength : r.kind === 'golden' ? ICONS.spinGold : ICONS.cash
    result.innerHTML = `<div class="sp-rcard">${jackpot ? '<div class="sp-rjp pt-txt">MYSTERY JACKPOT!</div>' : ''}<div class="sp-ricon">${icon}</div><div class="sp-rtitle pt-txt"></div><div class="sp-rsub"></div></div>`
    result.querySelector('.sp-rtitle').textContent = r.title
    result.querySelector('.sp-rsub').textContent = r.sub
    if (r.color) result.querySelector('.sp-rtitle').style.color = r.color
    const ok = uiButton('Nice!', 'green', () => (result.hidden = true))
    result.querySelector('.sp-rcard').append(ok)
    requestAnimationFrame(() => burst(...centre(result.querySelector('.sp-rcard')), r.kind === 'cash' ? 'coins' : 'big'))
  }

  function spin() {
    if (spinning) return
    if (state.spins[mode] <= 0) {
      replay(hub, 'shake')
      say(mode === 'golden' ? 'No golden spins. Win them on the wheel!' : 'No spins left! Finish a building or buy spins.', false)
      return
    }
    result.hidden = true
    S.addSpins(mode, -1)
    const kind = mode
    const slices = SPIN[kind]
    const index = rollSlice(slices)
    const offset = Math.random() * 2 - 1
    const step = TAU / slices.length
    const target = -index * step + offset * step * 0.35
    const from = rot
    const to = rot + SPIN.turns * TAU + ((((target - rot) % TAU) + TAU) % TAU)
    spinning = true
    hub.disabled = true
    onSpin?.(kind, index, offset)
    sfx.swish()
    const t0 = performance.now()
    let lastSlice = Math.floor(from / step)
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / (SPIN.time * 1000))
      const e = 1 - Math.pow(1 - t, 4)
      rot = from + (to - from) * e
      rotor.style.transform = `rotate(${rot}deg)`
      const s = Math.floor(rot / step)
      if (s !== lastSlice) {
        lastSlice = s
        sfx.tick()
      }
      if (t < 1) requestAnimationFrame(tick)
      else finish()
    }
    requestAnimationFrame(tick)
    function finish() {
      rot %= TAU
      spinning = false
      hub.disabled = false
      const r = applyPrize(slices[index])
      if (r.kind === 'cash') sfx.purchase()
      else sfx.reveal(r.kind === 'pet' ? 5 : r.kind === 'gym' ? 4 : 3)
      state.spins.pity++
      let jp = null
      if (state.spins.pity >= SPIN.pity) {
        state.spins.pity = 0
        jp = applyPrize(jackpotPrize())
      }
      S.emit('spins', kind)
      if (win.isOpen()) {
        render()
        showResult(r)
        if (jp) setTimeout(() => {
          sfx.reveal(5)
          showResult(jp, true)
        }, 1600)
      } else {
        say(`Spin: ${r.title}`, true)
        if (jp) setTimeout(() => say(`MYSTERY JACKPOT: ${jp.title}`, true), 1500)
      }
    }
  }

  return {
    win,
    open(kind) {
      if (kind) mode = kind
      win.open()
    },
    refresh() {
      if (win.isOpen() && !spinning) render()
    },
    get spinning() {
      return spinning
    },
    cashPrize,
  }
}
