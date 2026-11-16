import './hud.css'
import { INSIDE, RANKS, SHOP } from './config.js'
import { ICONS } from './hudIcons.js'
import { replay } from './uiWindow.js'
import { clock, commas, short } from './stats.js'

// The heads-up display: tower progress + instant-block boosts (top), event and stats
// (left, below Boxity's reserved corner), rank card + menu buttons (right), the status
// card (bottom), big banners, warnings, floating numbers and the gym "lift" button.
// update(snapshot) runs every frame and only touches the DOM when a value changes.

// Restarts a one-shot CSS animation without any sound (stat pulses, the status card).
function restart(node, cls) {
  node.classList.remove(cls)
  void node.offsetWidth
  node.classList.add(cls)
}

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}

export function createHud() {
  const root = el('div', 'hud')
  const actions = new Map()
  const fire = (name, arg, e) => actions.get(name)?.(arg, e)
  const btn = (cls, html, name, arg) => {
    const b = el('button', cls, html)
    b.type = 'button'
    b.addEventListener('click', (e) => fire(name, arg, e))
    return b
  }

  // --- Top: tower progress + boosts -------------------------------------------------------------
  const top = el('div', 'hud-top')
  const bar = el('div', 'hud-progress', '<div class="hp-fill"></div><div class="hp-shine"></div><div class="hp-text hud-txt">0 / 0</div>')
  const barFill = bar.querySelector('.hp-fill')
  const barText = bar.querySelector('.hp-text')
  const sub = el('div', 'hud-sub hud-txt', '')
  const boosts = el('div', 'hud-boosts')
  SHOP.boosts.forEach((b, i) => {
    const button = btn(`hud-boost ${b.color}`, `<span class="hb-amt hud-txt">+${commas(b.blocks)}</span><span class="hb-price">$${short(b.price)}</span>`, 'boost', i)
    button.title = `Add ${commas(b.blocks)} blocks to the tower for $${commas(b.price)}`
    boosts.append(button)
  })
  const alert = el('div', 'hud-alert hud-txt', '')
  alert.hidden = true
  const banner = el('div', 'hud-banner hud-txt', '')
  top.append(bar, sub, boosts, alert, banner)

  // --- Left: event + stats -------------------------------------------------------------------------
  const left = el('div', 'hud-left')
  const event = el('div', 'hud-event', `<div class="he-icon"></div><div class="he-body"><div class="he-label hud-txt">EVENT</div><div class="he-name hud-txt">—</div><div class="he-bar"><div></div></div></div><div class="he-next"><div class="he-nl hud-txt">NEXT EVENT</div><div class="he-time hud-txt">0:00</div></div>`)
  const evName = event.querySelector('.he-name')
  const evBar = event.querySelector('.he-bar > div')
  const evLabel = event.querySelector('.he-label')
  const evNext = event.querySelector('.he-nl')
  const evTime = event.querySelector('.he-time')
  const stat = (icon, cls) => {
    const r = el('div', `hud-stat ${cls}`, `<div class="hs-icon">${icon}</div><div class="hs-body"><div class="hs-val hud-txt">0</div><div class="hs-sub hud-txt"></div></div>`)
    return { root: r, val: r.querySelector('.hs-val'), sub: r.querySelector('.hs-sub') }
  }
  const sCash = stat(ICONS.cash, 'cash')
  const sSpeed = stat(ICONS.speed, 'speed')
  const sStr = stat(ICONS.strength, 'strength')
  const capBar = el('div', 'hs-cap', '<div></div>')
  sStr.root.querySelector('.hs-body').append(capBar)
  const capFill = capBar.firstChild
  const sBuild = stat(ICONS.tower, 'buildings')
  const sCrew = stat(ICONS.crew, 'crew')
  left.append(event, sCash.root, sSpeed.root, sStr.root, sBuild.root, sCrew.root)

  // --- Right: rank card + buttons ---------------------------------------------------------------------
  const right = el('div', 'hud-right')
  const rank = btn('hud-rank', `<div class="hr-diamond"><span class="hud-txt">1</span></div><div class="hr-body"><div class="hr-name hud-txt">LABORER</div><div class="hr-bar"><div></div><span class="hud-txt">0 / 100</span></div><div class="hr-next">Next: Hod Carrier</div></div>`, 'ranks')
  const rkNum = rank.querySelector('.hr-diamond span')
  const rkDia = rank.querySelector('.hr-diamond')
  const rkName = rank.querySelector('.hr-name')
  const rkFill = rank.querySelector('.hr-bar > div')
  const rkText = rank.querySelector('.hr-bar > span')
  const rkNext = rank.querySelector('.hr-next')
  const grid = el('div', 'hud-grid')
  const menu = (icon, text, name, cls = '', arg) => {
    const b = btn(`hud-btn ${cls}`, `<span class="hb-icon">${icon}</span><span class="hb-label hud-txt">${text}</span><span class="hb-badge" hidden></span>`, name, arg)
    grid.append(b)
    return b
  }
  menu(ICONS.pets, 'PETS', 'pets', 'pets')
  menu(ICONS.shop, 'SHOP', 'shop')
  menu(ICONS.upgrades, 'UPGRADES', 'upgrades')
  const bSpin = menu(ICONS.spin, 'SPIN', 'spin', 'spin')
  const spinBadge = bSpin.querySelector('.hb-badge')
  spinBadge.classList.add('count')
  const bSpeed = menu(ICONS.speed, '2x Speed', 'pass', 'pass', 'spd2')
  const bStr = menu(ICONS.strength, '2x Strength', 'pass', 'pass', 'str2')
  const bGift = menu(ICONS.gift, 'FREE', 'gift', 'gift')
  const bDaily = menu(ICONS.daily, 'DAILY', 'daily', 'daily')
  const small = el('div', 'hud-small')
  const bSound = btn('hud-mini', ICONS.sound, 'sound')
  bSound.title = 'Sound'
  const bNight = btn('hud-mini', ICONS.moon, 'daynight')
  bNight.title = 'Skip time of day (N)'
  small.append(bSound, bNight)
  right.append(rank, grid, small)

  // --- Bottom: status card, keys, gym lift button --------------------------------------------------------
  const status = el('div', 'hud-status', '<div class="st-tag">AUTO</div><div class="st-body"><div class="st-title"></div><div class="st-sub"></div></div>')
  const stTag = status.querySelector('.st-tag')
  const stTitle = status.querySelector('.st-title')
  const stSub = status.querySelector('.st-sub')
  status.hidden = true
  const keys = el('div', 'hud-keys', '<div><b>E</b> Use</div><div><b>Shift</b> Sprint</div><div><b>Click</b> Look</div>')
  const train = el('div', 'hud-train')
  const tapBtn = btn('hud-tap hud-txt', 'LIFT!', 'tap')
  const stopBtn = btn('hud-stop hud-txt', 'STOP', 'stop')
  train.append(tapBtn, stopBtn)
  train.hidden = true
  const ride = el('div', 'hud-ride', '<div class="rd-label hud-txt">GOING UP</div><div class="rd-bar"><div></div></div>')
  const rdLabel = ride.querySelector('.rd-label')
  const rdFill = ride.querySelector('.rd-bar > div')
  ride.hidden = true
  const pops = el('div', 'hud-pops')
  // A dark strip across the middle of the screen ("The building is complete! Go inside!").
  const notice = el('div', 'hud-notice', '<span class="hud-txt"></span>')
  const noticeText = notice.firstChild
  notice.hidden = true
  const toastEl = el('div', 'hud-toast hud-txt', '')
  root.append(top, left, right, status, keys, train, ride, notice, pops, toastEl)
  document.body.append(root)

  // Taps on the LIFT button use pointerdown so rapid taps are not eaten by the click delay.
  tapBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    fire('tap')
    restart(tapBtn, 'pulse')
  })

  // --- Reserved corner (Boxity toolbar + chat) ---------------------------------------------------------------
  function setReserved(areas) {
    const tb = areas.find((a) => a.id === 'toolbar')
    const chat = areas.find((a) => a.id === 'chat')
    const tbBottom = tb ? tb.top + tb.height : 0
    const chatBottom = chat ? chat.top + chat.height : tbBottom
    root.style.setProperty('--left-top', `${Math.round(Math.max(chatBottom, tbBottom) + 8)}px`)
    // The progress bar only moves down where the toolbar reaches the middle of the screen.
    const reaches = tb && tb.left + tb.width > window.innerWidth / 2 - 180
    root.style.setProperty('--top-top', `${reaches ? Math.round(tbBottom + 6) : 8}px`)
  }

  // --- Per-frame update with change tracking --------------------------------------------------------------------
  const last = {}
  const setText = (key, node, text) => {
    if (last[key] === text) return
    last[key] = text
    node.textContent = text
  }
  const setStyle = (key, node, prop, value) => {
    if (last[key] === value) return
    last[key] = value
    node.style[prop] = value
  }

  let bannerTimer = 0
  let alertShown = false
  let toastTimer = 0

  return {
    root,
    on(name, fn) {
      actions.set(name, fn)
    },
    setReserved,
    // s: { cash, speed, walk, strength, bag, cap, buildings, crew, crewCount, rankIdx, totalBlocks,
    //      tower: { placed, total, floor, floors, name, done }, event: { name, color, left, length } | null,
    //      nextEvent, passes, giftIn, dailyReady, eta, muted, spins }
    update(dt, s) {
      setText('cash', sCash.val, `$${short(s.cash)}`)
      setText('speed', sSpeed.val, short(s.speed))
      setText('walk', sSpeed.sub, `Walk Speed: ${Math.round(s.walk * 3.6)}`)
      setText('str', sStr.val, short(s.strength))
      setText('cap', sStr.sub, `Capacity: ${commas(s.bag)}/${commas(s.cap)}`)
      setStyle('capw', capFill, 'width', `${Math.round((s.bag / Math.max(1, s.cap)) * 100)}%`)
      capBar.classList.toggle('full', s.bag >= s.cap)
      setText('bld', sBuild.val, commas(s.buildings))
      setText('bldsub', sBuild.sub, 'Buildings finished')
      setText('crew', sCrew.val, `+${Math.round(s.crew * 100)}%`)
      setText('crewsub', sCrew.sub, s.crewCount ? `Crew: ${s.crewCount} (+10% each)` : 'Add crew: +10% each')
      // Tower.
      const t = s.tower
      // Open (finished) building: the bar counts down the time left to go inside.
      const inside = t.openLeft != null
      setText('bar', barText, inside ? `${INSIDE.mult}X INSIDE  ${clock(t.openLeft)}` : t.done ? 'BUILDING COMPLETE!' : `${commas(t.placed)} / ${commas(t.total)}`)
      setStyle('barw', barFill, 'width', inside ? '100%' : `${((t.placed / Math.max(1, t.total)) * 100).toFixed(2)}%`)
      bar.classList.toggle('inside', inside)
      setText('sub', sub, inside ? `${t.name}  ·  Complete` : `${t.name}  ·  Floor ${t.floor}/${t.floors}`)
      // Event.
      if (s.event) {
        setText('evl', evLabel, 'EVENT')
        setText('evn', evName, s.event.name)
        setStyle('evc', evName, 'color', s.event.color)
        setStyle('evb', evBar, 'width', `${Math.round((s.event.left / s.event.length) * 100)}%`)
        setStyle('evbc', evBar, 'background', s.event.color)
        setText('evnl', evNext, 'ENDS IN')
        setText('evt', evTime, clock(s.event.left))
      } else {
        setText('evl', evLabel, 'EVENT')
        setText('evn', evName, 'NONE')
        setStyle('evc', evName, 'color', '#c9ccd2')
        setStyle('evb', evBar, 'width', '0%')
        setText('evnl', evNext, 'NEXT EVENT')
        setText('evt', evTime, clock(s.nextEvent))
      }
      event.classList.toggle('live', !!s.event)
      // Rank.
      const r = RANKS[s.rankIdx]
      const nx = RANKS[s.rankIdx + 1]
      setText('rkn', rkNum, String(s.rankIdx + 1))
      setStyle('rkc', rkDia, 'background', r.color)
      setText('rkname', rkName, r.name.toUpperCase())
      if (nx) {
        const span = nx.at - r.at
        const into = s.totalBlocks - r.at
        setStyle('rkw', rkFill, 'width', `${Math.min(100, (into / span) * 100).toFixed(1)}%`)
        setText('rkt', rkText, `${short(s.totalBlocks)} / ${short(nx.at)}`)
        setText('rknx', rkNext, `Next: ${nx.name}${s.eta ? ` ~${s.eta}` : ''}`)
      } else {
        setStyle('rkw', rkFill, 'width', '100%')
        setText('rkt', rkText, 'MAX RANK')
        setText('rknx', rkNext, 'You reached the top!')
      }
      // Buttons.
      bSpeed.classList.toggle('owned', !!s.passes.spd2)
      bStr.classList.toggle('owned', !!s.passes.str2)
      const giftReady = s.giftIn <= 0
      setText('gift', bGift.querySelector('.hb-label'), giftReady ? 'FREE' : clock(s.giftIn))
      bGift.classList.toggle('ready', giftReady)
      bDaily.querySelector('.hb-badge').hidden = !s.dailyReady
      bGift.querySelector('.hb-badge').hidden = !giftReady
      spinBadge.hidden = !s.spins
      setText('spins', spinBadge, s.spins > 99 ? '99+' : String(s.spins ?? 0))
      if (last.muted !== s.muted) {
        last.muted = s.muted
        bSound.innerHTML = s.muted ? ICONS.mute : ICONS.sound
      }
      // Timers.
      if (bannerTimer > 0) {
        bannerTimer -= dt
        if (bannerTimer <= 0) banner.classList.remove('show')
      }
      if (toastTimer > 0) {
        toastTimer -= dt
        if (toastTimer <= 0) toastEl.classList.remove('show')
      }
    },
    // The bottom card. kind: 'collect' | 'full' | 'build' | 'train' | null
    status(tag, title, subText) {
      if (!title) {
        status.hidden = true
        last.status = ''
        return
      }
      const key = `${tag}|${title}|${subText}`
      if (last.status === key) return
      last.status = key
      status.hidden = false
      stTag.textContent = tag
      stTag.hidden = !tag
      stTitle.textContent = title
      stSub.textContent = subText
      restart(status, 'pop-in')
    },
    // Red warning under the bar ("Get closer to the build!").
    alert(text) {
      const show = !!text
      if (show) setText('alert', alert, text)
      if (show !== alertShown) {
        alertShown = show
        alert.hidden = !show
      }
    },
    banner(text, color = '#ffd23a', seconds = 2.6) {
      banner.textContent = text
      banner.style.color = color
      banner.classList.remove('show')
      void banner.offsetWidth
      banner.classList.add('show')
      bannerTimer = seconds
    },
    toast(text, good = true) {
      toastEl.textContent = text
      toastEl.classList.toggle('bad', !good)
      toastEl.classList.remove('show')
      void toastEl.offsetWidth
      toastEl.classList.add('show')
      toastTimer = 2.2
    },
    // A number floating up from a screen point.
    pop(x, y, text, color = '#ffffff', big = false) {
      const p = el('div', `hud-pop hud-txt${big ? ' big' : ''}`, '')
      p.textContent = text
      p.style.color = color
      p.style.left = `${x}px`
      p.style.top = `${y}px`
      p.addEventListener('animationend', () => p.remove())
      pops.append(p)
      if (pops.childElementCount > 24) pops.firstChild.remove()
    },
    // A stat reward: the stat's icon and "+N", floating up from (x, y).
    statPop(x, y, kind, text) {
      const p = el('div', 'hud-pop hud-stat-pop', `<span class="hsp-icon">${kind === 'speed' ? ICONS.speed : ICONS.strength}</span><span class="hud-txt">${text}</span>`)
      p.style.left = `${x}px`
      p.style.top = `${y}px`
      p.addEventListener('animationend', () => p.remove())
      pops.append(p)
      if (pops.childElementCount > 24) pops.firstChild.remove()
    },
    notice(text) {
      notice.hidden = !text
      if (text) setText('notice', noticeText, text)
    },
    training(on, label = 'LIFT!') {
      train.hidden = !on
      tapBtn.textContent = label
      root.classList.toggle('training', on)
    },
    ride(info) {
      const on = !!info && (info.riding || info.boarding > 0)
      ride.hidden = !on
      if (!on) return
      setText('rdl', rdLabel, info.riding ? (info.dir === 'up' ? 'GOING UP' : 'GOING DOWN') : 'DOORS CLOSING...')
      setStyle('rdw', rdFill, 'width', `${Math.round((info.riding ? info.progress : info.boarding) * 100)}%`)
    },
    shake(name) {
      const node = name === 'cash' ? sCash.root : name === 'boost' ? boosts : null
      if (node) replay(node, 'shake')
    },
    bump(name) {
      const node = { cash: sCash.val, strength: sStr.val, speed: sSpeed.val, buildings: sBuild.val, rank: rkDia }[name]
      if (node) restart(node, 'pulse')
    },
  }
}
