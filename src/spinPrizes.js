import { GYM, SPIN } from './config.js'
import { petTitle } from './petArt.js'
import { addCash, addPet, addSpins, emit, petDef, short, spinScale, state } from './stats.js'

// What the spin wheel's slices pay out, shared by the 3D wheel (labels), the Spin window and
// the Mystery Jackpot. Cash prizes grow with buildings finished (stats.spinScale).

export const cashPrize = (amount) => Math.round(amount * spinScale())

// Two short lines for a slice: ['$1.4K'] / ['5x', 'GYM'] / ['MECH', 'LIMITED'] / ['GOLD', 'SPIN'].
export function prizeLabel(p) {
  if (p.kind === 'cash') return [`$${short(cashPrize(p.amount))}`]
  if (p.kind === 'gym') return p.label ? p.label.split(' ') : [`${GYM.tiers[p.tier].mult}x`, 'GYM']
  if (p.kind === 'pet') return [petDef(p.pet).name.toUpperCase(), p.tag ?? '']
  return ['GOLD', 'SPIN']
}

export function rollSlice(slices) {
  let r = Math.random() * slices.reduce((a, s) => a + s.chance, 0)
  for (let i = 0; i < slices.length; i++) {
    r -= slices[i].chance
    if (r < 0) return i
  }
  return 0
}

const gymOwned = (tier) => !!state.gymOwned[tier] || (GYM.tiers[tier].price == null && state.buildings >= GYM.tiers[tier].need)
const petOwned = (id, tier = 0) => state.pets.some((p) => p.id === id && p.tier === tier)

// The Mystery Jackpot: the first prize on SPIN.jackpot you do not have yet, else big cash.
export function jackpotPrize() {
  for (const p of SPIN.jackpot) {
    if (p.kind === 'pet' && !petOwned(p.pet, p.gold ?? 0)) return p
    if (p.kind === 'gym' && !gymOwned(p.tier)) return p
  }
  return { kind: 'cash', amount: SPIN.jackpotCash }
}

// Pays a prize out. Returns { title, sub, kind, pet?, tier? } for the reveal.
export function applyPrize(p) {
  if (p.kind === 'cash') {
    const n = cashPrize(p.amount)
    addCash(n)
    return { kind: 'cash', title: `+$${short(n)}`, sub: 'Cash' }
  }
  if (p.kind === 'golden') {
    addSpins('golden', 1)
    return { kind: 'golden', title: '+1 Golden Spin', sub: 'Better prizes!' }
  }
  if (p.kind === 'pet') {
    const pet = addPet(p.pet, p.gold ?? 0, { force: true })
    const def = petDef(p.pet)
    return { kind: 'pet', title: `${petTitle(def, p.gold ?? 0)}!`, sub: 'Limited pet', pet: pet && def, tier: p.gold ?? 0 }
  }
  // Gym pad: unlocked for good (it counts as owned even before you have the buildings).
  const t = GYM.tiers[p.tier]
  if (gymOwned(p.tier)) {
    const n = cashPrize(SPIN.dupeCash)
    addCash(n)
    return { kind: 'cash', title: `+$${short(n)}`, sub: `You already have the ${t.label} gym` }
  }
  state.gymOwned[p.tier] = true
  emit('gymOwned', p.tier)
  return { kind: 'gym', title: `${t.label} Gym unlocked!`, sub: `${t.mult}x Strength and Speed per rep`, color: t.color }
}
