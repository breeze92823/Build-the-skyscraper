import './invite.css'
import { INVITE } from './config.js'
import { ICONS } from './hudIcons.js'
import { burst, centre } from './juice.js'
import { createWindow, replay, uiButton } from './uiWindow.js'
import { sfx } from './audio/index.js'
import { rewardSvg } from './rewardArt.js'
import { gearName, multText, rewardLabel, STAT, timeBadge } from './rewardsUi.js'
import { canInvite, getFriends, inviteFriend, inviteLink } from './bloxity.js'
import { claimInvite, hasServer, isGuest, myAccountId, net, onInviteChange, onInviteEvent, refreshInvite, saveNow, sentInvite } from './net.js'
import * as S from './stats.js'

// The Invite Friends window (the plaza's Invite Friends kiosk). Boxity draws its own invite / friends
// buttons, so this is the game's side: the invite link (?ref=<your account id>), the Boxity friends list
// (direct invites, when the SDK exists) and the rewards. The server (backend src/invite.ts) decides who
// counts: a friend counts once they ACTUALLY PLAY (INVITE.need: minutes played and blocks placed), each
// account once. A reward is only granted after the server answers a claim ok (net.claimInvite), then
// stats.grantRewards pays it (cash / boosts / free upgrade levels / gear / an egg hatch).

const FAIL = {
  guest: 'Sign in to Bloxity to get invite rewards!',
  offline: 'Not connected to the server yet - try again in a moment.',
  busy: 'One moment...',
  timeout: 'The server did not answer - try again.',
  loading: 'Still loading - try again in a moment.',
  locked: 'Invite more friends to unlock this!',
  save: 'Could not save your claim - try again.',
}
const STATUS = { online: 'Online', 'in-game': 'In a game', away: 'Away', offline: 'Offline' }
const ORDER = { 'in-game': 0, online: 1, away: 2, offline: 3 }
const prizesOf = (p) => (Array.isArray(p) ? p : [p])

