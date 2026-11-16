import './rewardsUi.css'
import { REWARDS, ROBOT_GEAR } from './config.js'
import { ICONS } from './hudIcons.js'
import { burst, centre } from './juice.js'
import { createWindow, replay } from './uiWindow.js'
import { sfx } from './audio/index.js'
import { rewardSvg } from './rewardArt.js'
import { anyReady, claim, onRewardsChange, status } from './rewards.js'
import * as S from './stats.js'

// The two reward windows (dark frames, like the reference):
//  - Daily & Playtime Rewards: DAILY strip (Day 1-7, Day 7 double width) and PLAYTIME strip (8 tiers),
//    each scrolled with the yellow < > arrows. Cards: CLAIM! (green), LOCKED (red), CLAIMED, and a
//    countdown on playtime cards still running.
//  - Free Reward: the 1.5X Cash card, three steps to tick, CLAIM once they are all done.
// rewards.js decides what may be claimed (the server for signed-in players), stats.grantReward grants it.

const { state } = S

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}
export const gearName = (id) => ROBOT_GEAR.find((g) => g.id === id)?.name ?? id
export const STAT = { cash: 'CASH', strength: 'STRENGTH', speed: 'SPEED' }
export const multText = (m) => `${m}X`
// The big label under the art (shared with the Invite Friends window, invite.js).
export function rewardLabel(def) {
  if (def.kind === 'cash') return `+$${S.commas(S.rewardCash(def))}`
  if (def.kind === 'boost') return `+${multText(def.mult)} ${STAT[def.stat]}`
  if (def.kind === 'gear') return gearName(def.gear).toUpperCase()
  if (def.kind === 'egg') return `${def.egg.toUpperCase()} EGG`
  if (def.kind === 'upgrade') return `+${def.levels ?? 1} ${def.id === 'all' ? 'ALL UPGRADES' : (S.upgradeDef(def.id)?.name ?? def.id).toUpperCase()}`
  return ''
}
// The tilted time badge on boosts ("15 MIN", "3 HOURS").
export const timeBadge = (min) => (min >= 60 ? `${min / 60} HOUR${min === 60 ? '' : 'S'}` : `${min} MIN`)
// Countdowns: "4:05", "1:02:03".
function hms(s) {
  s = Math.max(0, Math.ceil(s))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
const playTitle = (t) => (t.at >= 60 ? `${t.at / 60} HOUR` : `${t.at} MIN`)
const FAIL = {
  claimed: 'Already claimed!',
  early: 'Not ready yet - keep playing!',
  busy: 'Claiming...',
  offline: 'Reconnecting to the server - try again in a moment.',
  timeout: 'The server did not answer - try again.',
  save: 'Could not save your claim - try again.',
}

// One reward card. `inside` puts the button in the card (daily), else under it (playtime).
function makeCard(def, title, inside) {
  const cell = el('div', `rw-cell${def.wide ? ' wide' : ''}${inside ? ' daily' : ' play'}`)
  const card = el('div', `rw-card c-${def.color}`)
  const badge = def.kind === 'boost' ? `<span class="rw-time uiw-text">${timeBadge(def.time)}</span>` : ''
  card.innerHTML = `<div class="rw-rays"></div><div class="rw-title uiw-text">${title}</div><div class="rw-art">${rewardSvg(def)}${badge}</div><div class="rw-name uiw-text k-${def.kind}${rewardLabel(def).length > 12 && !def.wide ? ' long' : ''}">${rewardLabel(def)}</div>`
  const btn = el('button', 'rw-btn uiw-text')
  btn.type = 'button'
  if (inside) card.append(btn)
  cell.append(card)
  if (!inside) cell.append(btn)
  // The whole card is a tap target for its button (thumbs on small screens).
  card.addEventListener('click', (e) => {
    if (e.target !== btn && !btn.contains(e.target)) btn.click()
  })
  return { cell, card, btn }
}

// A horizontal strip of cards with the < > arrows (one card per press).
function makeStrip(cls) {
  const row = el('div', `rw-row ${cls}`)
  const prev = el('button', 'rw-arrow prev', '<svg viewBox="0 0 40 40"><path d="M25 8 L12 20 L25 32" /></svg>')
  const next = el('button', 'rw-arrow next', '<svg viewBox="0 0 40 40"><path d="M15 8 L28 20 L15 32" /></svg>')
  prev.type = next.type = 'button'
  prev.setAttribute('aria-label', 'Back')
  next.setAttribute('aria-label', 'More')
  const strip = el('div', 'rw-strip')
  row.append(prev, strip, next)
  // Where each card starts in the strip's scroll space.
  const offsets = () => {
    const first = strip.children[0]?.offsetLeft ?? 0
    return [...strip.children].map((c) => c.offsetLeft - first)
  }
  const maxScroll = () => Math.max(0, strip.scrollWidth - strip.clientWidth)
  const arrows = () => {
    prev.classList.toggle('off', strip.scrollLeft <= 2)
    next.classList.toggle('off', strip.scrollLeft >= maxScroll() - 2)
  }
  // One card per press, counted from where the last press is heading (quick presses never drop one).
  let want = null
  let wantT = 0
  const go = (dir) => {
    const offs = offsets()
    const max = maxScroll()
    const cur = want ?? strip.scrollLeft
    let i = 0
    while (i + 1 < offs.length && offs[i + 1] <= cur + 4) i++
    // Back from part-way into a card (the end of the strip): to that card if it is mostly hidden, else one more.
    const half = ((offs[1] ?? 200) - (offs[0] ?? 0)) / 2
    const target = dir > 0 ? (cur >= max - 2 ? max : Math.min(max, offs[Math.min(offs.length - 1, i + 1)])) : cur - offs[i] > half ? offs[i] : offs[Math.max(0, i - 1)]
    if (Math.abs(target - cur) < 1) return
    sfx.pageFlip(dir)
    want = target
    clearTimeout(wantT)
    wantT = setTimeout(() => (want = null), 600)
    strip.scrollTo({ left: target, behavior: 'smooth' })
  }
  prev.addEventListener('click', () => go(-1))
  next.addEventListener('click', () => go(1))
  strip.addEventListener('scroll', arrows, { passive: true })
  strip.addEventListener('scrollend', arrows, { passive: true })
  return {
    row,
    strip,
    arrows,
    // Scroll (instantly) so card i is in view, as far left as it goes.
    show(i) {
      const c = strip.children[i]
      if (!c) return
      strip.scrollLeft = Math.min(offsets()[i], maxScroll())
      arrows()
    },
  }
}

export function createRewardsUi({ say, pets }) {
  const busy = new Set() // claims in flight ('daily', 'play3', 'free')

  // Shared claim flow: ask rewards.js, grant on ok, celebrate.
  async function doClaim(kind, idx, btn, card) {
    const key = kind === 'play' ? `play${idx}` : kind
    if (busy.has(key)) return
    busy.add(key)
    btn.disabled = true
    btn.textContent = '...'
    const res = await claim(kind, idx)
    busy.delete(key)
    btn.disabled = false
    if (!res.ok) {
      replay(btn, 'shake')
      say(FAIL[res.reason] ?? 'Something went wrong - try again.', false)
      syncAll()
      return
    }
    const def = kind === 'daily' ? REWARDS.daily[res.day ?? idx] : kind === 'play' ? REWARDS.play[res.tier ?? idx] : REWARDS.free
    const got = S.grantReward(def)
    const big = kind === 'free' || (kind === 'daily' && def.wide)
    if (got.kind === 'egg') {
      sfx.rewardClaim('egg', big)
      win.close()
      free.close()
      pets.freeHatch(got.egg)
    } else {
      sfx.rewardClaim(got.kind === 'gear' && got.dupe ? 'cash' : got.kind, big)
      replay(card, 'bump')
      burst(...centre(card), 'big')
    }
    if (got.kind === 'cash') say(`+$${S.commas(got.cash)} cash!`, true)
    else if (got.kind === 'boost') say(`${multText(got.mult)} ${STAT[got.stat].toLowerCase()} for ${timeBadge(got.time).toLowerCase()}!`, true)
    else if (got.kind === 'gear') say(got.dupe ? `You already own ${gearName(got.gear)}: +$${S.short(got.cash)} instead!` : `${gearName(got.gear)} unlocked! Wear it at the Robot Gear hall.`, true)
    syncAll()
  }

  // --- Daily & Playtime window ---------------------------------------------------------------------------
  const win = createWindow({ title: 'Daily & Playtime Rewards', icon: ICONS.daily, className: 'w-rewards uiw-dark', onOpen: () => build() })
  const dailyCards = []
  const playCards = []
  let dailyMsg, playMsg, playBang, dStrip, pStrip
  function section(label) {
    const head = el('div', 'rw-head', `<div class="rw-label uiw-text">${label}</div><span class="rw-bang" hidden>!</span><div class="rw-line"></div><div class="rw-msg uiw-text"></div>`)
    return { head, msg: head.querySelector('.rw-msg'), bang: head.querySelector('.rw-bang') }
  }
  function build() {
    const b = win.body
    b.innerHTML = ''
    dailyCards.length = 0
    playCards.length = 0
    const d = section('DAILY')
    dailyMsg = d.msg
    dStrip = makeStrip('daily')
    REWARDS.daily.forEach((def, i) => {
      const c = makeCard(def, `DAY ${i + 1}`, true)
      c.btn.addEventListener('click', () => tapDaily(i, c))
      dStrip.strip.append(c.cell)
      dailyCards.push(c)
    })
    const p = section('PLAYTIME')
    playMsg = p.msg
    playBang = p.bang
    pStrip = makeStrip('play')
    REWARDS.play.forEach((def, i) => {
      const c = makeCard(def, playTitle(def), false)
      c.btn.addEventListener('click', () => tapPlay(i, c))
      pStrip.strip.append(c.cell)
      playCards.push(c)
    })
    b.append(d.head, dStrip.row, p.head, pStrip.row)
    sync()
    // Cards cascade in.
    ;[...dailyCards, ...playCards].forEach((c, i) => {
      c.cell.style.setProperty('--ji', i % 8)
      c.cell.classList.remove('juice-in')
      void c.cell.offsetWidth
      c.cell.classList.add('juice-in')
      c.cell.addEventListener('animationend', () => c.cell.classList.remove('juice-in'), { once: true })
    })
    // Land on today's day and the first playtime reward that is ready (else the next one).
    requestAnimationFrame(() => {
      const st = status()
      dStrip.show(Math.max(0, st.daily.weekDone ? 0 : st.daily.day - 1))
      const first = st.play.ready[0] ?? (st.play.nextTier >= 0 ? st.play.nextTier : 0)
      pStrip.show(Math.max(0, Math.min(first, REWARDS.play.length - 4)))
    })
  }
  function tapDaily(i, c) {
    const st = status()
    if (st.daily.canClaim && i === st.daily.day) return doClaim('daily', i, c.btn, c.card)
    if (isDailyClaimed(st, i)) {
      sfx.deny()
      say(`Day ${i + 1} is already claimed!`, true)
      return
    }
    sfx.lockedTap()
    replay(c.btn, 'shake')
    say(st.daily.canClaim ? `Claim Day ${st.daily.day + 1} first - one reward a day!` : `Come back tomorrow for Day ${i + 1 > st.daily.day + 1 ? st.daily.day + 1 : i + 1}!`, false)
  }
  function tapPlay(i, c) {
    const st = status()
    if (st.play.claimed.includes(i)) {
      sfx.deny()
      say('Already claimed today! New playtime rewards tomorrow.', true)
      return
    }
    if (!st.play.ready.includes(i)) {
      sfx.lockedTap()
      replay(c.btn, 'shake')
      say(`Play ${hms(REWARDS.play[i].at * 60 - st.play.sec)} more to unlock it!`, false)
      return
    }
    doClaim('play', i, c.btn, c.card)
  }
  const isDailyClaimed = (st, i) => st.daily.weekDone || i < st.daily.day
  const setBtn = (btn, cls, text) => {
    if (btn.dataset.s !== cls) {
      btn.dataset.s = cls
      btn.className = `rw-btn uiw-text ${cls}`
    }
    if (btn.textContent !== text && !btn.disabled) btn.textContent = text
  }
  function sync() {
    if (!win.isOpen() || !dailyCards.length) return
    const st = status()
    dailyCards.forEach((c, i) => {
      const claimed = isDailyClaimed(st, i)
      const today = st.daily.canClaim && i === st.daily.day
      setBtn(c.btn, claimed ? 'done' : today ? 'go' : 'locked', claimed ? 'CLAIMED' : today ? 'CLAIM!' : 'LOCKED')
      c.cell.classList.toggle('claimed', claimed)
      c.cell.classList.toggle('today', today)
    })
    const dm = st.daily.canClaim ? `Claim Day ${st.daily.day + 1}! Come back every day - missing a day restarts your streak.` : `Day ${st.daily.weekDone ? REWARDS.daily.length : st.daily.day} claimed! Next reward in ${hms(st.daily.nextIn)}.`
    if (dailyMsg.textContent !== dm) dailyMsg.textContent = dm
    playCards.forEach((c, i) => {
      const claimed = st.play.claimed.includes(i)
      const ready = st.play.ready.includes(i)
      setBtn(c.btn, claimed ? 'done' : ready ? 'go' : 'wait', claimed ? 'CLAIMED' : ready ? 'CLAIM!' : hms(REWARDS.play[i].at * 60 - st.play.sec))
      c.cell.classList.toggle('claimed', claimed)
      c.cell.classList.toggle('today', ready)
    })
    const pm = st.play.ready.length ? 'Your playtime reward is ready - claim it!' : st.play.nextIn != null ? `Next playtime reward in ${hms(st.play.nextIn)}` : 'All playtime rewards claimed - new ones tomorrow!'
    if (playMsg.textContent !== pm) playMsg.textContent = pm
    playBang.hidden = !st.play.ready.length
    dStrip.arrows()
    pStrip.arrows()
  }

  // --- Free Reward window ----------------------------------------------------------------------------------
  const free = createWindow({ title: 'Free Reward', icon: ICONS.gift, className: 'w-free uiw-dark', onOpen: () => buildFree() })
  let freeBtn, freeHint, freeCard
  const STEP_ICONS = ['', '<svg viewBox="0 0 24 24" class="fr-ico"><path d="M12 2 L15 9 L22 9.5 L16.5 14 L18.5 21.5 L12 17.3 L5.5 21.5 L7.5 14 L2 9.5 L9 9 Z" fill="#ffc21a" stroke="#8a5a00" stroke-width="1.2" stroke-linejoin="round"/></svg>', '<svg viewBox="0 0 24 24" class="fr-ico"><path d="M12 21 C5 15 2 12 2 8 C2 5 4.5 3 7 3 C9 3 11 4.5 12 6 C13 4.5 15 3 17 3 C19.5 3 22 5 22 8 C22 12 19 15 12 21 Z" fill="#ff2f4f" stroke="#7a0016" stroke-width="1.2"/></svg>']
  const stepDone = (i) => !!(state.freeSteps & (1 << i))
  const allSteps = () => REWARDS.freeSteps.every((_, i) => stepDone(i))
  function buildFree() {
    const b = free.body
    b.innerHTML = ''
    const def = REWARDS.free
    freeCard = el('div', `fr-card c-${def.color}`, `<div class="rw-rays"></div><div class="fr-art">${rewardSvg(def)}</div><div class="fr-name uiw-text">${multText(def.mult)} ${STAT[def.stat]} (${timeBadge(def.time)})</div>`)
    const steps = el('div', 'fr-steps')
    REWARDS.freeSteps.forEach((text, i) => {
      const row = el('button', `fr-step${stepDone(i) ? ' done' : ''}`, `<span class="fr-num">${stepDone(i) ? ICONS.check : i + 1}</span><span class="fr-text">${text}</span>${STEP_ICONS[i]}`)
      row.type = 'button'
      row.addEventListener('click', () => {
        if (state.rewards.free && status().free) return
        if (stepDone(i)) return sfx.tick()
        state.freeSteps |= 1 << i
        row.classList.add('done')
        row.querySelector('.fr-num').innerHTML = ICONS.check
        replay(row, 'bump')
        sfx.stepCheck(i)
        syncFree()
      })
      steps.append(row)
    })
    freeHint = el('div', 'fr-hint uiw-text')
    freeBtn = el('button', 'fr-claim uiw-text')
    freeBtn.type = 'button'
    freeBtn.addEventListener('click', () => {
      if (status().free) return sfx.deny()
      if (!allSteps()) {
        sfx.lockedTap()
        replay(freeBtn, 'shake')
        say('Complete all 3 steps first!', false)
        return
      }
      doClaim('free', 0, freeBtn, freeCard)
    })
    b.append(freeCard, steps, freeHint, freeBtn)
    syncFree()
  }
  function syncFree() {
    if (!free.isOpen() || !freeBtn) return
    const done = status().free
    const ready = allSteps()
    const text = done ? 'CLAIMED' : 'CLAIM'
    if (!freeBtn.disabled && freeBtn.textContent !== text) freeBtn.textContent = text
    freeBtn.classList.toggle('done', done)
    freeBtn.classList.toggle('wait', !done && !ready)
    const hint = done ? 'Thanks for supporting the game!' : ready ? 'All done - claim your reward!' : 'Complete these to claim!'
    if (freeHint.textContent !== hint) freeHint.textContent = hint
  }

  function syncAll() {
    sync()
    syncFree()
  }
  onRewardsChange(syncAll)

  // Timed boosts: a sound and a note when one runs out.
  S.on('timed', (e) => {
    if (!e?.ended) return
    sfx.boostEnd()
    say(`Your ${multText(e.mult)} ${STAT[e.stat].toLowerCase()} boost ended.`, true)
  })

  let t = 0
  return {
    win,
    free,
    open: () => win.open(),
    openFree: () => free.open(),
    // Countdowns tick while a window is open.
    update(dt) {
      t -= dt
      if (t > 0) return
      t = 0.25
      if (win.isOpen() || free.isOpen()) syncAll()
    },
    anyReady: () => anyReady(),
    freeReady: () => !status().free,
  }
}
