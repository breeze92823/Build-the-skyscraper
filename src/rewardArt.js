import { ROBOT_GEAR } from './config.js'
import { ICONS } from './hudIcons.js'
import { eggSvg } from './petArt.js'

// Portraits for the reward cards (rewardsUi.js): Robot Gear pieces drawn in the HUD's chunky
// outlined style, plus the cash / boost / egg art. All inline SVG, sized by their container.

const O = 'stroke="#1b1b24" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"'
const Y = '#ffc21a' // safety yellow
const Y2 = '#ffe066'
const G = '#8e97a3' // steel
const G2 = '#c9d0d8'
const D = '#3a3f48' // dark metal
const C = '#3bd9ff' // glow

const svg = (body) => `<svg viewBox="0 0 100 100">${body}</svg>`

const GEAR = {
  jetboots: svg(`<g ${O}>
    <rect x="10" y="22" width="30" height="40" rx="6" fill="${Y}"/><rect x="58" y="22" width="30" height="40" rx="6" fill="${Y}"/>
    <rect x="6" y="56" width="40" height="22" rx="5" fill="${D}"/><rect x="54" y="56" width="40" height="22" rx="5" fill="${D}"/>
    <rect x="14" y="30" width="22" height="8" rx="3" fill="${Y2}"/><rect x="62" y="30" width="22" height="8" rx="3" fill="${Y2}"/>
    <rect x="2" y="34" width="10" height="22" rx="4" fill="${G}"/><rect x="88" y="34" width="10" height="22" rx="4" fill="${G}"/>
    <path d="M10 78 L16 92 H36 L42 78 Z" fill="${G2}"/><path d="M58 78 L64 92 H84 L90 78 Z" fill="${G2}"/>
  </g>
  <path d="M16 46 H36 M64 46 H84" stroke="#1b1b24" stroke-width="3"/>
  <path d="M20 92 L26 99 L32 92 Z M68 92 L74 99 L80 92 Z" fill="#ff8a1a"/>
  <path d="M10 64 H42 M58 64 H90" stroke="#ffd23a" stroke-width="4" stroke-dasharray="6 5"/>`),
  gauntlets: svg(`<g ${O}>
    <rect x="44" y="40" width="40" height="44" rx="8" fill="${Y}"/>
    <rect x="48" y="14" width="9" height="30" rx="4" fill="${G2}"/><rect x="58" y="10" width="9" height="34" rx="4" fill="${G2}"/>
    <rect x="68" y="12" width="9" height="32" rx="4" fill="${G2}"/><rect x="78" y="20" width="8" height="26" rx="4" fill="${G2}"/>
    <rect x="34" y="44" width="14" height="22" rx="5" fill="${G2}" transform="rotate(-20 41 55)"/>
    <rect x="50" y="78" width="28" height="16" rx="4" fill="${D}"/>
    <circle cx="64" cy="60" r="9" fill="${C}"/>
    <rect x="6" y="50" width="30" height="34" rx="7" fill="${Y}" transform="rotate(-18 21 67)"/>
    <rect x="4" y="32" width="8" height="22" rx="4" fill="${G2}" transform="rotate(-18 8 43)"/><rect x="13" y="28" width="8" height="24" rx="4" fill="${G2}" transform="rotate(-18 17 40)"/>
    <rect x="22" y="28" width="8" height="22" rx="4" fill="${G2}" transform="rotate(-18 26 39)"/>
    <circle cx="22" cy="68" r="6" fill="${C}"/>
  </g>
  <circle cx="64" cy="60" r="4" fill="#e6fbff"/>`),
  arms: svg(`<g ${O}>
    <rect x="40" y="70" width="34" height="22" rx="6" fill="${D}"/>
    <rect x="50" y="40" width="14" height="36" rx="5" fill="${G2}"/>
    <circle cx="57" cy="72" r="8" fill="${Y}"/>
    <rect x="24" y="30" width="36" height="13" rx="5" fill="${G2}" transform="rotate(-25 42 36)"/>
    <circle cx="57" cy="40" r="8" fill="${Y}"/><circle cx="26" cy="26" r="8" fill="${Y}"/>
    <path d="M18 22 L6 10 L12 6 L24 16 Z" fill="${G}"/><path d="M22 16 L20 2 L27 2 L30 14 Z" fill="${G}"/>
    <rect x="66" y="30" width="28" height="12" rx="5" fill="${G2}" transform="rotate(30 80 36)"/>
    <circle cx="66" cy="32" r="7" fill="${Y}"/><circle cx="88" cy="46" r="7" fill="${Y}"/>
    <path d="M86 52 L82 66 L88 66 L92 54 Z M92 50 L98 62 L94 64 L88 52 Z" fill="${G}"/>
    <rect x="44" y="50" width="26" height="10" rx="3" fill="${C}"/>
  </g>`),
  mech: svg(`<g ${O}>
    <rect x="30" y="66" width="14" height="26" rx="4" fill="${G}"/><rect x="56" y="66" width="14" height="26" rx="4" fill="${G}"/>
    <rect x="24" y="86" width="24" height="10" rx="3" fill="${Y}"/><rect x="52" y="86" width="24" height="10" rx="3" fill="${Y}"/>
    <rect x="22" y="30" width="56" height="40" rx="9" fill="${Y}"/>
    <rect x="32" y="36" width="36" height="18" rx="5" fill="#2a6ea8"/>
    <rect x="36" y="10" width="28" height="22" rx="6" fill="${Y}"/>
    <rect x="41" y="16" width="18" height="8" rx="3" fill="${D}"/>
    <rect x="4" y="32" width="18" height="30" rx="6" fill="${G2}"/><rect x="78" y="32" width="18" height="30" rx="6" fill="${G2}"/>
    <rect x="2" y="60" width="22" height="18" rx="5" fill="${D}"/><rect x="76" y="60" width="22" height="18" rx="5" fill="${D}"/>
    <rect x="40" y="58" width="20" height="8" rx="3" fill="${D}"/>
  </g>
  <rect x="44" y="18" width="5" height="4" fill="${C}"/><rect x="51" y="18" width="5" height="4" fill="${C}"/>
  <circle cx="50" cy="45" r="5" fill="${C}"/><path d="M30 76 H44 M56 76 H70" stroke="#ffd23a" stroke-width="3"/>`),
}

// Any other piece: a gear badge in its own colours.
function gearBadge(def) {
  return svg(`<g ${O}><circle cx="50" cy="50" r="40" fill="${def?.color ?? Y}"/><circle cx="50" cy="50" r="22" fill="${D}"/></g><circle cx="50" cy="50" r="10" fill="${def?.glow ?? C}"/>`)
}

export function gearSvg(id) {
  return GEAR[id] ?? gearBadge(ROBOT_GEAR.find((g) => g.id === id))
}

// The art for one REWARDS entry.
export function rewardSvg(def) {
  if (def.kind === 'gear') return gearSvg(def.gear)
  if (def.kind === 'egg') return eggSvg(def.egg)
  if (def.kind === 'boost') return def.stat === 'cash' ? ICONS.cash : def.stat === 'speed' ? ICONS.speed : ICONS.strength
  // Free upgrade levels: that upgrade's icon (or the Upgrades kiosk icon for "every upgrade").
  if (def.kind === 'upgrade') return ICONS[def.id] ?? ICONS.upgrades
  return ICONS.cash
}
