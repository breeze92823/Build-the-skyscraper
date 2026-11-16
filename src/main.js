import { ACESFilmicToneMapping, BoxGeometry, Clock, ConeGeometry, Group, Mesh, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { CAMERA, CREW, ELEVATOR, GIFT, GYM, LAYOUT, RANKS, SAVE, SHOP, SPAWN, SPAWN_FACING, TOWER, graphicsPreset, RENDER } from './config.js'
import * as bloxity from './bloxity.js'
import { install as installInput, inputState, onKey } from './input.js'
import { installTouch } from './touch.js'
import { createPlayerBody, interpolate as interpolatePlayer, player, resetPlayer } from './player.js'
import { setCameraSensitivity, syncYawToPlayer, update as updateCamera } from './camera.js'
import { onModeChanged, toggleMode } from './modes.js'
import { bodyCount, initPhysics, stepPhysics } from './physics.js'
import { createLighting } from './lighting.js'
import { createWorld, groundColliders } from './world.js'
import { createPostFx } from './postfx.js'
import { neon, setNeonBloom } from './propkit.js'
import { buildDefaultCharacter, loadBaseCharacter } from './avatar/character.js'
import { applyProportions, attachEquippedAccessories } from './avatar/loader.js'
import { disposeAnimator, makeAnimator } from './avatar/animator.js'
import { buildSite } from './site.js'
import { createPit } from './pit.js'
import { createTower } from './tower.js'
import { createElevator } from './elevator.js'
import { createStairs } from './stairs.js'
import { createCranes } from './cranes.js'
import { createGym } from './gym.js'
import { createLeaderboard } from './leaderboard.js'
import { createFx } from './fx.js'
import { createBots } from './bots.js'
import { dressWorker, makeNameTag } from './characters.js'
import { createInteract } from './interact.js'
import { createHud } from './hud.js'
import { createWindows } from './windows.js'
import { closeTopWindow, anyWindowOpen, setWindowReserved } from './uiWindow.js'
import { createDayNight, createEvents } from './cycles.js'
import { createEmitter, setParticleDensity, updateParticles } from './particles.js'
import { game, installAudio, isMuted, sfx, toggleMuted, updateAudio } from './audio/index.js'
import { ICONS } from './hudIcons.js'
import { pointInPolygon } from './shapes.js'
import * as S from './stats.js'

const { state } = S

// Boot order: Bloxity SDK -> renderer -> Rapier (async wasm) -> saved progress -> desert,
// compound, tower and everything on it -> player body -> avatar (async, swaps in when ready)
// -> loop. The SDK is optional at every step.
let lighting = null
let renderer = null
let postfx = null
let fx = null

function applySetting(key, value) {
  if (key === 'camera_sensitivity') setCameraSensitivity(value)
  else if (key === 'fullscreen') bloxity.requestFullscreen(value)
  else if (key === 'graphics_quality' && renderer) {
    const next = graphicsPreset(value)
    renderer.shadowMap.enabled = next.shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.dpr))
    lighting?.setShadows(next)
    postfx?.configure(next)
    setNeonBloom(next.bloom)
    setParticleDensity(next.particles)
    fx?.setScale(next.particles)
    postfx?.setSize(window.innerWidth, window.innerHeight)
  }
}
bloxity.onSetting(applySetting)
bloxity.init()

// --- Renderer ---------------------------------------------------------------------------------
const preset = graphicsPreset(bloxity.settings.graphics_quality)
renderer = new WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = RENDER.exposure
renderer.shadowMap.enabled = preset.shadows
renderer.shadowMap.type = PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr))
document.body.appendChild(renderer.domElement)
installInput(() => {
  if (!closeTopWindow()) bloxity.showMenu()
}, renderer.domElement)
installAudio()

const scene = new Scene()
const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
postfx = createPostFx(renderer, scene, camera)
postfx.configure(preset)

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  postfx.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// --- Physics + world ---------------------------------------------------------------------------------
bloxity.loadingStep('Starting physics')
await initPhysics()
S.load()

bloxity.loadingStep('Building the site')
lighting = createLighting(scene, renderer, preset)
const world = createWorld(scene)
groundColliders()
const site = buildSite(scene, lighting)
const pit = createPit(scene)
const tower = createTower(scene, state.tower)
const elevator = createElevator(scene, tower, {
  liftSpeed: S.liftSpeed,
  onRide(what, dir) {
    if (what === 'start') game.liftStart(dir === 'up')
    else if (what === 'arrive') game.liftArrive()
  },
})
createStairs(scene, tower)
const cranes = createCranes(scene, tower)
const gym = createGym(scene)
const board = createLeaderboard(scene)
fx = createFx(scene)
fx.setScale(preset.particles)
const bots = createBots(scene, { tower, elevator, pit, gym, fx })
const dayNight = createDayNight(lighting)
const events = createEvents()

