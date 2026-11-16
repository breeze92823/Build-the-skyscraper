import './petUi.css'
import { Vector3 } from 'three'
import { PET, PET_PASSES, PETS, RARITIES } from './config.js'
import { ICONS } from './hudIcons.js'
import { burst, centre } from './juice.js'
import { anyWindowOpen, createWindow, replay, uiButton } from './uiWindow.js'
import { sfx } from './audio/index.js'
import { boostText, eggSvg, petSvg, petTitle, rarityOf } from './petArt.js'
import * as S from './stats.js'

// Everything pets on screen:
//  - the egg panel: near an egg in the Egg Hall a card shows its five pets (black silhouettes
//    until you hatch one) with odds, and Hatch (E) / Multi (F) / Auto (T) buttons; the side
//    buttons are the hatching passes (they open the Shop on them)
//  - the hatch show: eggs rock, crack, and the pets pop out on rarity-coloured cards
//  - the Pets window (equip / unequip / delete, Equip Best) and the Pet Merge window
// createPets() wires them to the hall and returns { panel, hatch(), toggleAuto(), windows }.

const { state } = S
const money = (n) => `$${S.short(n)}`

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

// --- Egg panel --------------------------------------------------------------------------------
function createEggPanel({ onHatch, onMulti, onAuto, onPass }) {
  const root = el('div', 'egp')
  root.hidden = true
  const side = el('div', 'egp-side')
  const card = el('div', 'egp-card')
  const title = el('div', 'egp-title pt-txt')
  const tiles = el('div', 'egp-tiles')
  const btns = el('div', 'egp-btns')
  const bHatch = el('button', 'egp-btn hatch', '<b>E</b><span>Hatch</span>')
  const bMulti = el('button', 'egp-btn multi', '<b>F</b><span>Multi</span>')
  const bAuto = el('button', 'egp-btn auto', '<b>T</b><span>Auto</span>')
  for (const b of [bHatch, bMulti, bAuto]) b.type = 'button'
  btns.append(bHatch, bMulti, bAuto)
  const price = el('div', 'egp-price pt-txt')
  card.append(title, tiles, btns, price)
  root.append(side, card)
  document.body.append(root)
  const tap = (b, fn) =>
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    })
  tap(bHatch, () => onHatch())
  tap(bMulti, () => onMulti())
  tap(bAuto, () => onAuto())

  let egg = null
  let auto = false
  function render() {
    if (!egg) return
    const def = egg.def
    title.textContent = def.name.toUpperCase()
    title.style.color = def.color
    tiles.innerHTML = ''
    const odds = S.eggOdds(def.id)
    PETS.filter((p) => p.egg === def.id).forEach((p, i) => {
      const seen = !!state.petSeen[p.id]
      const r = RARITIES[p.rarity]
      const t = el('div', 'egp-tile', `${petSvg(p, 0, { silhouette: !seen })}<span class="pt-txt">${odds[i] < 1 ? odds[i].toFixed(1) : Math.round(odds[i])}%</span>`)
      t.style.setProperty('--rc', r.color)
      t.style.setProperty('--rd', r.dark)
      t.title = seen ? `${p.name} (${r.name}) ${boostText(p.bonus)}` : `??? (${r.name})`
      tiles.append(t)
    })
    const n = S.multiCount()
    bMulti.querySelector('span').textContent = n > 1 ? `x${n}` : 'Multi'
    bMulti.classList.toggle('locked', n <= 1)
    bAuto.classList.toggle('on', auto)
    price.innerHTML = `${ICONS.cash}<span>${money(def.price)}</span>`
    price.classList.toggle('short', state.cash < def.price)
    side.innerHTML = ''
    for (const p of PET_PASSES) {
      if (p.id === 'slots') continue
      const owned = !!state.passes[p.id]
      const b = el('button', `egp-pass${owned ? ' owned' : ''}`, `<span class="egp-pi">${p.multi ? eggStack(p.multi) : ICONS.lucky}</span><span class="pt-txt">${p.name}</span>`)
      b.type = 'button'
      tap(b, () => onPass(p.id))
      side.append(b)
    }
  }
  const v = new Vector3()
  return {
    get egg() {
      return egg
    },
    set auto(on) {
      auto = on
      bAuto.classList.toggle('on', on)
    },
    render,
    // eggs: the hall's eggs. Picks the nearest one within PET.near of its pedestal; `hide`
    // keeps it picked but off screen (the hatch show is playing).
    update(camera, pos, eggs, hide) {
      let best = null
      if (pos && !anyWindowOpen()) {
        let bd = Infinity
        for (const e of eggs) {
          // A box on the carpet beside the pedestal (kept clear of the Pet Merge machine).
          const dx = Math.abs(pos.x - e.front.x)
          const dz = Math.abs(pos.z - e.front.z)
          const d = Math.hypot(dx, dz)
          if (dx < PET.near.x && dz < PET.near.z && d < bd && pos.y < 3.5) {
            bd = d
            best = e
          }
        }
      }
      if (best !== egg) {
        egg = best
        render()
      }
      root.hidden = !egg || hide
      if (root.hidden) return
      v.set(egg.x, egg.top * 0.62, egg.z).project(camera)
      const w = window.innerWidth
      const h = window.innerHeight
      if (h > w || v.z > 1) {
        root.style.transform = `translate(${Math.round(w / 2)}px, ${Math.round(h * 0.63)}px) translate(-50%, -50%)`
        return
      }
      const x = Math.min(w - root.offsetWidth / 2 - 8, Math.max(root.offsetWidth / 2 + 8, ((v.x + 1) / 2) * w))
      const y = Math.min(h - root.offsetHeight / 2 - 8, Math.max(root.offsetHeight / 2 + 8, ((1 - v.y) / 2) * h))
      root.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`
    },
  }
}
// A little pile of eggs for the multi-hatch pass buttons.
function eggStack(n) {
  const e = '<path d="M0 -9 C-6 -9 -8 0 -8 3 C-8 8 -4 10 0 10 C4 10 8 8 8 3 C8 0 6 -9 0 -9 Z" fill="#fff" stroke="#1b1b24" stroke-width="2"/>'
  const spots = n >= 16 ? [[14, 28], [30, 28], [22, 16], [38, 16], [6, 16], [30, 6]] : n >= 8 ? [[14, 28], [30, 28], [22, 16], [38, 22], [6, 22]] : [[14, 28], [30, 28], [22, 16]]
  return `<svg viewBox="-4 -6 52 48">${spots.map(([x, y]) => `<g transform="translate(${x} ${y})">${e}</g>`).join('')}</svg>`
}

// --- Hatch show -----------------------------------------------------------------------------------
function createHatchShow() {
  const root = el('div', 'hatch-show')
  root.hidden = true
  document.body.append(root)
  let skip = null
  root.addEventListener('pointerdown', () => skip?.())
  const wait = (ms) =>
    new Promise((res) => {
      const t = setTimeout(res, ms)
      skip = () => {
        clearTimeout(t)
        res()
      }
    })
  return {
    get busy() {
      return !root.hidden
    },
    // results: [{ def, tier, isNew }]
    async play(eggId, results, fast) {
      root.hidden = false
      root.className = `hatch-show n${Math.min(results.length, 16)}${fast ? ' fast' : ''}`
      root.innerHTML = ''
      const grid = el('div', 'hatch-grid')
      root.append(grid)
      const cells = results.map(() => {
        const c = el('div', 'hatch-cell', `<div class="hatch-egg">${eggSvg(eggId)}</div>`)
        grid.append(c)
        return c
      })
      const rock = fast ? PET.autoTime : PET.hatchTime
      sfx.eggWobble(rock)
      await wait(rock * 1000)
      sfx.eggCrack()
      let top = 0
      results.forEach((r, i) => {
        const rar = rarityOf(r.def)
        top = Math.max(top, rar.level)
        const c = cells[i]
        c.classList.add('open')
        c.style.setProperty('--rc', rar.color)
        c.style.setProperty('--rd', rar.dark)
        c.innerHTML = `<div class="hatch-pet">${petSvg(r.def, r.tier)}</div><div class="hatch-name pt-txt">${petTitle(r.def, r.tier)}</div><div class="hatch-rar pt-txt">${rar.name} · ${boostText(S.petPower(r))}</div>${r.isNew ? '<div class="hatch-new pt-txt">NEW!</div>' : ''}`
      })
      sfx.reveal(top)
      if (top >= 3) requestAnimationFrame(() => burst(window.innerWidth / 2, window.innerHeight / 2, 'big'))
      await wait(fast ? 900 : 1900)
      root.classList.add('out')
      await new Promise((res) => setTimeout(res, 180))
      root.hidden = true
      skip = null
    },
  }
}

// --- Windows --------------------------------------------------------------------------------------
function createPetWindows({ say }) {
  let selected = null
  let confirmDel = 0
  const pets = createWindow({ title: 'Pets', icon: ICONS.pets, className: 'w-pets', onOpen: () => render(), onClose: () => (selected = null) })
  function card(p, onTap) {
    const def = S.petDef(p.id)
    const r = rarityOf(def)
    const c = el('button', `pt-card${S.isEquipped(p.uid) ? ' eq' : ''}${selected === p.uid ? ' sel' : ''}${p.tier ? ` tier${p.tier}` : ''}`, `<div class="pt-art">${petSvg(def, p.tier)}</div><div class="pt-boost pt-txt">${boostText(S.petPower(p))}</div>${S.isEquipped(p.uid) ? `<div class="pt-check">${ICONS.check}</div>` : ''}`)
    c.type = 'button'
    c.style.setProperty('--rc', r.color)
    c.style.setProperty('--rd', r.dark)
    c.title = `${petTitle(def, p.tier)} (${r.name})`
    c.addEventListener('click', () => onTap(p))
    return c
  }
  function render() {
    const b = pets.body
    b.innerHTML = ''
    const head = el('div', 'pt-head', `<div><span>EQUIPPED</span><b>${state.petEq.length}/${S.petSlots()}</b></div><div><span>STORAGE</span><b>${state.pets.length}/${PET.storage}</b></div><div><span>PET BOOST</span><b class="g">${boostText(S.petBonus())}</b></div>`)
    b.append(head)
    const tools = el('div', 'pt-tools')
    tools.append(
      uiButton('Equip Best', 'green', () => {
        S.equipBest()
        sfx.equip()
        render()
      }, 'pt-tool'),
      uiButton('Unequip All', 'red', () => {
        S.unequipAll()
        render()
      }, 'pt-tool'),
    )
    b.append(tools)
    if (!state.pets.length) {
      b.append(el('div', 'pt-empty', 'No pets yet! Hatch eggs in the <b>Egg Hall</b> (south of the road, east of the leaderboard). Pets boost your cash and gym gains.'))
      return
    }
    const grid = el('div', 'pt-grid')
    const list = [...state.pets].sort((a, b2) => Number(S.isEquipped(b2.uid)) - Number(S.isEquipped(a.uid)) || S.petPower(b2) - S.petPower(a))
    for (const p of list) {
      grid.append(
        card(p, (q) => {
          selected = selected === q.uid ? null : q.uid
          confirmDel = 0
          render()
        }),
      )
    }
    const sel = state.pets.find((p) => p.uid === selected)
    if (sel) {
      const def = S.petDef(sel.id)
      const r = rarityOf(def)
      const bar = el('div', 'pt-bar', `<div class="pt-bar-art">${petSvg(def, sel.tier)}</div><div class="pt-bar-info"><div class="pt-bar-name">${petTitle(def, sel.tier)}</div><div class="pt-bar-sub" style="color:${r.dark}">${r.name} · ${boostText(S.petPower(sel))} cash &amp; gym</div></div>`)
      const eq = S.isEquipped(sel.uid)
      const full = !eq && state.petEq.length >= S.petSlots()
      const be = uiButton(eq ? 'Unequip' : full ? 'Slots full' : 'Equip', eq ? 'red' : full ? 'red' : 'green', () => {
        if (!S.equipPet(sel.uid)) {
          replay(be, 'shake')
          say(`All ${S.petSlots()} slots are full. Unequip one first.`, false)
          return
        }
        if (!eq) sfx.equip()
        render()
      }, 'pt-act')
      const bd = uiButton(Date.now() < confirmDel ? 'Sure?' : 'Delete', 'red', () => {
        if (Date.now() > confirmDel) {
          confirmDel = Date.now() + 2500
          render()
          return
        }
        S.deletePet(sel.uid)
        sfx.trash()
        selected = null
        confirmDel = 0
        render()
      }, 'pt-act')
      bar.append(be, bd)
      b.append(bar)
    } else {
      b.append(el('div', 'w-note', 'Tap a pet to equip or delete it. Equipped pets follow you and add their boost to your cash and gym gains.'))
    }
    // The grid goes last so the selected pet's buttons stay in view above it.
    b.append(grid)
  }

  // Pet Merge machine.
  const merge = createWindow({ title: 'Pet Merge', icon: ICONS.merge, className: 'w-merge', onOpen: () => renderMerge() })
  function renderMerge() {
    const b = merge.body
    b.innerHTML = ''
    b.append(el('div', 'mg-info', `Put <b>${PET.merge}</b> of the same pet in the machine to get one <b class="gold">Golden</b> pet (<b>x${PET.tiers[1].mult}</b> its boost). ${PET.merge} Golden make a <b class="rb">Rainbow</b> pet (<b>x${PET.tiers[2].mult}</b>).`))
    const stacks = S.petStacks().filter((s) => s.tier < PET.tiers.length - 1)
    if (!stacks.length) {
      b.append(el('div', 'pt-empty', 'You have no pets to merge yet. Hatch some eggs!'))
      return
    }
    const rows = el('div', 'mg-rows')
    stacks.sort((a, c) => Math.min(1, c.list.length / PET.merge) - Math.min(1, a.list.length / PET.merge))
    for (const st of stacks) {
      const def = S.petDef(st.id)
      const r = rarityOf(def)
      const have = st.list.length
      const ready = have >= PET.merge
      const nextName = petTitle(def, st.tier + 1)
      const row = el('div', `mg-row${ready ? ' ready' : ''}`, `<div class="mg-art" style="--rc:${r.color};--rd:${r.dark}">${petSvg(def, st.tier)}</div><div class="mg-body"><div class="mg-name">${petTitle(def, st.tier)}</div><div class="mg-meter"><div style="width:${Math.min(100, (have / PET.merge) * 100)}%"></div><span>${have} / ${PET.merge}</span></div><div class="mg-to">➜ ${nextName} <b>${boostText(def.bonus * PET.tiers[st.tier + 1].mult)}</b></div></div><div class="mg-next">${petSvg(def, st.tier + 1)}</div>`)
      const btn = uiButton('Merge', ready ? 'green' : 'red', () => {
        if (!ready) {
          replay(btn, 'shake')
          say(`Need ${PET.merge - have} more ${def.name}!`, false)
          return
        }
        const made = S.mergePets(st.id, st.tier)
        if (!made) return
        sfx.craft()
        setTimeout(() => sfx.reveal(Math.min(5, rarityOf(def).level + made.tier)), 300)
        burst(...centre(row), 'big')
        say(`${petTitle(def, made.tier)} created!`, true)
        renderMerge()
      }, 'w-buy')
      row.append(btn)
      rows.append(row)
    }
    b.append(rows)
  }
  return {
    pets,
    merge,
    refresh() {
      if (pets.isOpen()) render()
      if (merge.isOpen()) renderMerge()
    },
  }
}

// --- Controller --------------------------------------------------------------------------------------
// hall: eggs.js; openShop(): the Shop window; say(text, good).
export function createPets({ hall, say, openShop }) {
  const show = createHatchShow()
  const windows = createPetWindows({ say })
  let auto = null // egg def while auto hatching
  const panel = createEggPanel({
    onHatch: () => hatch(1),
    onMulti: () => multi(),
    onAuto: () => toggleAuto(),
    onPass: (id) => openShop(id),
  })

  async function hatch(want, { fast = false } = {}) {
    const egg = panel.egg
    if (!egg || show.busy) return false
    const def = egg.def
    const free = S.petFree()
    if (free <= 0) {
      say(`Pet storage full (${PET.storage})! Delete or merge some pets.`, false)
      stopAuto()
      sfx.deny()
      return false
    }
    const n = Math.min(want, free, Math.floor(state.cash / def.price))
    if (n < 1) {
      say(`Need ${money(def.price - state.cash)} more!`, false)
      stopAuto()
      sfx.deny()
      return false
    }
    S.spend(n * def.price)
    hall.wobble(def.id)
    const results = []
    for (let i = 0; i < n; i++) {
      const pd = S.rollEgg(def.id)
      const isNew = !state.petSeen[pd.id]
      const p = S.addPet(pd.id)
      results.push({ def: pd, tier: 0, isNew, uid: p?.uid, id: pd.id })
    }
    panel.render()
    await show.play(def.id, results, fast)
    return true
  }
  function multi() {
    const n = S.multiCount()
    if (n <= 1) {
      say('Get the +3 Eggs pass in the Shop to hatch more at once!', false)
      openShop('egg3')
      return
    }
    hatch(n)
  }
  function stopAuto() {
    auto = null
    panel.auto = false
  }
  async function toggleAuto() {
    if (auto) return stopAuto()
    if (!panel.egg) return
    auto = panel.egg.def
    panel.auto = true
    say('Auto hatch on! Walk away or press T to stop.', true)
    while (auto && panel.egg?.def === auto) {
      const ok = await hatch(S.multiCount(), { fast: true })
      if (!ok) break
      await new Promise((r) => setTimeout(r, 120))
    }
    stopAuto()
  }

  S.on('pets', () => {
    windows.refresh()
    panel.render()
  })
  S.on('pass', () => panel.render())
  return {
    panel,
    windows,
    show,
    // E / F / T: only while an egg panel is showing. Returns true when it handled the key.
    key(which) {
      if (!panel.egg || anyWindowOpen()) return false
      if (which === 'hatch') hatch(1)
      else if (which === 'multi') multi()
      else toggleAuto()
      return true
    },
    update(camera, pos, blocked) {
      panel.update(camera, pos, hall.eggs, blocked || show.busy)
      if (auto && !panel.egg && !show.busy) stopAuto()
    },
    refresh() {
      if (panel.egg) panel.render()
    },
  }
}
