import './offlineUi.css'
import { ICONS } from './hudIcons.js'
import { burst, centre, flash } from './juice.js'
import { createWindow, replay } from './uiWindow.js'
import { sfx } from './audio/index.js'
import { claim, onLatePaid, onOfflineChange, pendingSecs, preview } from './offline.js'
import * as S from './stats.js'

// "While You Were Away...": the purple popup shown once on entering the game when you were gone for a while
// (like the reference). Strength and Speed earned by the time away, what they do to your capacity and walk
// speed, and a green CLAIM. It is modal (Esc / a tap outside do not close it): only a claim closes it.
// offline.js decides what is waiting (the server for signed-in players) and what it pays.

const el = (tag, cls, html = '') => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}
// "24h 0m", "3h 5m", "42m".
export function awayText(secs) {
  const m = Math.floor(secs / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.max(1, m)}m`
}
const one = (n) => String(Math.round(n * 10) / 10) // 45.7, 36
const FAIL = {
  busy: 'Claiming...',
  offline: 'Reconnecting to the server - try again in a moment.',
  timeout: 'The server did not answer - try again.',
  save: 'Could not save your claim - try again.',
}

export function createOfflineUi({ say }) {
  const win = createWindow({ title: 'While You Were Away', className: 'w-away', onOpen: build })
  win.lock() // only CLAIM closes it
  let btn
  let busy = false
  let armed = false // the loading screen is gone: popups may show

  function card(kind, label, gain, from, to, what) {
    const c = el('div', `away-card away-${kind}`)
    c.innerHTML = `<div class="away-icon">${ICONS[kind]}</div>
      <div class="away-gain uiw-text">+${S.commas(gain)}</div>
      <div class="away-label uiw-text">${label}</div>
      <div class="away-sub uiw-text">${what} ${from}<span class="away-arrow">→</span>${to}</div>`
    return c
  }

  function build() {
    const b = win.body
    b.innerHTML = ''
    const p = preview(pendingSecs())
    const title = el('div', 'away-title uiw-text', 'While You Were Away...')
    const sub = el('div', 'away-time uiw-text', `You trained for ${awayText(p.secs)}`)
    const row = el('div', 'away-row')
    row.append(card('strength', 'STRENGTH', p.strength, S.commas(p.capBefore), S.commas(p.capAfter), 'Capacity'), card('speed', 'SPEED', p.speed, one(p.walkBefore), one(p.walkAfter), 'Walk Speed'))
    btn = el('button', 'away-claim uiw-btn uiw-text green', 'CLAIM')
    btn.type = 'button'
    btn.addEventListener('click', onClaim)
    b.append(title, sub, row, btn)
  }

  async function onClaim() {
    if (busy) return
    busy = true
    btn.disabled = true
    btn.textContent = '...'
    const res = await claim()
    busy = false
    btn.disabled = false
    btn.textContent = 'CLAIM'
    if (!res.ok) {
      if (res.reason === 'claimed' || res.reason === 'none') return win.close(true) // already paid (another tab / pod)
      replay(btn, 'shake')
      say(FAIL[res.reason] ?? 'Something went wrong - try again.', false)
      return
    }
    sfx.rewardClaim('boost', true)
    burst(...centre(btn), 'big')
    flash('gold')
    say(`+${S.commas(res.strength)} Strength, +${S.commas(res.speed)} Speed!`, true)
    win.close(true)
  }

  // Shows the popup when something is waiting (and nothing is on screen yet).
  function maybeShow() {
    if (!armed || win.isOpen() || !pendingSecs()) return
    win.open()
  }
  onOfflineChange(maybeShow)
  onLatePaid((r) => say(`+${S.commas(r.strength)} Strength, +${S.commas(r.speed)} Speed from your time away!`, true))

  return {
    win,
    // Call once the loading screen is gone: shows the popup if you earned something while away.
    arm() {
      armed = true
      maybeShow()
    },
  }
}