for (const key of Object.keys(bloxity.settings)) applySetting(key, bloxity.settings[key])

// Ambient particles: sand blowing across the site, sparkles over the pit, the gym and the build.
createEmitter(scene, { boxes: [{ x: 0, y: 1.2, z: -20, sx: 140, sy: 1, sz: 130 }], count: 420, life: 7, velocity: [3.2, 0.15, 0.8], spread: [1, 0.2, 0.6], size: 0.35, color: '#f2c38a', intensity: 0.6, opacity: 0.45, sprite: 'dot', seed: 3 })
createEmitter(scene, { boxes: [{ x: pit.zone.x, y: 0.6, z: pit.zone.z, sx: pit.zone.w / 2, sy: 0.3, sz: pit.zone.d / 2 }], count: 70, life: 2.4, velocity: [0, 1.4, 0], spread: [0.3, 0.4, 0.3], size: 0.3, color: '#ffe066', intensity: 2.6, sprite: 'sparkle', twinkle: 6, seed: 4 })
for (const p of gym.pads.filter((pd) => pd.tier.price != null)) {
  createEmitter(scene, { boxes: [{ x: p.x, y: 1, z: p.z, sx: 4.5, sy: 0.5, sz: 4.5 }], count: 50, life: 2.6, velocity: [0, 1.2, 0], spread: [0.2, 0.4, 0.2], size: 0.35, color: p.tier.color, intensity: 3, sprite: 'sparkle', twinkle: 5, seed: 7 })
}
const roofSparks = createEmitter(scene, { boxes: [{ x: 0, y: 0.4, z: 0, sx: 18, sy: 0.3, sz: 18 }], count: 90, life: 2.2, velocity: [0, 1.6, 0], spread: [0.3, 0.5, 0.3], size: 0.35, color: '#7dffa0', intensity: 2.5, sprite: 'sparkle', twinkle: 7, seed: 9 })
roofSparks.position.set(tower.center.x, 0, tower.center.z)

createPlayerBody()
resetPlayer(SPAWN, SPAWN_FACING)
syncYawToPlayer()

// Compile every shader up front, behind the loading screen (on some GPUs the first frame
// otherwise stalls for seconds while dozens of programs compile).
bloxity.loadingStep('Preparing graphics')
try {
  await renderer.compileAsync(scene, camera)
} catch {
  // Older drivers: they compile on first use instead.
}

// --- Player avatar --------------------------------------------------------------------------------------
const playerGroup = new Group()
playerGroup.rotation.order = 'YXZ'
scene.add(playerGroup)
let avatar = null
let animator = null
let dress = null
let generation = 0
let avatarReady = false
let proportions = null

function setAvatar(next) {
  if (avatar) playerGroup.remove(avatar)
  disposeAnimator(animator)
  avatar = next
  playerGroup.add(avatar)
  dress = dressWorker(avatar, { hat: '#ffd21a' })
  dress.setMuscle(S.muscle(), proportions?.torsoScaleX ?? 1)
  animator = makeAnimator(avatar)
}
setAvatar(buildDefaultCharacter())

async function loadAvatar() {
  const mine = ++generation
  try {
    const group = await loadBaseCharacter()
    if (mine !== generation) return
    const equipped = bloxity.authState.user ? bloxity.getEquippedAvatar() : null
    await attachEquippedAccessories(group, equipped, { skinTextureUrl: bloxity.getSkinTextureUrl() })
    if (mine !== generation) return
    proportions = bloxity.authState.user ? bloxity.getProportions() : null
    applyProportions(group, proportions)
    setAvatar(group)
  } finally {
    if (mine === generation) avatarReady = true
  }
}
let signedIn = null
bloxity.subscribeAuth((s) => {
  const now = !!s.user
  if (now !== signedIn) {
    signedIn = now
    loadAvatar()
  }
})
bloxity.onAvatarChanged(loadAvatar)
bloxity.onProportionsChanged(() => {
  proportions = bloxity.getProportions()
  applyProportions(avatar, proportions)
  dress?.setMuscle(S.muscle(), proportions?.torsoScaleX ?? 1)
})

const myName = () => {
  const n = bloxity.displayName()
  return n === 'Offline' || n === 'Guest' ? 'You' : n
}
const tag = makeNameTag(myName(), S.rankIndex(), { you: true })
scene.add(tag.sprite)

