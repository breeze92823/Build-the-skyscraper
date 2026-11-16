import { PET, RARITIES } from './config.js'

// SVG portraits for the UI (egg panel tiles, hatch reveal, pets window): a chunky front
// view of each pet built from its `kind` and colours. silhouette = the black shape the egg
// panel shows for pets you have not hatched yet. tier 1 = Golden, 2 = Rainbow.

const INK = '#1b1b24'
const O = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`

// One rainbow gradient for every Rainbow pet on the page (identical defs, so any copy works).
const RAINBOW = '<defs><linearGradient id="pet-rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset="0.25" stop-color="#ffd23a"/><stop offset="0.5" stop-color="#4fe36a"/><stop offset="0.75" stop-color="#3ba7ff"/><stop offset="1" stop-color="#b45cff"/></linearGradient></defs>'

function palette(def, tier) {
  if (tier === 1) return ['#ffd23a', '#fff3b0', '#d99a00']
  if (tier === 2) return ['url(#pet-rb)', '#ffffff', '#ff4fa8']
  return def.c
}

export function petSvg(def, tier = 0, { silhouette = false } = {}) {
  const [c0, c1, c2] = silhouette ? ['#15151c', '#15151c', '#15151c'] : palette(def, tier)
  const k = def.kind
  const back = []
  const front = []
  // Ears / horns / wings behind the head.
  if (k === 'cat') back.push(`<path d="M20 38 L24 8 L44 26 Z M80 38 L76 8 L56 26 Z" fill="${c0}" ${O}/>`, silhouette ? '' : `<path d="M25 30 L27 16 L37 26 Z M75 30 L73 16 L63 26 Z" fill="${c2}"/>`)
  if (k === 'fox') back.push(`<path d="M16 42 L18 2 L46 26 Z M84 42 L82 2 L54 26 Z" fill="${c0}" ${O}/>`, silhouette ? '' : `<path d="M19 14 L18 4 L28 12 Z M81 14 L82 4 L72 12 Z" fill="${c2}"/>`)
  if (k === 'bunny') back.push(`<ellipse cx="36" cy="16" rx="8" ry="20" fill="${c0}" ${O}/><ellipse cx="64" cy="16" rx="8" ry="20" fill="${c0}" ${O}/>`, silhouette ? '' : `<ellipse cx="36" cy="17" rx="3.5" ry="13" fill="${c2}"/><ellipse cx="64" cy="17" rx="3.5" ry="13" fill="${c2}"/>`)
  if (k === 'bear') back.push(`<circle cx="24" cy="26" r="11" fill="${c0}" ${O}/><circle cx="76" cy="26" r="11" fill="${c0}" ${O}/>`, silhouette ? '' : `<circle cx="24" cy="26" r="5" fill="${c2}"/><circle cx="76" cy="26" r="5" fill="${c2}"/>`)
  if (k === 'mouse') back.push(`<circle cx="18" cy="28" r="15" fill="${c0}" ${O}/><circle cx="82" cy="28" r="15" fill="${c0}" ${O}/>`, silhouette ? '' : `<circle cx="18" cy="28" r="8" fill="${c2}"/><circle cx="82" cy="28" r="8" fill="${c2}"/>`)
  if (k === 'dragon') back.push(`<path d="M22 50 L2 22 L10 52 L0 60 L22 64 Z M78 50 L98 22 L90 52 L100 60 L78 64 Z" fill="${c2}" ${O}/><path d="M30 26 L26 6 L40 22 Z M70 26 L74 6 L60 22 Z" fill="${c1}" ${O}/>`)
  if (k === 'bird') back.push(`<path d="M20 62 L4 52 L10 74 L24 78 Z M80 62 L96 52 L90 74 L76 78 Z" fill="${c0}" ${O}/><path d="M44 22 L46 8 L52 20 L58 10 L56 24 Z" fill="${c2}" ${O}/>`)
  if (k === 'robot') back.push(`<path d="M50 22 V8" ${O} fill="none"/><circle cx="50" cy="7" r="5" fill="${c2}" ${O}/>`)
  // Body + head.
  const headR = k === 'robot' ? 8 : 20
  const body = `<rect x="28" y="62" width="44" height="32" rx="12" fill="${c0}" ${O}/>`
  const belly = silhouette ? '' : `<ellipse cx="50" cy="80" rx="13" ry="10" fill="${c1}"/>`
  const head = `<rect x="16" y="22" width="68" height="52" rx="${headR}" fill="${c0}" ${O}/>`
  if (k === 'dog') back.push(`<ellipse cx="16" cy="46" rx="9" ry="18" fill="${c2}" ${O} transform="rotate(14 16 46)"/><ellipse cx="84" cy="46" rx="9" ry="18" fill="${c2}" ${O} transform="rotate(-14 84 46)"/>`)
  if (!silhouette) {
    if (k === 'robot') {
      front.push(`<rect x="28" y="38" width="16" height="10" rx="3" fill="${c2}" ${O}/><rect x="56" y="38" width="16" height="10" rx="3" fill="${c2}" ${O}/>`)
      front.push(`<rect x="34" y="56" width="32" height="9" rx="3" fill="${c1}" ${O}/><path d="M42 56 V65 M50 56 V65 M58 56 V65" stroke="${INK}" stroke-width="2"/>`)
    } else {
      // Muzzle (beak for birds), eyes with glints, nose.
      if (k === 'bird') front.push(`<path d="M42 54 L58 54 L50 66 Z" fill="${c2}" ${O}/>`)
      else front.push(`<ellipse cx="50" cy="60" rx="17" ry="11" fill="${c1}"/>`, `<ellipse cx="50" cy="55" rx="5" ry="3.6" fill="${INK}"/>`, `<path d="M44 63 Q50 68 56 63" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`)
      front.push(`<ellipse cx="36" cy="44" rx="5.5" ry="7" fill="${INK}"/><ellipse cx="64" cy="44" rx="5.5" ry="7" fill="${INK}"/><circle cx="38" cy="41" r="2" fill="#fff"/><circle cx="66" cy="41" r="2" fill="#fff"/>`)
      if (k === 'fox' || k === 'cat') front.push(`<path d="M18 56 H30 M18 62 H30 M70 56 H82 M70 62 H82" stroke="${INK}" stroke-width="1.6" opacity="0.5"/>`)
      if (k === 'dragon') front.push(`<path d="M30 34 L36 30 L42 34 M58 34 L64 30 L70 34" stroke="${INK}" stroke-width="2.4" fill="none"/>`)
    }
  }
  if (def.hat) {
    const hat = silhouette ? '#15151c' : tier === 1 ? '#fff3b0' : '#ffd21a'
    front.push(`<path d="M24 30 C24 6 76 6 76 30 Z" fill="${hat}" ${O}/><rect x="16" y="27" width="68" height="7" rx="3" fill="${hat}" ${O}/>`)
    if (!silhouette) front.push('<path d="M50 9 V28" stroke="#ffffff" stroke-width="3" opacity="0.6"/>')
  }
  if (!silhouette && tier >= 1) front.push('<path d="M82 12 L84 18 L90 20 L84 22 L82 28 L80 22 L74 20 L80 18 Z" fill="#ffffff" stroke="#ffd23a" stroke-width="1.5"/>')
  return `<svg viewBox="0 0 100 100" class="pet-svg">${tier === 2 ? RAINBOW : ''}${back.join('')}${body}${belly}${head}${front.join('')}</svg>`
}

// Egg drawings for the hatch reveal and the Shop's pass cards.
const EGG_PATH = 'M50 4 C24 4 10 40 10 62 C10 84 28 96 50 96 C72 96 90 84 90 62 C90 40 76 4 50 4 Z'
export function eggSvg(id) {
  const clip = `<clipPath id="egg-clip-${id}"><path d="${EGG_PATH}"/></clipPath>`
  let fill = '#ffffff'
  let deco = ''
  if (id === 'hazard') {
    fill = '#ffd21a'
    deco = `<g clip-path="url(#egg-clip-${id})"><rect x="0" y="46" width="100" height="18" fill="${INK}"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M${i * 16 - 6} 64 L${i * 16 + 2} 46 L${i * 16 + 10} 46 L${i * 16 + 2} 64 Z" fill="#ffd21a"/>`).join('')}</g><circle cx="30" cy="30" r="3" fill="#8a9099"/><circle cx="68" cy="78" r="3" fill="#8a9099"/>`
  } else if (id === 'brick') {
    fill = '#d0583a'
    const rows = []
    for (let y = 8; y < 96; y += 11) {
      rows.push(`<path d="M0 ${y} H100" stroke="#7dff8a" stroke-width="2"/>`)
      const off = (y / 11) % 2 ? 0 : 10
      for (let x = off; x < 100; x += 20) rows.push(`<path d="M${x} ${y} V${y + 11}" stroke="#7dff8a" stroke-width="2"/>`)
    }
    deco = `<g clip-path="url(#egg-clip-${id})">${rows.join('')}</g>`
  } else if (id === 'steel') {
    fill = '#a9b0ba'
    deco = `<g clip-path="url(#egg-clip-${id})"><path d="M0 34 H100 M0 76 H100 M30 0 V100 M70 0 V100" stroke="#6b737e" stroke-width="2.4"/><rect x="0" y="52" width="100" height="6" fill="#3bd9ff"/></g><circle cx="24" cy="40" r="2.4" fill="#e6ebf0"/><circle cx="76" cy="40" r="2.4" fill="#e6ebf0"/>`
  } else if (id === 'golden') {
    fill = '#ffcf3a'
    deco = `<g clip-path="url(#egg-clip-${id})"><path d="M20 40 H40 M56 32 H78 M24 70 H46 M58 62 H80 M36 86 H64" stroke="#e09a00" stroke-width="3" stroke-linecap="round"/></g><path d="M34 18 L36 24 L42 26 L36 28 L34 34 L32 28 L26 26 L32 24 Z" fill="#ffffff"/>`
  }
  return `<svg viewBox="0 0 100 100" class="egg-svg"><defs>${clip}</defs><path d="${EGG_PATH}" fill="${fill}" ${O}/>${deco}<path d="${EGG_PATH}" fill="none" ${O}/><ellipse cx="32" cy="28" rx="6" ry="11" fill="#ffffff" opacity="0.35" transform="rotate(20 32 28)"/></svg>`
}

// "x1.25" style boost text.
export function boostText(b) {
  const m = 1 + b
  return `x${m >= 100 ? Math.round(m) : m >= 10 ? m.toFixed(1) : m.toFixed(2)}`
}
export const rarityOf = (def) => RARITIES[def.rarity]
export const tierName = (tier) => PET.tiers[tier]?.name ?? ''
// "Golden Cone Cat", but "Shiny Gold Bunny" rather than "Golden Gold Bunny".
export function petTitle(def, tier) {
  if (!tier) return def.name
  const name = tier === 1 && /gold|gild/i.test(def.name) ? 'Shiny' : tierName(tier)
  return `${name} ${def.name}`
}