function el(tag, cls, html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : /[A-Z]$/.test(word) ? 'S' : 's'}`

// One prize as text ("+$5,000", "+2X CASH - 15 MIN", "+2 BLOCK GRAB").
function prizeText(def) {
  const base = rewardLabel(def)
  return def.kind === 'boost' ? `${base} - ${timeBadge(def.time)}` : base
}
// The art for a prize or a list of prizes: up to two icons side by side.
const prizeArt = (prize) => prizesOf(prize).slice(0, 2).map((p) => `<span class="inv-art">${rewardSvg(p)}</span>`).join('')

// What the player is told after a claim, one line per granted prize.
function grantedLine(got) {
  if (got.kind === 'cash') return `+$${S.commas(got.cash)} cash!`
  if (got.kind === 'boost') return `${multText(got.mult)} ${STAT[got.stat].toLowerCase()} for ${timeBadge(got.time).toLowerCase()}!`
  if (got.kind === 'gear') return got.dupe ? `You already own ${gearName(got.gear)}: +$${S.short(got.cash)} instead!` : `${gearName(got.gear)} unlocked! Wear it at the Robot Gear hall.`
  if (got.kind === 'upgrade') return got.ups.length ? `Free upgrades: ${got.ups.map((u) => `+${u.levels} ${u.name}`).join(', ')}!` : 'Your upgrades are already maxed out!'
  return ''
}

export function createInvite({ say, pets } = {}) {
  const win = createWindow({ title: 'Invite Friends', icon: ICONS.crew, className: 'w-invite uiw-dark', onOpen })
  const body = win.body
  body.classList.add('inv-body')

  // --- Frame (built once; the dynamic parts are repainted by render()) ----------------------------------
  const stats = el('div', 'inv-stats')
  const stat = (cls, label) => {
    const s = el('div', `inv-stat ${cls}`, `<span class="inv-v uiw-text"></span><span class="inv-l uiw-text">${label}</span>`)
    stats.append(s)
    return s.querySelector('.inv-v')
  }
  const playingV = stat('a', 'Friends playing')
  const pendingV = stat('b', 'Joined, not playing yet')
  const nextV = stat('c', 'Next reward')
  const hint = el('div', 'inv-hint uiw-text')
  const linkRow = el('div', 'inv-link')
  const linkIn = el('input', 'inv-link-in')
  linkIn.readOnly = true
  linkIn.setAttribute('aria-label', 'Your invite link')
  linkIn.addEventListener('focus', () => linkIn.select())
  const copyBtn = uiButton('COPY LINK', 'green', copyLink, 'inv-copy')
  const shareBtn = uiButton('SHARE', 'green', shareLink, 'inv-share')
  shareBtn.hidden = typeof navigator.share !== 'function'
  linkRow.append(linkIn, copyBtn, shareBtn)
  const cols = el('div', 'inv-cols')
  const friendsBox = el('div', 'inv-box friends')
  const friendsList = el('div', 'inv-list')
  friendsBox.append(el('div', 'inv-head uiw-text', 'Your Boxity Friends'), friendsList)
  const tiersBox = el('div', 'inv-box tiers')
  const tiersList = el('div', 'inv-list')
  tiersBox.append(el('div', 'inv-head uiw-text', 'Invite Rewards'), tiersList)
  cols.append(friendsBox, tiersBox)
  body.append(stats, hint, linkRow, cols)

  // --- State ------------------------------------------------------------------------------------------------
  const view = () => (isGuest() ? null : net.invite)
  const need = () => net.invite?.need ?? INVITE.need
  // 'guest' | 'offline' | 'loading' | 'ok'
  const mode = () => (isGuest() ? 'guest' : !hasServer() || !net.connected ? 'offline' : net.invite ? 'ok' : 'loading')
  const claimable = (v, t, i) => !!v && v.invites >= t.friends && !v.claimed.includes(i)
  const nextTier = (v) => INVITE.tiers.find((t, i) => !(v?.claimed ?? []).includes(i) && (v?.invites ?? 0) < t.friends) ?? null

  // True when there is something to claim (the kiosk pulses): a tier reached or the welcome gift.
  function ready() {
    const v = view()
    if (!v) return false
    return v.welcome === 'ready' || INVITE.tiers.some((t, i) => claimable(v, t, i))
  }

  // --- Link ---------------------------------------------------------------------------------------------------
  // The SDK's invite link (portal page + this room + ref); without the SDK (npm run dev) this page with
  // the room and ref, so two local browsers can try it.
  async function buildLink() {
    const ref = myAccountId()
    if (!ref) return ''
    const fromSdk = await inviteLink(ref)
    if (fromSdk) return fromSdk
    const q = new URLSearchParams()
    if (net.room?.roomId) q.set('roomId', net.room.roomId)
    q.set('ref', ref)
    return `${location.origin}${location.pathname}?${q}`
  }
  async function copyLink() {
    if (!linkIn.value) linkIn.value = await buildLink()
    if (!linkIn.value) return say('Sign in to Bloxity to get your invite link!', false)
    let ok = false
    try {
      await navigator.clipboard.writeText(linkIn.value)
      ok = true
    } catch {
      // Clipboard blocked (iframe policy): select the field and try the old way.
      try {
        linkIn.focus()
        linkIn.select()
        ok = document.execCommand('copy')
      } catch {
        ok = false
      }
    }
    if (ok) sfx.tick()
    say(ok ? 'Invite link copied! Send it to your friends.' : 'Copy the link from the box.', ok)
  }
  async function shareLink() {
    if (!linkIn.value) linkIn.value = await buildLink()
    if (!linkIn.value) return
    try {
      await navigator.share({ title: 'Build the Skyscraper', text: 'Build a skyscraper with me!', url: linkIn.value })
    } catch {
      // Cancelled.
    }
  }

  // --- Rewards -----------------------------------------------------------------------------------------------------
  let claiming = false
  async function claim(id, prize, btn, card) {
    if (claiming) return
    const m = mode()
    if (m === 'guest') return say(FAIL.guest, false)
    claiming = true
    btn.disabled = true
    btn.textContent = '...'
    const res = await claimInvite(id)
    claiming = false
    btn.disabled = false
    if (!res.ok) {
      replay(btn, 'shake')
      say(FAIL[res.reason] ?? 'Something went wrong - try again.', false)
      render()
      return
    }
    const got = S.grantRewards(prize)
    saveNow(true) // the claim is stored on the server: keep what it paid in the save too
    const egg = got.find((g) => g.kind === 'egg')
    const big = id === 'welcome' ? false : INVITE.tiers[id]?.friends >= 8
    sfx.rewardClaim(got.some((g) => g.kind === 'gear' && !g.dupe) ? 'gear' : got[0]?.kind === 'boost' ? 'boost' : 'cash', big)
    for (const g of got) {
      const line = grantedLine(g)
      if (line) say(line, true)
    }
    replay(card, 'bump')
    burst(...centre(card), 'big')
    render()
    refreshInvite()
    if (egg) {
      win.close()
      pets?.freeHatch(egg.egg)
    }
  }

  function prizeCard(cls, title, prize, color) {
    const card = el('div', `inv-card ${cls} inv-c-${color}`)
    card.innerHTML = `<div class="inv-rays"></div><div class="inv-arts">${prizeArt(prize)}</div><div class="inv-info"><div class="inv-t uiw-text">${title}</div><div class="inv-p uiw-text">${prizesOf(prize).map(prizeText).join('  +  ')}</div></div>`
    return card
  }

  // The invited friend's welcome gift: the first card of the rewards list (null when not invited).
  function welcomeCard(v) {
    if (!v || (v.welcome !== 'ready' && v.welcome !== 'claimed')) return null
    const done = v.welcome === 'claimed'
    const who = v.invitedBy || 'A friend'
    const card = prizeCard(`welcome${done ? ' claimed' : ' ready'}`, `${who} invited you! Welcome gift`, INVITE.welcome, 'gold')
    const btn = uiButton(done ? 'CLAIMED' : 'CLAIM', done ? 'red' : 'green', () => (done ? sfx.deny() : claim('welcome', INVITE.welcome, btn, card)), 'inv-btn')
    if (done) btn.classList.add('done')
    card.append(btn)
    return card
  }

  function renderTiers(v) {
    const n = v?.invites ?? 0
    const cards = INVITE.tiers.map((t, i) => {
      const claimed = !!v?.claimed.includes(i)
      const isReady = claimable(v, t, i)
      const card = prizeCard(`tier ${claimed ? 'claimed' : isReady ? 'ready' : 'locked'}`, plural(t.friends, 'FRIEND'), t.prize, t.color)
      const info = card.querySelector('.inv-info')
      info.append(el('div', 'inv-bar', `<i style="width:${Math.min(100, (n / t.friends) * 100)}%"></i><b class="uiw-text">${Math.min(n, t.friends)}/${t.friends}</b>`))
      const label = claimed ? 'CLAIMED' : isReady ? 'CLAIM' : 'LOCKED'
      const btn = uiButton(label, claimed ? 'red' : isReady ? 'green' : 'red', () => tap(i, t, v, btn, card), 'inv-btn')
      if (!isReady) btn.classList.add(claimed ? 'done' : 'locked')
      card.append(btn)
      // The whole card is a tap target for its button (thumbs on small screens).
      card.addEventListener('click', (e) => {
        if (e.target !== btn && !btn.contains(e.target)) btn.click()
      })
      return card
    })
    const w = welcomeCard(v)
    tiersList.replaceChildren(...(w ? [w] : []), ...cards)
  }
  function tap(i, t, v, btn, card) {
    if (v?.claimed.includes(i)) {
      sfx.deny()
      return say('Already claimed!', true)
    }
    if (!claimable(v, t, i)) {
      sfx.lockedTap()
      replay(btn, 'shake')
      const left = t.friends - (v?.invites ?? 0)
      return say(isGuest() ? FAIL.guest : `Invite ${plural(Math.max(1, left), 'more friend')} who start playing!`, false)
    }
    claim(i, t.prize, btn, card)
  }

  // --- Friends (Boxity friends list: direct invites) ----------------------------------------------------------
  const sent = new Set() // friend ids invited this session
  let friends = null // null = loading
  let friendsFor = '' // the account the list was fetched for
  async function loadFriends() {
    if (isGuest() || !canInvite()) {
      friends = []
      return renderFriends()
    }
    const who = myAccountId()
    if (friends && friendsFor === who) return renderFriends()
    friends = null
    friendsFor = who
    renderFriends()
    const list = await getFriends()
    friends = list.sort((a, b) => (ORDER[a.presence?.status] ?? 3) - (ORDER[b.presence?.status] ?? 3))
    renderFriends()
  }
  const note = (text) => el('div', 'inv-empty uiw-text', text)
  function renderFriends() {
    if (isGuest()) return friendsList.replaceChildren(note('Sign in to Bloxity to invite your friends and earn rewards!'))
    if (!canInvite()) return friendsList.replaceChildren(note('Your friends list shows when you play on Bloxity. Share your link instead!'))
    if (!friends) return friendsList.replaceChildren(note('Loading friends...'))
    if (!friends.length) return friendsList.replaceChildren(note('No Bloxity friends yet. Share your link instead!'))
    friendsList.replaceChildren(...friends.map(friendRow))
  }
  function friendRow(f) {
    const name = f.displayName || f.username || 'Friend'
    const status = f.presence?.status ?? 'offline'
    const row = el('div', `inv-friend ${status}`)
    const pic = el('div', 'inv-pfp uiw-text')
    pic.textContent = name[0]?.toUpperCase() ?? '?'
    if (typeof f.pfp === 'string' && /^https?:\/\//.test(f.pfp)) {
      const img = el('img')
      img.alt = ''
      img.src = f.pfp
      img.onerror = () => img.remove()
      pic.append(img)
    }
    const text = el('div', 'inv-name')
    const n = el('span', 'n uiw-text')
    n.textContent = name
    const s = el('span', 's uiw-text')
    s.textContent = status === 'in-game' && f.presence?.gameName ? `Playing ${f.presence.gameName}` : STATUS[status] ?? 'Offline'
    text.append(n, s)
    const done = sent.has(f._id)
    const b = uiButton(done ? 'SENT' : 'INVITE', done ? 'red' : 'green', async () => {
      if (sent.has(f._id) || b.disabled) return
      b.disabled = true
      const ok = await inviteFriend(f._id)
      b.disabled = false
      if (!ok) {
        replay(b, 'shake')
        return say(`Could not invite ${name} - try again.`, false)
      }
      sent.add(f._id)
      sentInvite(f._id)
      b.className = 'uiw-btn uiw-text red inv-btn done'
      b.textContent = 'SENT'
      say(`Invite sent to ${name}! You get rewards once they play.`, true)
    }, 'inv-btn')
    if (done) b.classList.add('done')
    row.append(pic, text, b)
    return row
  }

  // --- Paint ------------------------------------------------------------------------------------------------------
  let painted = ''
  function render() {
    const v = view()
    const m = mode()
    const nd = need()
    const mins = Math.max(1, Math.round(nd.playtime / 60))
    playingV.textContent = String(v?.invites ?? 0)
    pendingV.textContent = String(v?.pending ?? 0)
    const nx = nextTier(v)
    nextV.textContent = nx ? plural(nx.friends, 'friend') : v ? 'All done!' : '-'
    const text =
      m === 'guest' ? FAIL.guest
      : m === 'offline' ? 'Invites need the multiplayer server. Reconnecting...'
      : m === 'loading' ? 'Loading your invites...'
      : v.pending > 0 ? `${plural(v.pending, 'friend')} joined! They count once they have played about ${mins} min and placed ${S.commas(nd.blocks)} blocks.`
      : `A friend counts once they have played about ${mins} min and placed ${S.commas(nd.blocks)} blocks - real players only.`
    if (hint.textContent !== text) hint.textContent = text
    const key = JSON.stringify([m, v?.invites, v?.pending, v?.claimed, v?.welcome, v?.invitedBy, claiming, S.state.buildings])
    if (key !== painted) {
      painted = key
      renderTiers(v)
    }
    linkRow.classList.toggle('off', m === 'guest')
    copyBtn.disabled = shareBtn.disabled = m === 'guest'
    renderFriends()
  }

  async function onOpen() {
    painted = ''
    render()
    refreshInvite()
    linkIn.value = ''
    linkIn.value = await buildLink()
    loadFriends()
  }

  onInviteChange(() => win.isOpen() && render())

  // A friend you invited started playing / you were invited: a toast, a sound, and the window follows.
  onInviteEvent((kind, name) => {
    if (kind === 'friendJoined') {
      sfx.rewardClaim('cash', false)
      say(`${name} started playing! +1 friend - check Invite Friends.`, true)
    } else if (kind === 'invitedBy') {
      sfx.rewardClaim('gear', false)
      say(`${name} invited you! Open Invite Friends at the plaza for your welcome gift.`, true)
    }
    if (win.isOpen()) render()
  })

  return {
    win,
    open: () => win.open(),
    ready,
  }
}