// --- HUD, windows, prompts ---------------------------------------------------------------------------------
const hud = createHud()
bloxity.onReservedAreas((areas) => {
  hud.setReserved(areas)
  setWindowReserved(areas)
})
const say = (text, good = true) => hud.toast(text, good)
const windows = createWindows({ hud, say, onBoost: buyBoost })
const interact = createInteract()

function buyBoost(i, node) {
  const b = SHOP.boosts[i]
  if (tower.phase !== 'building') {
    say('This building is finished! Wait for the next one.', false)
    return false
  }
  if (!S.spend(b.price)) {
    say(`Need $${S.short(b.price - state.cash)} more!`, false)
    hud.shake('boost')
    if (node) node.classList.add('shake')
    sfx.deny()
    return false
  }
  const taken = tower.addBlocks(b.blocks)
  if (taken > 0) {
    helpedBuilding = true
    helpedFloor = true
    S.placedBlocks(taken, { pay: false })
    trackRate(taken)
  }
  sfx.purchase()
  say(`+${S.commas(taken)} blocks placed on the tower!`, true)
  const c = tower.cursor()
  fx.confetti(c.x, c.y + 2, c.z, 60, 8)
  return true
}

hud.on('boost', (i) => buyBoost(i))
hud.on('shop', () => windows.shop.open())
hud.on('upgrades', () => windows.upgrades.open())
hud.on('ranks', () => windows.ranks.open())
hud.on('daily', () => windows.daily.open())
hud.on('pass', (id) => {
  if (state.passes[id]) say('You already own this!', true)
  windows.shop.open()
})
hud.on('gift', () => claimGift())
hud.on('sound', () => toggleMuted())
hud.on('daynight', () => {
  dayNight.skip()
  sfx.dayNight()
})
hud.on('tap', () => tapRep())
hud.on('stop', () => stopTraining())

interact.add({ x: site.kiosks.upgrades.pad.x, z: site.kiosks.upgrades.pad.z, y: 1.6, r: 4.5, info: () => ({ title: 'Upgrade Station', verb: 'Open Upgrades' }), run: () => windows.upgrades.open() })
interact.add({ x: site.kiosks.shop.pad.x, z: site.kiosks.shop.pad.z, y: 1.6, r: 4.5, info: () => ({ title: 'Shop', verb: 'Open Shop' }), run: () => windows.shop.open() })

// Gym machines.
const repGain = (st) => GYM.tiers[st.tier].mult * S.gymMultiplier(st.kind)
for (const st of gym.stations) {
  const tier = GYM.tiers[st.tier]
  const what = st.kind === 'strength' ? 'Bench Press' : 'Treadmill'
  interact.add({
    x: st.x,
    z: st.z,
    y: 1.6,
    r: 2.9,
    info() {
      if (training) return null
      const name = `${tier.label} ${what}`
      if (!gym.tierUnlocked(st.tier, state.buildings, state.gymOwned)) {
        if (tier.price != null) return { title: name, verb: 'Unlock in Shop', price: `$${S.short(tier.price)}`, short: state.cash < tier.price }
        return { title: name, verb: `Need ${tier.need} Building${tier.need > 1 ? 's' : ''}`, off: true }
      }
      return { title: name, verb: `Train +${S.short(repGain(st))} ${st.kind === 'strength' ? 'Strength' : 'Speed'}` }
    },
    run() {
      if (!gym.tierUnlocked(st.tier, state.buildings, state.gymOwned)) {
        windows.shop.open()
        return
      }
      startTraining(st)
    },
  })
}

// Crew: add the nearest worker to your crew.
let crewBot = null
interact.add({
  x: () => crewBot?.pos.x ?? 0,
  y: () => (crewBot?.pos.y ?? 0) + 1.6,
  z: () => crewBot?.pos.z ?? 0,
  r: CREW.radius,
  info() {
    if (!crewBot) return null
    const inCrew = state.crew.includes(crewBot.name)
    if (inCrew) return { title: crewBot.name, verb: 'In your crew', off: true }
    if (state.crew.length >= CREW.max) return { title: crewBot.name, verb: `Crew full (${CREW.max})`, off: true }
    return { title: crewBot.name, verb: 'Add to crew (+10% cash)' }
  },
  run() {
    if (!crewBot || state.crew.includes(crewBot.name) || state.crew.length >= CREW.max) return
    state.crew.push(crewBot.name)
    S.emit('crew', crewBot.name)
    sfx.unlock()
    say(`${crewBot.name} joined your crew! +10% cash`, true)
    fx.sparks(crewBot.pos.x, crewBot.pos.y + 2, crewBot.pos.z, { count: 40, colors: ['#7dff6b', '#ffffff'], speed: 6 })
  },
})

