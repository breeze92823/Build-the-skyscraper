import './windows.css'
import { GYM, PET_PASSES, RANKS, SHOP, UPGRADES } from './config.js'
import { ICONS } from './hudIcons.js'
import { burst, centre } from './juice.js'
import { createWindow, replay, uiButton } from './uiWindow.js'
import { buyPass, buyPetPass, buyUpgrade, commas, emit, rankIndex, short, spend, state, upgradeDef } from './stats.js'

// The menu windows (all on the shared uiWindow shell): Shop (passes, instant blocks, premium
// gym pads; everything for cash), Upgrades and Ranks. (Daily / Playtime / Free rewards: rewardsUi.js.)
// Each window re-renders whenever it opens or something it shows changes.

const money = (n) => `$${short(n)}`

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

export function createWindows({ onBoost, hud, say }) {
  // --- Shop -------------------------------------------------------------------------------------
  let focus = null // a pass card to scroll to and highlight (openShopAt)
  const shop = createWindow({ title: 'Shop', icon: ICONS.shop, className: 'w-shop', onOpen: () => renderShop(), onClose: () => (focus = null) })
  function openShopAt(id) {
    focus = id
    shop.open()
    if (!shop.isOpen()) return
    renderShop()
    requestAnimationFrame(() => shop.body.querySelector(`[data-pass="${id}"]`)?.scrollIntoView({ block: 'center' }))
  }
  function renderShop() {
    const b = shop.body
    b.innerHTML = ''
    b.append(el('div', 'uiw-heading uiw-text w-h', 'Passes'))
    const passes = el('div', 'w-cards')
    for (const p of SHOP.passes) {
      const owned = !!state.passes[p.id]
      const card = el('div', `w-card${owned ? ' owned' : ''}`, `<div class="w-ico">${ICONS[p.icon] ?? ICONS.block}</div><div class="w-name">${p.name}</div><div class="w-desc">${p.desc}</div>`)
      const btn = uiButton(owned ? 'Owned' : money(p.price), owned ? 'green' : state.cash >= p.price ? 'green' : 'red', () => {
        const r = buyPass(p.id)
        if (r.need) {
          replay(btn, 'shake')
          say(`Need ${money(r.need)} more!`, false)
        } else if (r.done) {
          replay(card, 'bump')
          burst(...centre(card), 'coins')
          say(`${p.name} unlocked!`, true)
          renderShop()
        }
      }, 'w-buy')
      btn.disabled = owned
      card.append(btn)
      passes.append(card)
    }
    b.append(passes)
    // Hatching passes (the egg panel's side buttons open the Shop here).
    b.append(el('div', 'uiw-heading uiw-text w-h', 'Pets'))
    const petCards = el('div', 'w-cards')
    for (const p of PET_PASSES) {
      const owned = !!state.passes[p.id]
      const card = el('div', `w-card${owned ? ' owned' : ''}${focus === p.id ? ' focus' : ''}`, `<div class="w-ico">${ICONS[p.icon] ?? ICONS.pets}</div><div class="w-name">${p.name}</div><div class="w-desc">${p.desc}</div>`)
      card.dataset.pass = p.id
      const btn = uiButton(owned ? 'Owned' : money(p.price), owned ? 'green' : state.cash >= p.price ? 'green' : 'red', () => {
        const r = buyPetPass(p.id)
        if (r.need) {
          replay(btn, 'shake')
          say(`Need ${money(r.need)} more!`, false)
        } else if (r.done) {
          replay(card, 'bump')
          burst(...centre(card), 'coins')
          say(`${p.name} unlocked!`, true)
          renderShop()
        }
      }, 'w-buy')
      btn.disabled = owned
      card.append(btn)
      petCards.append(card)
    }
    b.append(petCards)
    b.append(el('div', 'uiw-heading uiw-text w-h', 'Instant Blocks'))
    const boosts = el('div', 'w-cards four')
    SHOP.boosts.forEach((bo, i) => {
      const card = el('div', `w-card boost ${bo.color}`, `<div class="w-ico">${ICONS.block}</div><div class="w-name">+${commas(bo.blocks)}</div><div class="w-desc">blocks into the tower</div>`)
      const btn = uiButton(money(bo.price), state.cash >= bo.price ? 'green' : 'red', () => {
        if (onBoost(i, btn)) renderShop()
      }, 'w-buy')
      card.append(btn)
      boosts.append(card)
    })
    b.append(boosts)
    b.append(el('div', 'uiw-heading uiw-text w-h', 'Premium Gym'))
    const gymCards = el('div', 'w-cards')
    GYM.tiers.forEach((t, i) => {
      if (t.price == null) return
      const owned = !!state.gymOwned[i]
      const card = el('div', `w-card${owned ? ' owned' : ''}`, `<div class="w-ico">${ICONS.strength}</div><div class="w-name" style="color:${t.color}">${t.label}</div><div class="w-desc">${t.mult}x Strength and Speed per rep, forever</div>`)
      const btn = uiButton(owned ? 'Owned' : money(t.price), owned ? 'green' : state.cash >= t.price ? 'green' : 'red', () => {
        if (owned) return
        if (!spend(t.price)) {
          replay(btn, 'shake')
          say(`Need ${money(t.price - state.cash)} more!`, false)
          return
        }
        state.gymOwned[i] = true
        emit('gymOwned', i)
        burst(...centre(card), 'stars')
        say(`${t.label} pad unlocked!`, true)
        renderShop()
      }, 'w-buy')
      btn.disabled = owned
      card.append(btn)
      gymCards.append(card)
    })
    b.append(gymCards)
    b.append(el('div', 'w-note', 'Everything here is bought with in-game cash you earn by building.'))
  }

  // --- Upgrades --------------------------------------------------------------------------------------
  const upgrades = createWindow({ title: 'Upgrades', icon: ICONS.upgrades, className: 'w-upgrades', onOpen: () => renderUpgrades() })
  const fmtVal = (def, l) => def.fmt(def.value(l))
  function renderUpgrades() {
    const b = upgrades.body
    b.innerHTML = ''
    b.append(el('div', 'w-cashbar', `<span class="w-ico">${ICONS.cash}</span><b class="uiw-text">${money(state.cash)}</b>`))
    const list = el('div', 'w-rows')
    for (const u of UPGRADES) {
      const def = upgradeDef(u.id)
      const lvl = state.upgrades[u.id]
      const max = lvl >= def.max
      const price = max ? 0 : def.price(lvl)
      const row = el(
        'div',
        `w-row up-${u.color}`,
        `<div class="w-uico"><div class="w-ico">${ICONS[u.id] ?? ICONS.block}</div><div class="w-lv uiw-text">Lv.${lvl}</div></div>
         <div class="w-info"><div class="w-name uiw-text">${u.name}</div>
         <div class="w-desc">${u.desc}</div>
         <div class="w-val uiw-text">${fmtVal(def, lvl)}${max ? ' <b>MAX</b>' : ` <span class="w-arrow">»</span> <b>${fmtVal(def, lvl + 1)}</b>`}</div></div>`,
      )
      // Cash only (never Gems/Robux): green when you can afford it, grey when you cannot.
      const btn = uiButton(max ? 'MAX' : `<span class="w-cashico">${ICONS.cash}</span>${commas(price)}`, max || state.cash >= price ? 'green' : 'grey', () => {
        const r = buyUpgrade(u.id)
        if (r.need) {
          replay(btn, 'shake')
          say(`Need ${money(r.need)} more!`, false)
        } else if (r.done) {
          burst(...centre(row), 'sparks')
          renderUpgrades()
        }
      }, 'w-buy')
      btn.disabled = max
      row.append(btn)
      list.append(row)
    }
    b.append(list)
  }

  // --- Ranks ------------------------------------------------------------------------------------------
  let blocksPerMin = 0
  const ranks = createWindow({ title: 'Ranks', icon: ICONS.ranks, className: 'w-ranks', onOpen: () => renderRanks(true) })
  function renderRanks(scroll) {
    const b = ranks.body
    b.innerHTML = ''
    const head = el('div', 'rk-head', `<div><span>TOTAL BLOCKS</span><b>${commas(state.totalBlocks)}</b></div><div><span>YOUR SPEED</span><b>${blocksPerMin > 0 ? `${short(blocksPerMin)}/min` : '--'}</b></div>`)
    b.append(head)
    const list = el('div', 'rk-list')
    const me = rankIndex()
    RANKS.forEach((r, i) => {
      const done = i < me
      const you = i === me
      const row = el('div', `rk-row${done ? ' done' : ''}${you ? ' you' : ''}${r.theme ? ` theme-${r.theme}` : ''}`)
      const dia = `<div class="rk-dia" style="background:${r.color}"><span>${i + 1}</span></div>`
      let right = ''
      if (done) right = `<div class="rk-check">${ICONS.check}</div>`
      else if (you) right = '<div class="rk-you">YOU</div>'
      else right = `<div class="rk-go"><b>${short(r.at - state.totalBlocks)}</b><span>blocks to go</span></div>`
      const next = RANKS[i + 1]
      const prog = you && next ? `<div class="rk-bar"><div style="width:${Math.min(100, ((state.totalBlocks - r.at) / (next.at - r.at)) * 100)}%"></div><span>${commas(state.totalBlocks)} / ${commas(next.at)}</span></div><div class="rk-next">Next: <b>${next.name.toUpperCase()}</b> Keep building!</div>` : ''
      row.innerHTML = `${dia}<div class="rk-body"><div class="rk-name" style="color:${r.color}">${r.name.toUpperCase()}</div><div class="rk-at">${i === 0 ? 'Starting rank' : `${commas(r.at)} blocks`}${r.theme ? ' <i>LEGEND</i>' : ''}</div>${prog}</div>${right}`
      list.append(row)
    })
    b.append(list)
    b.append(el('div', 'w-note', `Every rank adds +3% cash. Rank up by placing blocks on the tower.`))
    if (scroll) requestAnimationFrame(() => list.querySelector('.you')?.scrollIntoView({ block: 'center' }))
  }

  void hud
  return {
    shop,
    openShopAt,
    upgrades,
    ranks,
    setBlocksPerMin(v) {
      blocksPerMin = v
    },
    // Re-render whichever window is open (cash changed, etc.).
    refresh() {
      if (shop.isOpen()) renderShop()
      if (upgrades.isOpen()) renderUpgrades()
      if (ranks.isOpen()) renderRanks(false)
    },
  }
}
