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
  // Running timed boosts (reward prizes): icon, multiplier, time left.
  const timed = el('div', 'hud-timed')
  // Goal card (goals.js): the personal goal in progress, its bar, its reward and the next chest.
  const goal = el('div', 'hud-goal', `<div class="hg-head"><span class="hg-title hud-txt">GOAL</span><span class="hg-tag hud-txt"></span></div><div class="hg-text hud-txt"></div><div class="hg-bar"><div></div><span class="hud-txt"></span></div><div class="hg-foot"><span class="hg-reward hud-txt"></span><span class="hg-chest hud-txt"></span></div>`)
  goal.hidden = true
  const gTag = goal.querySelector('.hg-tag')
  const gText = goal.querySelector('.hg-text')
  const gFill = goal.querySelector('.hg-bar > div')
  const gNum = goal.querySelector('.hg-bar > span')
  const gReward = goal.querySelector('.hg-reward')
  const gChest = goal.querySelector('.hg-chest')
  left.append(event, sCash.root, sSpeed.root, sStr.root, sBuild.root, goal, timed)
  const TIMED_ICON = { cash: ICONS.cash, strength: ICONS.strength, speed: ICONS.speed }
  let timedKey = ''
  function drawTimed(list = []) {
    // Whole seconds only, so the DOM changes at most once a second.
    const key = list.map((b) => `${b.stat}${b.mult}${b.active ? 'a' : 'w'}:${Math.ceil(b.left)}`).join('|')
    if (key === timedKey) return
    const same = list.length && timedKey.split('|').length === list.length && timedKey.split('|').every((k, i) => k.split(':')[0] === `${list[i].stat}${list[i].mult}${list[i].active ? 'a' : 'w'}`)
    timedKey = key
    if (!same) {
      // A boost waiting behind a bigger one of the same stat is dimmed (its time does not run yet).
      timed.innerHTML = list.map((b) => `<div class="ht-chip ${b.stat}${b.active ? '' : ' wait'}"><span class="ht-ico">${TIMED_ICON[b.stat] ?? ICONS.cash}</span><b class="hud-txt">x${b.mult}</b><span class="ht-t hud-txt"></span></div>`).join('')
    }
    list.forEach((b, i) => {
      const t = timed.children[i]?.querySelector('.ht-t')
      if (t) t.textContent = clock(b.left)
    })
  }

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
  // Phones: the menu buttons fold away behind one toggle (hud.css hides it on big screens, where the
  // grid is always visible). Picking a button closes the menu again.
  const bMore = el('button', 'hud-more', `<span class="hb-icon">${ICONS.menu}</span><span class="hb-label hud-txt">MENU</span><span class="hb-badge" hidden></span>`)
  const moreBadge = bMore.querySelector('.hb-badge')
  bMore.type = 'button'
  bMore.setAttribute('aria-expanded', 'false')
  bMore.setAttribute('aria-label', 'Show menu buttons')
  const setMenuOpen = (open) => {
    right.classList.toggle('menu-open', open)
    bMore.setAttribute('aria-expanded', String(open))
    bMore.querySelector('.hb-icon').innerHTML = open ? ICONS.close : ICONS.menu
    bMore.querySelector('.hb-label').textContent = open ? 'CLOSE' : 'MENU'
  }
  bMore.addEventListener('click', () => setMenuOpen(!right.classList.contains('menu-open')))
  grid.addEventListener('click', (e) => {
    if (e.target.closest('.hud-btn')) setMenuOpen(false)
  })
  right.append(rank, bMore, grid, small)

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
  const recentPops = [] // { x, y, h, t } of pops spawned in the last ~0.5 s (pop() spaces new ones out)
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
    // s: { cash, speed, walk, strength, bag, cap, buildings, rankIdx, totalBlocks,
    //      tower: { placed, total, floor, floors, name, done }, event: { name, color, left, length } | null,
    //      nextEvent, passes, freeReady, dailyReady, timed: [{ stat, mult, left }], eta, muted, spins, combo, comboMax }
    update(dt, s) {
      setText('cash', sCash.val, `$${short(s.cash)}`)
      // Coin Combo: shown under the cash while it is active.
      setText('combo', sCash.sub, s.combo > 1.005 ? `Combo x${s.combo.toFixed(2)}${s.combo >= s.comboMax - 0.005 ? ' MAX' : ''}` : '')
      setText('speed', sSpeed.val, short(s.speed))
      setText('walk', sSpeed.sub, `Walk Speed: ${Math.round(s.walk * 3.6)}`)
      setText('str', sStr.val, short(s.strength))
      setText('cap', sStr.sub, `Capacity: ${commas(s.bag)}/${commas(s.cap)}`)
      setStyle('capw', capFill, 'width', `${Math.round((s.bag / Math.max(1, s.cap)) * 100)}%`)
      capBar.classList.toggle('full', s.bag >= s.cap)
      setText('bld', sBuild.val, commas(s.buildings))
      setText('bldsub', sBuild.sub, 'Buildings finished')
      // Tower.
      const t = s.tower
      // Open (finished) building: the bar counts down the time left to go inside.
      const inside = t.openLeft != null
      // Sinking: the Next Building reel is picking the next one.
      // The bar is the FLOOR in progress (floors are sized to the builders' bags, so one bag of yours moves it
      // a lot): "FLOOR 3: 84 / 120"; the sub line says how much of the building is up.
      setText('bar', barText, inside ? `${INSIDE.mult}X INSIDE  ${clock(t.openLeft)}` : t.next ? 'NEXT BUILDING...' : t.done ? 'BUILDING COMPLETE!' : `FLOOR ${t.floor}:  ${commas(t.floorBlocks)} / ${commas(t.floorNeed)}`)
      setStyle('barw', barFill, 'width', inside || t.done ? '100%' : `${(Math.min(1, t.floorBlocks / Math.max(1, t.floorNeed)) * 100).toFixed(1)}%`)
      bar.classList.toggle('inside', inside)
      const bp = Math.floor((t.frac ?? 0) * 100)
      setText('sub', sub, inside ? `${t.name}  ·  Complete` : t.done ? `${t.name}  ·  ${t.floors} floors` : `${t.name}  ·  Floor ${t.floor}/${t.floors}  ·  ${bp}% built`)
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
      // FREE: the Free Reward (glows until it is claimed). DAILY: a daily or playtime reward waits.
      bGift.classList.toggle('ready', !!s.freeReady)
      bDaily.querySelector('.hb-badge').hidden = !s.dailyReady
      bGift.querySelector('.hb-badge').hidden = true
      drawTimed(s.timed)
      // Goal card.
      const gv = s.goal
      goal.hidden = !gv
      if (gv) {
        setText('gtext', gText, gv.text)
        setStyle('gfill', gFill, 'width', `${(gv.frac * 100).toFixed(1)}%`)
        setText('gnum', gNum, `${short(gv.have)} / ${short(gv.need)}`)
        setText('gtag', gTag, gv.tag)
        goal.classList.toggle('bonus', gv.bonus)
        goal.classList.toggle('welcome', gv.tag.startsWith('WELCOME'))
        setText('grew', gReward, '+$' + short(gv.reward))
        setText('gchest', gChest, gv.bonus ? `NEW GOALS IN ${clock(gv.resetIn)}` : gv.chest === 1 ? 'CHEST NEXT!' : `CHEST IN ${gv.chest}`)
      }
      // The MENU toggle shows a "!" while a folded-away button has something waiting.
      moreBadge.hidden = right.classList.contains('menu-open') || !(s.freeReady || s.dailyReady || s.spins)
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
      // Keep pops that spawn close together from drawing on top of each other: a new pop that lands
      // on one shown in the last ~0.5 s moves up a line (pops float up, so the lines stay apart).
      const now = performance.now()
      const lh = big ? Math.max(26, window.innerWidth * 0.028) : Math.max(19, window.innerWidth * 0.019)
      while (recentPops.length && now - recentPops[0].t > 520) recentPops.shift()
      for (let i = 0; i < 6; i++) {
        const hit = recentPops.find((r) => Math.abs(r.y - y) < (r.h + lh) * 0.5 && Math.abs(r.x - x) < 160)
        if (!hit) break
        y = hit.y - (hit.h + lh) * 0.5
      }
      recentPops.push({ x, y, h: lh, t: now })
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
    // A goal was just finished: the card pops.
    goalDone() {
      restart(goal, 'done')
    },
    bump(name) {
      const node = { cash: sCash.val, strength: sStr.val, speed: sSpeed.val, buildings: sBuild.val, rank: rkDia }[name]
      if (node) restart(node, 'pulse')
    },
  }
}