// --- Gym training ------------------------------------------------------------------------------------------
let training = null // { st, repT, reps }
function startTraining(st) {
  if (training || player.locked) return
  if (st.occupant && st.occupant !== 'player') bots.evict(st)
  st.occupant = 'player'
  training = { st, repT: 0 }
  const pose = st.kind === 'strength' ? st.lie : st.stand
  player.locked = true
  player.hold = { x: pose.x, y: pose.y, z: pose.z }
  player.facing = pose.facing
  hud.training(true, st.kind === 'strength' ? 'LIFT!' : 'RUN!')
  sfx.equip()
}
function stopTraining() {
  if (!training) return
  const st = training.st
  st.occupant = null
  if (st.bar) st.bar.position.y = st.barRest
  training = null
  player.locked = false
  player.hold = null
  resetPlayer({ x: st.exit.x, y: 0.4, z: st.exit.z }, player.facing)
  hud.training(false)
}
function doRep() {
  const st = training.st
  const gain = repGain(st)
  S.addStat(st.kind, gain)
  game.rep(st.kind, GYM.tiers[st.tier].mult)
  popAtPlayer(`+${S.short(gain)} ${st.kind === 'strength' ? '💪' : '⚡'}`, st.kind === 'strength' ? '#ffb02e' : '#3fb6ff')
  if (st.kind === 'strength') {
    const b = st.bar.getWorldPosition(tmpV)
    fx.sparks(b.x, b.y, b.z, { count: 10, colors: [GYM.tiers[st.tier].color, '#ffffff'], speed: 4, size: 0.3, life: 0.6 })
  } else {
    fx.dust(player.position.x, player.position.y, player.position.z, { count: 2, size: 0.6, life: 0.6, color: '#e6e6e6', alpha: 0.3 })
  }
}
function tapRep() {
  if (!training) return
  training.repT += GYM.tapBoost
}
const tmpV = new Vector3()

// --- Keys -----------------------------------------------------------------------------------------------------
onKey('KeyE', () => {
  if (training) return stopTraining()
  interact.trigger()
})
onKey('KeyN', () => {
  dayNight.skip()
  sfx.dayNight()
})
onKey('KeyV', toggleMode)
onKey('KeyR', () => respawnPlayer())
onKey('Space', () => tapRep())
onKey('KeyM', () => toggleMuted())
installTouch({ mode: toggleMode, day: () => dayNight.skip(), respawn: () => respawnPlayer() })
onModeChanged((mode) => {
  playerGroup.visible = mode !== 'player'
})

function respawnPlayer() {
  if (training) stopTraining()
  if (player.hold && !training) return // riding the elevator
  resetPlayer(SPAWN, SPAWN_FACING)
  syncYawToPlayer()
  sfx.respawnFx()
}
bloxity.onRespawnRequest(respawnPlayer)

// --- Guide arrow: floats over whatever you should do next ------------------------------------------------------
const guide = new Group()
const guideMat = neon('#ffd23a', 2.6)
const arrowHead = new Mesh(new ConeGeometry(1.1, 1.6, 4), guideMat)
arrowHead.rotation.x = Math.PI
const arrowShaft = new Mesh(new BoxGeometry(0.7, 1.4, 0.7), guideMat)
arrowShaft.position.y = 1.4
arrowHead.position.y = 0
guide.add(arrowHead, arrowShaft)
scene.add(guide)

// --- Tower events --------------------------------------------------------------------------------------------------
let helpedFloor = false
let helpedBuilding = false
let roofBefore = tower.roofY
tower.on('floor', ({ floor, of, done }) => {
  const C = tower.center
  const y = tower.roofY
  // Lift whoever stood on the old roof (or in the cage / on the bridge at the top).
  const p = player.position
  const A = tower.anchors
  const inCage = Math.abs(p.x - (C.x + A.liftX)) < ELEVATOR.cage / 2 + 0.6 && Math.abs(p.z - (C.z + (A.cageZ + A.liftWall) / 2)) < (A.cageZ - A.liftWall) / 2 + ELEVATOR.cage / 2 + 0.6
  const overRoof = pointInPolygon(p.x - C.x, p.z - C.z, tower.spec.pts)
  if (!player.locked && Math.abs(p.y - roofBefore) < 1.6 && (overRoof || inCage)) {
    resetPlayer({ x: p.x, y: p.y + TOWER.floorHeight + 0.05, z: p.z }, player.facing)
  }
  roofBefore = y
  game.floorDone(floor)
  hud.banner(done ? 'BUILDING COMPLETE!' : `FLOOR ${floor} COMPLETE!`, done ? '#7dff6b' : '#ffd23a', done ? 4 : 2.4)
  fx.ring(C.x, y + 0.3, C.z, tower.spec.size * 0.6, tower.spec.size * 1.9, '#7dffa0', 1.1)
  fx.confetti(C.x, y + 1, C.z, done ? 260 : 90, tower.spec.size * 0.6)
  if (helpedFloor) {
    const bonus = Math.round(floor * TOWER.floorBonus * S.cashMultiplier())
    S.addCash(bonus)
    popAtPlayer(`+$${S.short(bonus)}`, '#7dff6b', true)
    game.cash()
  }
  helpedFloor = false
  void of
})
let fireworks = 0
tower.on('complete', ({ n, name }) => {
  game.buildingDone()
  fireworks = TOWER.celebrate - 1
  if (helpedBuilding) {
    state.buildings++
    S.emit('buildings', 1)
    const bonus = Math.round((n + 1) * TOWER.buildingBonus * S.cashMultiplier())
    S.addCash(bonus)
    say(`${name} finished! +1 Building, +$${S.short(bonus)}`, true)
    hud.bump('buildings')
    const next = GYM.tiers.find((t) => t.need === state.buildings)
    if (next) setTimeout(() => say(`New gym pad unlocked: ${next.label}!`, true), 2600)
  }
})
let wasSinking = false
tower.on('height', () => {
  if (tower.sinking && !wasSinking) {
    wasSinking = true
    game.rumble()
    const C = tower.center
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      fx.dust(C.x + Math.cos(a) * tower.spec.size, 0.5, C.z + Math.sin(a) * tower.spec.size, { count: 8, size: 5, grow: 3, life: 3, spread: 4, push: 3, alpha: 0.6 })
    }
    // Nobody rides it down: anyone up there is brought to the plaza.
    if (player.position.y > 1.5 || player.hold) {
      if (training) stopTraining()
      player.locked = false
      player.hold = null
      resetPlayer(SPAWN, SPAWN_FACING)
      syncYawToPlayer()
      say('The building is being cleared. A new one is coming!', true)
    }
  }
})
tower.on('building', () => {
  wasSinking = false
  helpedBuilding = false
  helpedFloor = false
  roofBefore = tower.roofY
  hud.banner(`NEW BUILDING: ${tower.spec.def.name.toUpperCase()}`, '#3fd3ff', 3.5)
  const C = tower.center
  fx.sparks(C.x, 2, C.z, { count: 120, speed: 14, colors: ['#3fd3ff', '#ffffff'], size: 0.8, spread: tower.spec.size * 0.7 })
})

// --- Stat events -------------------------------------------------------------------------------------------------
S.on('strength', () => dress?.setMuscle(S.muscle(), proportions?.torsoScaleX ?? 1))
S.on('rankUp', (i) => {
  game.rankUp()
  hud.banner(`RANK UP! ${RANKS[i].name.toUpperCase()}`, RANKS[i].color, 3.2)
  hud.bump('rank')
  const p = player.position
  fx.sparks(p.x, p.y + 1.5, p.z, { count: 60, colors: [RANKS[i].color, '#ffffff'], speed: 7, size: 0.5 })
})
let windowsDirty = false
S.on('cash', () => (windowsDirty = true))
S.on('upgrade', () => windows.refresh())
S.on('pass', () => windows.refresh())

events.on((ev) => {
  if (ev) {
    hud.banner(`${ev.name}! ${ev.desc.toUpperCase()}`, ev.color, 3.5)
    sfx.unlock()
  } else say('The event is over.', true)
})

// --- Gift ----------------------------------------------------------------------------------------------------------
function claimGift() {
  if (state.giftIn > 0) {
    say(`Free gift in ${S.clock(state.giftIn)}`, false)
    return
  }
  const r = Math.random()
  let reward
  if (r < 0.5) {
    const n = Math.round(300 + state.totalBlocks * 0.15 + state.cash * 0.05)
    S.addCash(n)
    reward = { icon: ICONS.cash, text: `+$${S.short(n)} Cash!` }
  } else if (r < 0.75) {
    const n = Math.round(40 + state.strength * 0.12)
    S.addStat('strength', n)
    reward = { icon: ICONS.strength, text: `+${S.short(n)} Strength!` }
  } else {
    const n = Math.round(30 + state.speed * 0.12)
    S.addStat('speed', n)
    reward = { icon: ICONS.speed, text: `+${S.short(n)} Speed!` }
  }
  state.giftIn = GIFT.every
  sfx.gift?.('cash')
  windows.showGift(reward)
}

// --- Helpers ---------------------------------------------------------------------------------------------------------
const screen = new Vector3()
function popAtPlayer(text, color, big = false) {
  const p = player.renderPosition
  screen.set(p.x, p.y + 2.3, p.z).project(camera)
  if (screen.z > 1) return
  const x = ((screen.x + 1) / 2) * window.innerWidth + (Math.random() - 0.5) * 50
  const y = ((1 - screen.y) / 2) * window.innerHeight
  hud.pop(x, y, text, color, big)
}
// Blocks placed in the last minute (rank window "your speed" and the rank ETA).
const placedLog = []
let elapsedTotal = 0
function trackRate(n) {
  placedLog.push([elapsedTotal, n])
}
function blocksPerMinute() {
  while (placedLog.length && placedLog[0][0] < elapsedTotal - 60) placedLog.shift()
  const sum = placedLog.reduce((a, [, n]) => a + n, 0)
  const span = Math.max(20, Math.min(60, elapsedTotal - (placedLog[0]?.[0] ?? elapsedTotal)))
  return (sum / span) * 60
}

// --- Loop ----------------------------------------------------------------------------------------------------------------
const clock = new Clock()
let shownLoading = true
let readySince = 0
let collectAcc = 0
let buildAcc = 0
let flyT = 0
let popAcc = 0
let popT = 0
let wasFull = false
let saveT = 0
let refreshT = 0
const back = new Vector3()
const backTarget = () => back
let lastNight = -1

// A thrown error must never stop the loop (three.js stops requesting frames when the
// callback throws): log it once per second and keep going.
let lastErrorAt = -1
renderer.setAnimationLoop(() => {
  try {
    frame()
  } catch (err) {
    if (performance.now() - lastErrorAt > 1000) console.error(err)
    lastErrorAt = performance.now()
  }
})

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  const elapsed = clock.elapsedTime
  elapsedTotal = elapsed
  state.playtime += dt

  player.walkSpeed = S.walkSpeed()
  // Moving while on a machine gets you off it.
  if (training && (Math.abs(inputState.move.x) > 0.3 || Math.abs(inputState.move.z) > 0.3)) stopTraining()

  stepPhysics(dt)
  interpolatePlayer()

  // --- Avatar placement + animation.
  const p = player.renderPosition
  playerGroup.position.set(p.x, p.y, p.z)
  const benching = training?.st.kind === 'strength'
  let rep = 0
  if (training) {
    training.repT += dt
    if (training.repT >= GYM.repEvery) {
      training.repT = training.repT % GYM.repEvery
      doRep()
    }
    rep = Math.sin((training.repT / GYM.repEvery) * Math.PI)
    if (benching) {
      const st = training.st
      st.bar.position.y = st.barLow + (st.barHigh - st.barLow) * rep
    }
  }
  playerGroup.rotation.set(benching ? -Math.PI / 2 : 0, player.facing, 0)
  animator?.update(dt, {
    grounded: player.grounded,
    speed: training && !benching ? 9 : Math.hypot(player.velocity.x, player.velocity.z),
    verticalVelocity: player.velocity.y,
    turn: 0,
    activity: benching ? 'bench' : null,
    rep,
  })
  back.set(p.x - Math.sin(player.facing) * 0.35, p.y + 1.3, p.z - Math.cos(player.facing) * 0.35)
  tag.sprite.position.set(p.x, p.y + (benching ? 0.9 : 2.5), p.z)
  tag.set(myName(), S.rankIndex())

  // --- Collect in the pit.
  const cap = S.capacity()
  const inPit = pit.inZone(player.position.x, player.position.z) && player.position.y < 2
  if (inPit && state.bag < cap && !training) {
    collectAcc += S.grabRate() * dt
    if (collectAcc >= 1) {
      const n = Math.floor(collectAcc)
      collectAcc -= n
      S.setBag(state.bag + n)
      popAcc += n
    }
    flyT -= dt
    if (flyT <= 0) {
      flyT = 0.08
      const s = pit.spots[Math.floor(Math.random() * pit.spots.length)]
      fx.flyBlock(tmpV.set(s.x, s.y + 0.3, s.z), backTarget, 0.42, 2.2)
      game.grab()
    }
  } else collectAcc = 0
  const full = state.bag >= cap
  if (full && !wasFull) {
    game.bagFull()
    popAtPlayer('BAG FULL!', '#7dff6b', true)
  }
  wasFull = full

  // --- Build on the roof.
  const onRoof = tower.onRoof(player.position.x, player.position.y, player.position.z)
  let buildStatus = null
  if (onRoof && state.bag > 0 && tower.phase === 'building') {
    const front = tower.nearestFront(player.position.x, player.position.z)
    if (front.d <= S.buildRange()) {
      buildStatus = 'build'
      buildAcc += S.buildRate() * dt
      if (buildAcc >= 1) {
        const n = Math.min(state.bag, Math.floor(buildAcc))
        buildAcc -= n
        const took = tower.addBlocks(n)
        if (took > 0) {
          S.setBag(state.bag - took)
          S.placedBlocks(took)
          helpedFloor = true
          helpedBuilding = true
          trackRate(took)
          popAcc += took
        }
      }
      flyT -= dt
      if (flyT <= 0) {
        flyT = 0.1
        fx.flyBlock(back, tmpV.copy(front.pos).setY(front.pos.y + 0.6), 0.38, 1.6)
        game.place()
      }
    } else buildStatus = 'far'
  } else buildAcc = 0
  // Floating "+N" numbers, batched.
  popT -= dt
  if (popAcc > 0 && popT <= 0) {
    popAtPlayer(`+${S.short(popAcc)}`, onRoof ? '#ffd23a' : '#ffffff')
    popAcc = 0
    popT = 0.35
  }

  // --- World systems.
  const ride = elevator.update(dt, elapsed, player)
  const night = dayNight.update(dt)
  if (Math.abs(night - lastNight) > 0.01) {
    lastNight = night
    world.setNight(night)
    const lamp = lighting.getLampFactor()
    pit.bulbs.emissiveIntensity = 0.3 + lamp * 3
    site.bulb.emissiveIntensity = 0.3 + lamp * 3
  }
  const ev = events.update(dt)
  tower.update(dt, elapsed, night)
  roofSparks.position.y = tower.visibleTop
  roofSparks.visible = tower.phase === 'building'
  cranes.update(dt, elapsed)
  site.update(dt, elapsed)
  pit.update(dt, elapsed)
  gym.update(dt, elapsed, training?.st)
  bots.update(dt, elapsed)
  crewBot = bots.near(player.position.x, player.position.z, CREW.radius)
  if (crewBot && Math.abs(crewBot.pos.y - player.position.y) > 2) crewBot = null
  world.update(dt, elapsed)
  if (fireworks > 0) {
    fireworks -= dt
    if (Math.random() < dt * 4) {
      const C = tower.center
      fx.firework(C.x + (Math.random() - 0.5) * 80, tower.roofY + 25 + Math.random() * 40, C.z + (Math.random() - 0.5) * 80)
      game.firework()
    }
  }
  fx.update(dt, renderer.domElement.height)
  updateParticles(elapsed, renderer.domElement.height)

  // --- Guide arrow.
  let gx = null
  let gy = 0
  let gz = 0
  if (!training && tower.phase === 'building') {
    if (onRoof && state.bag > 0) {
      const c = tower.cursor()
      gx = c.x
      gy = c.y + 4
      gz = c.z
    } else if (!onRoof && state.bag === 0 && player.position.y < 2 && !inPit) {
      gx = pit.zone.x
      gy = 6
      gz = pit.zone.z
    } else if (!onRoof && full && player.position.y < 2) {
      const s = elevator.spots().liftBottom
      gx = s.x
      gy = 7
      gz = s.z - 2.5
    }
  }
  guide.visible = gx !== null && !anyWindowOpen()
  if (guide.visible) {
    guide.position.set(gx, gy + Math.sin(elapsed * 4) * 0.4, gz)
    guide.rotation.y = elapsed * 2
  }

  // --- Prompts, HUD, status.
  interact.update(camera, training ? null : player.position)
  const t = tower.progress()
  hud.ride(ride)
  if (training) {
    hud.status('GYM', training.st.kind === 'strength' ? 'Training Strength' : 'Training Speed', 'Tap LIFT! (or Space) to go faster · E to stop')
    hud.alert(null)
  } else if (ride.riding) {
    hud.status(null)
    hud.alert(null)
  } else if (tower.phase !== 'building') {
    hud.status('DONE', 'Building complete!', 'A new building starts soon')
    hud.alert(null)
  } else if (buildStatus === 'build') {
    hud.status('AUTO', 'Auto Building', 'Stay near the build')
    hud.alert(null)
  } else if (buildStatus === 'far') {
    hud.status('AUTO', 'Auto Building', 'Walk to the glowing block')
    hud.alert('Get closer to the build!')
  } else if (inPit) {
    hud.status(full ? '✓' : 'AUTO', full ? 'Bag Full' : 'Auto Collecting', full ? 'Go build the tower' : 'Stay in the pit to fill your bag')
    hud.alert(null)
  } else if (onRoof && state.bag === 0) {
    hud.status('', 'Bag Empty', 'Ride down and refill in the Blocks pit')
    hud.alert(null)
  } else if (full) {
    hud.status('✓', 'Bag Full', 'Take the elevator to the top')
    hud.alert(null)
  } else if (state.totalBlocks === 0 && state.bag === 0) {
    hud.status('TIP', 'Go to the Blocks pit', 'Follow the yellow arrow to fill your bag')
    hud.alert(null)
  } else {
    hud.status(null)
    hud.alert(null)
  }
  const bpm = blocksPerMinute()
  const nx = RANKS[S.rankIndex() + 1]
  let eta = ''
  if (nx && bpm > 1) {
    const mins = (nx.at - state.totalBlocks) / bpm
    eta = mins < 1 ? `${Math.ceil(mins * 60)}s` : mins < 120 ? `${Math.floor(mins)}m ${Math.round((mins % 1) * 60)}s` : `${Math.round(mins / 60)}h`
  }
  if (state.giftIn > 0) state.giftIn = Math.max(0, state.giftIn - dt)
  hud.update(dt, {
    cash: state.cash,
    speed: state.speed,
    walk: player.walkSpeed,
    strength: state.strength,
    bag: Math.floor(state.bag),
    cap,
    buildings: state.buildings,
    crew: S.crewBonus(),
    crewCount: state.crew.length,
    rankIdx: S.rankIndex(),
    totalBlocks: state.totalBlocks,
    tower: { ...t, name: tower.spec.def.name },
    event: ev,
    nextEvent: events.nextIn(),
    passes: state.passes,
    giftIn: state.giftIn,
    dailyReady: S.dailyStatus().canClaim,
    eta,
    muted: isMuted(),
  })
  dress?.setFill(state.bag / Math.max(1, cap), cap > 120 ? Math.min(3, Math.log2(cap / 120) + 0.5) : 0)

  // Leaderboard + windows.
  board.update(dt, [...bots.entries(), { name: myName(), strength: state.strength, speed: state.speed, blocks: state.totalBlocks, cash: state.cash, buildings: state.buildings, playtime: state.playtime }], myName())
  refreshT -= dt
  if (refreshT <= 0) {
    refreshT = 1
    windows.setBlocksPerMin(bpm)
    if (windowsDirty) {
      windowsDirty = false
      windows.refresh()
    }
  }

  updateAudio(dt, { player: { grounded: player.grounded, vy: player.velocity.y }, windowOpen: anyWindowOpen(), locked: player.locked })
  updateCamera(camera, dt)
  if (import.meta.env.DEV && window.__view) {
    const v = window.__view // dev: __game.view([x, y, z], [tx, ty, tz]) / __game.view(null)
    camera.position.set(...v[0])
    camera.lookAt(...v[1])
  }
  lighting.update(dt, playerGroup.position)
  postfx.render()

  // Save.
  saveT += dt
  if (saveT > SAVE.every) {
    saveT = 0
    state.tower = tower.toSave()
    S.save()
  }

  if (shownLoading) {
    readySince += dt
    if (avatarReady || readySince > 5) {
      shownLoading = false
      bloxity.notifyFirstFrame()
    }
  }
}

window.addEventListener('beforeunload', () => {
  state.tower = tower.toSave()
  S.save()
  bloxity.teardown()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    state.tower = tower.toSave()
    S.save()
  }
})

// Dev-only console hook, e.g. __game.teleport(0, 0, -40) or __game.give({ cash: 1e6 })
if (import.meta.env.DEV) {
  const teleport = (x, y, z, facing = player.facing) => {
    resetPlayer({ x, y, z }, facing)
    syncYawToPlayer()
  }
  window.__game = {
    player,
    scene,
    renderer,
    camera,
    postfx,
    bodies: bodyCount,
    toggleMode,
    teleport,
    state,
    tower,
    elevator,
    bots,
    give: (r) => S.grant(r),
    view: (from, to) => (window.__view = from ? [from, to] : null),
    blocks: (n) => tower.addBlocks(n),
    reset: () => {
      S.resetSave()
      location.reload()
    },
    LAYOUT,
  }
}
