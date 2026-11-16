import { ACESFilmicToneMapping, BoxGeometry, Clock, ConeGeometry, Group, Mesh, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'
import { AUDIO, CAMERA, ELEVATOR, GYM, INSIDE, LAYOUT, NEXT_BUILDING, RANKS, SAVE, SHOP, SPAWN, SPAWN_FACING, SPIN, TOWER, graphicsPreset, RENDER } from './config.js'
import * as bloxity from './bloxity.js'
import { install as installInput, inputState, onKey } from './input.js'
import { installTouch } from './touch.js'
import { createPlayerBody, interpolate as interpolatePlayer, player, resetPlayer } from './player.js'
import { setCameraSensitivity, syncYawToPlayer, update as updateCamera } from './camera.js'
import { onModeChanged, toggleMode } from './modes.js'
import { bodyCount, initPhysics, stepPhysics } from './physics.js'
import { createLighting } from './lighting.js'
import { createNightLights } from './nightLights.js'
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
import { createLobby } from './lobby.js'
import { createStairs } from './stairs.js'
import { createCranes } from './cranes.js'
import { createGym } from './gym.js'
import { createLeaderboard } from './leaderboard.js'
import { createRobotHall } from './robotGear.js'
import { createRobotPlayer } from './robotPlayer.js'
import { createEggHall } from './eggs.js'
import { createSpinStage } from './spin.js'
import { createPetFollowers } from './pets.js'
import { createPets } from './petUi.js'
import { initRewards, tickRewards } from './rewards.js'
import { initOffline } from './offline.js'
import { createOfflineUi } from './offlineUi.js'
import { createRewardsUi } from './rewardsUi.js'
import { createInvite } from './invite.js'
import { createSpinWindow } from './spinUi.js'
import { createFx } from './fx.js'
import { createFinale } from './finale.js'
import { createRemotePlayers } from './remotePlayers.js'
import { createEmotes } from './emotes.js'
import { createChatBubbles } from './chatBubbles.js'
import { dressWorker, makeNameTag } from './characters.js'
import { createInteract } from './interact.js'
import { createHud } from './hud.js'
import { createNextBuilding } from './nextBuilding.js'
import { prewarmThumbs } from './towerThumbs.js'
import { createWindows } from './windows.js'
import { closeTopWindow, anyWindowOpen, setWindowReserved } from './uiWindow.js'
import { createDayNight, createEvents } from './cycles.js'
import { createEmitter, setParticleDensity, updateParticles } from './particles.js'
import { game, installAudio, isMuted, setAdMuted, setVolume, sfx, toggleMuted, updateAudio } from './audio/index.js'
import * as net from './net.js'
import { ICONS } from './hudIcons.js'
import { pointInPolygon } from './shapes.js'
import * as S from './stats.js'

const { state } = S
// Your credit on the tower (the finale's Top Builders, tower.contributors()).
const meWho = {
  id: 'me',
  get name() {
    return myName()
  },
}

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
  else if (key === 'master_volume') setVolume((AUDIO.volume * value) / 100) // the portal's master slider scales the game's own level
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
// An ad break (Boxity's interstitial / rewarded ad) pauses the world and silences it until it ends.
let adPaused = false
bloxity.onAdBreak(
  () => {
    adPaused = true
    setAdMuted(true)
  },
  () => {
    adPaused = false
    setAdMuted(false)
  },
)

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
// Progress: signed-in players' lives on the server. Connect now and wait (behind the loading screen)
// for it, so the world below is built from the right save; with no server it plays on the browser save.
bloxity.loadingStep('Connecting')
net.initNet()
await net.whenLoaded()

bloxity.loadingStep('Building the site')
lighting = createLighting(scene, renderer, preset)
const world = createWorld(scene)
groundColliders()
const site = buildSite(scene, lighting)
const pit = createPit(scene)
// One tower per room, owned by the server: built from the room's tower when connected (tower.sync keeps it
// in step every frame, below), else from your own save and played locally.
const tower = createTower(scene, net.towerState() ?? state.tower)
tower.setReporter(net.sendBuild) // the blocks you place go up as `build` (batched by net.js)
net.onBuilt(({ n, builders }) => {
  // The finished building's top builders for the finale; you are 'me' there (it highlights that id).
  const mine = (id) => id === net.mySessionId() || (!!net.myUid() && net.normId(id) === net.myUid())
  tower.setBuilders(n, (Array.isArray(builders) ? builders : []).map((b) => ({ id: mine(b.id) ? 'me' : String(b.id), name: String(b.name ?? ''), blocks: Number(b.blocks) || 0 })))
})
const elevator = createElevator(scene, tower, {
  liftSpeed: S.liftSpeed,
  onRide(what, dir) {
    if (what === 'start') game.liftStart(dir === 'up')
    else if (what === 'arrive') game.liftArrive()
  },
})
createStairs(scene, tower)
const cranes = createCranes(scene, tower)
fx = createFx(scene)
fx.setScale(preset.particles)
const gym = createGym(scene, fx)
gym.refresh(state.buildings, state.gymOwned)
const board = createLeaderboard(scene)
net.setLeaderboardHandler(board.setRemote) // the server's top players on the wall
const robotHall = createRobotHall(scene)
// Construction floodlights, gear-hall spotlights and your headlamp after dark.
const nightLights = createNightLights({ scene, lighting, tower, cranes, hall: robotHall, preset })
const hall = createEggHall(scene)
const spinStage = createSpinStage(scene)
const followers = createPetFollowers(scene)
const equippedPets = () => state.petEq.map((u) => state.pets.find((p) => p.uid === u)).filter(Boolean)
followers.sync(equippedPets())
// The finished building's lobby + express elevator to the roof.
const lobby = createLobby(scene, tower, {
  onRide(what, dir) {
    if (what === 'start') game.liftStart(dir === 'up')
    else game.liftArrive()
  },
})
const dayNight = createDayNight(lighting)
const events = createEvents()

for (const key of Object.keys(bloxity.settings)) applySetting(key, bloxity.settings[key])

// Ambient particles: sand blowing across the site, sparkles over the pit and the build (each
// gym pad makes its own in gym.js).
createEmitter(scene, { boxes: [{ x: 0, y: 1.2, z: -20, sx: 140, sy: 1, sz: 130 }], count: 420, life: 7, velocity: [3.2, 0.15, 0.8], spread: [1, 0.2, 0.6], size: 0.35, color: '#f2c38a', intensity: 0.6, opacity: 0.45, sprite: 'dot', seed: 3 })
createEmitter(scene, { boxes: [{ x: pit.zone.x, y: 0.6, z: pit.zone.z, sx: pit.zone.w / 2, sy: 0.3, sz: pit.zone.d / 2 }], count: 70, life: 2.4, velocity: [0, 1.4, 0], spread: [0.3, 0.4, 0.3], size: 0.3, color: '#ffe066', intensity: 2.6, sprite: 'sparkle', twinkle: 6, seed: 4 })
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
const nextReel = createNextBuilding()
prewarmThumbs()
bloxity.onReservedAreas((areas) => {
  hud.setReserved(areas)
  setWindowReserved(areas)
})
const say = (text, good = true) => hud.toast(text, good)
const windows = createWindows({ hud, say, onBoost: buyBoost })
const interact = createInteract()
lobby.attach(interact)
// Robot Gear: pedestal prompts, suit-up, G ability (transform / fly / Titan dropship).
const robots = createRobotPlayer({ scene, hall: robotHall, tower, interact, hud, fx, say, player, playerGroup, getAvatar: () => avatar, popAtPlayer })
const pets = createPets({ hall, say, openShop: (id) => windows.openShopAt(id) })
// Daily & Playtime + Free rewards (server-authoritative for signed-in players: rewards.js).
initRewards()
const rewardsUi = createRewardsUi({ say, pets })
// While You Were Away: Strength + Speed for the time you were gone (the server times it for signed-in players).
initOffline()
const offlineUi = createOfflineUi({ say })
// Invite Friends (the plaza kiosk): friends who actually play earn rewards; the server decides who counts.
const invite = createInvite({ say, pets })
// Other players from the server roster (net.js), our Boxity emotes (relayed to them) and the chat
// bubbles Boxity's chat shows over everyone's head. All of it is inert offline / without the SDK.
const remotes = createRemotePlayers(scene, { fx, impactFx: robots.impactFx })
const emotes = createEmotes({
  getAnimator: () => animator,
  // An emote stops as soon as you move, jump, ride or train.
  isBusy: () => !!training || lobby.riding || player.locked || !player.grounded || Math.hypot(player.velocity.x, player.velocity.z) > 0.8,
})
// Top Builders finale: after a building is finished its top 3 builders stand on podiums on the
// roof while the camera visits each of them (finale.js). You are frozen in place for it, or
// stand on your own podium, and put back afterwards.
let finaleHold = null // where you were before the finale: { x, y, z, facing, moved }
const finale = createFinale({
  scene,
  camera,
  tower,
  fx,
  me: {
    name: myName,
    animator: () => animator,
    headY: () => 2.05 * robots.bodyScale(),
    // spot { x, y, z, facing } = your podium, null = just stand still. False while riding.
    stage(spot) {
      if (finaleHold) return true
      if (training) stopTraining()
      if (player.locked || lobby.riding) return false
      const p = player.position
      finaleHold = { x: p.x, y: p.y, z: p.z, facing: player.facing, moved: !!spot }
      if (spot) resetPlayer(spot, spot.facing)
      player.locked = true
      player.hold = spot ? { x: spot.x, y: spot.y, z: spot.z } : { x: p.x, y: p.y, z: p.z }
      return true
    },
    release() {
      const h = finaleHold
      finaleHold = null
      if (!h) return
      player.locked = false
      player.hold = null
      // Back where you were (unless the building is already clearing everyone off).
      if (h.moved && tower.phase === 'celebrate') resetPlayer(h, h.facing)
      syncYawToPlayer()
    },
  },
  onStart() {
    for (let i = 0; i < 6 && anyWindowOpen(); i++) closeTopWindow()
  },
})
const bubbles = createChatBubbles(scene, {
  remotes,
  getLocalPos: () => player.renderPosition,
  getLocalScale: () => robots.bodyScale(),
  isLocalVisible: () => playerGroup.visible && !lobby.riding,
})
const spinWin = createSpinWindow({
  say,
  onSpin(kind, index, offset) {
    spinStage.repaint(SPIN[kind])
    spinStage.spinTo(index, SPIN.time, offset)
  },
})

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
  // Mark yourself as a helper first: a big boost can finish floors (and the whole building)
  // inside addBlocks, and those events check these flags.
  helpedBuilding = true
  helpedFloor = true
  const taken = tower.addBlocks(b.blocks, meWho)
  if (taken > 0) {
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
hud.on('pets', () => pets.windows.pets.open())
hud.on('spin', () => spinWin.open())
hud.on('daily', () => rewardsUi.open())
hud.on('pass', (id) => {
  if (state.passes[id]) say('You already own this!', true)
  windows.shop.open()
})
hud.on('gift', () => rewardsUi.openFree())
hud.on('sound', () => toggleMuted())
hud.on('daynight', () => {
  dayNight.skip()
  sfx.dayNight()
})
hud.on('tap', () => tapRep())
hud.on('stop', () => stopTraining())

interact.add({ x: site.kiosks.upgrades.pad.x, z: site.kiosks.upgrades.pad.z, y: 1.6, r: 4.5, info: () => ({ title: 'Upgrade Station', verb: 'Open Upgrades' }), run: () => windows.upgrades.open() })
interact.add({ x: site.kiosks.shop.pad.x, z: site.kiosks.shop.pad.z, y: 1.6, r: 4.5, info: () => ({ title: 'Shop', verb: 'Open Shop' }), run: () => windows.shop.open() })
interact.add({ x: site.kiosks.invite.pad.x, z: site.kiosks.invite.pad.z, y: 1.6, r: 4.5, info: () => ({ title: 'Invite Friends', verb: invite.ready() ? 'Claim your invite rewards!' : 'Invite friends, earn rewards' }), run: () => invite.open() })
// Egg hall: the Pet Merge machine. Spin stage: the wheel.
interact.add({ x: hall.merge.x, z: hall.merge.z, y: 1.6, r: 3.4, info: () => ({ title: 'Pet Merge', verb: 'Merge 5 pets into a Golden one' }), run: () => pets.windows.merge.open() })
interact.add({
  x: spinStage.pad.x,
  z: spinStage.pad.z,
  y: 1.6,
  r: 6,
  info: () => {
    const n = state.spins.normal + state.spins.golden
    return { title: 'Spin Wheel', verb: n ? `Spin! (${n} free)` : 'Open the Spin Wheel' }
  },
  run: () => spinWin.open(),
})

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

// --- Gym training ------------------------------------------------------------------------------------------
let training = null // { st, repT, reps }
function startTraining(st) {
  if (training || player.locked) return
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
  resetPlayer({ x: st.exit.x, y: st.exit.y ?? 0.4, z: st.exit.z }, player.facing)
  hud.training(false)
}
function doRep() {
  const st = training.st
  const gain = repGain(st)
  S.addStat(st.kind, gain)
  game.rep(st.kind, GYM.tiers[st.tier].mult)
  popAtPlayer(`+${S.short(gain)} ${st.kind === 'strength' ? '💪' : '⚡'}`, st.kind === 'strength' ? '#ffb02e' : '#3fb6ff')
  gym.rep(st, true)
}
function tapRep() {
  if (!training) return
  training.repT += GYM.tapBoost
}
const tmpV = new Vector3()

// --- Keys -----------------------------------------------------------------------------------------------------
onKey('KeyE', () => {
  if (training) return stopTraining()
  if (pets.key('hatch')) return // next to an egg: hatch one
  interact.trigger()
})
onKey('KeyF', () => pets.key('multi'))
onKey('KeyT', () => pets.key('auto'))
onKey('KeyN', () => {
  dayNight.skip()
  sfx.dayNight()
})
onKey('KeyV', toggleMode)
onKey('KeyR', () => respawnPlayer())
onKey('Space', () => tapRep())
onKey('KeyM', () => toggleMuted())
installTouch({ mode: toggleMode, day: () => dayNight.skip(), respawn: () => respawnPlayer(), ability: () => robots.ability() })
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
  finale.queue() // the Top Builders show; the toasts below wait for it
  finale.after(() => {
    if (tower.lobby) hud.banner(`GO INSIDE! ${INSIDE.mult}X STRENGTH & SPEED`, '#7dff6b', 3.2)
  }, 2200)
  fireworks = TOWER.celebrate - 1
  if (helpedBuilding) {
    state.buildings++
    S.emit('buildings', 1)
    // Rarer buildings (the Next Building reel) pay a bigger finishing bonus.
    const rarityBonus = NEXT_BUILDING.rarities[tower.spec.def.rarity]?.bonus ?? 1
    const bonus = Math.round((n + 1) * TOWER.buildingBonus * rarityBonus * S.cashMultiplier())
    S.addCash(bonus)
    finale.after(() => say(`${name} finished! +1 Building, +$${S.short(bonus)}`, true), 300)
    hud.bump('buildings')
    const next = GYM.tiers.find((t) => t.need === state.buildings)
    if (next) finale.after(() => say(`New gym pad unlocked: ${next.label}!`, true), 2900)
    // Every building you helped finish is a free spin (and the wheel's cash prizes grow).
    S.addSpins('normal', SPIN.perBuilding)
    spinStage.repaint(SPIN.normal)
    finale.after(() => say(`+${SPIN.perBuilding} FREE spin! Open the Spin Wheel`, true), next ? 5500 : 2900)
  }
})
let wasSinking = false
tower.on('height', () => {
  if (tower.sinking && !wasSinking) {
    wasSinking = true
    game.rumble()
    // The party is over: the Next Building reel picks the next one, which rises when it closes.
    const show = nextReel.show(tower.spec.n + 1)
    tower.hold(show - TOWER.sinkTime - NEXT_BUILDING.fadeOut * 0.5)
    const C = tower.center
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      fx.dust(C.x + Math.cos(a) * tower.spec.size, 0.5, C.z + Math.sin(a) * tower.spec.size, { count: 8, size: 5, grow: 3, life: 3, spread: 4, push: 3, alpha: 0.6 })
    }
    // Nobody rides it down: anyone up there is brought to the plaza.
    if (player.position.y > 1.5 || player.hold || lobby.within(player.position)) {
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
  // The building the reel picked rises: a burst in its rarity's colour.
  const rar = NEXT_BUILDING.rarities[tower.spec.def.rarity] ?? NEXT_BUILDING.rarities.common
  hud.banner(`NEW BUILDING: ${tower.spec.def.name.toUpperCase()}`, rar.color, 3.5)
  const C = tower.center
  fx.sparks(C.x, 2, C.z, { count: 120 + rar.level * 30, speed: 14, colors: [rar.color, '#ffffff', tower.spec.def.glass], size: 0.8, spread: tower.spec.size * 0.7 })
  fx.ring(C.x, 0.4, C.z, tower.spec.size * 0.5, tower.spec.size * 2.2, rar.color, 1.2)
  if (rar.level >= 2) fx.confetti(C.x, 6, C.z, 60 + rar.level * 30, tower.spec.size * 0.8)
})

// --- Stat events -------------------------------------------------------------------------------------------------
S.on('strength', () => dress?.setMuscle(S.muscle(), proportions?.torsoScaleX ?? 1))
// A gym pad opening (buildings finished, bought, or won): its force field drops with a burst.
S.on('buildings', () => gym.refresh(state.buildings, state.gymOwned, true))
S.on('gymOwned', () => gym.refresh(state.buildings, state.gymOwned, true))
S.on('rankUp', (i) => {
  game.rankUp()
  hud.banner(`RANK UP! ${RANKS[i].name.toUpperCase()}`, RANKS[i].color, 3.2)
  hud.bump('rank')
  const p = player.position
  fx.sparks(p.x, p.y + 1.5, p.z, { count: 60, colors: [RANKS[i].color, '#ffffff'], speed: 7, size: 0.5 })
})
let windowsDirty = false
S.on('cash', () => (windowsDirty = true))
S.on('upgrade', (id) => {
  windows.refresh()
  game.upgrade(id)
})
S.on('pass', () => windows.refresh())
S.on('pets', () => followers.sync(equippedPets()))
S.on('spins', () => spinWin.refresh())

events.on((ev) => {
  if (ev) {
    hud.banner(`${ev.name}! ${ev.desc.toUpperCase()}`, ev.color, 3.5)
    sfx.unlock()
  } else say('The event is over.', true)
})

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

// Fortune Luck / Golden Touch: a lucky drop pays its coins as cash, with a burst and a floating number.
function luckyDrop(drop) {
  if (!drop) return
  S.addCash(drop.cash)
  popAtPlayer(`LUCKY! +$${S.short(drop.cash)}`, '#ffd23a', true)
  const p = player.renderPosition
  fx.sparks(p.x, p.y + 2.2, p.z, { count: 14 + Math.min(30, drop.coins * 2), colors: ['#ffd23a', '#fff2a8', '#ffffff'], speed: 5 })
  game.lucky(drop.coins)
}

// --- Loop ----------------------------------------------------------------------------------------------------------------
const clock = new Clock()
let shownLoading = true
let readySince = 0
let collectAcc = 0
let buildAcc = 0
let lastComboTier = 0
let placeCarry = 0 // fraction of a block left over from the Wide Trowel multiplier
let flyT = 0
let popAcc = 0
let popT = 0
let wasFull = false
let insideT = 0
// Best gym pad you may use x 5X x your gym passes, for each stat.
function insideReward() {
  let best = 1
  GYM.tiers.forEach((tier, i) => {
    if (gym.tierUnlocked(i, state.buildings, state.gymOwned)) best = Math.max(best, tier.mult)
  })
  const str = Math.round(INSIDE.base * INSIDE.mult * best * S.gymMultiplier('strength'))
  const spd = Math.round(INSIDE.base * INSIDE.mult * best * S.gymMultiplier('speed'))
  S.addStat('strength', str)
  S.addStat('speed', spd)
  statPopNearPlayer('strength', str)
  statPopNearPlayer('speed', spd)
  game.rep('strength', best)
}
// Icon + "+N" somewhere around the player (the inside rewards scatter like the reference).
function statPopNearPlayer(kind, n) {
  const p = player.renderPosition
  screen.set(p.x, p.y + 1.6, p.z).project(camera)
  if (screen.z > 1) return
  const spread = Math.min(window.innerWidth, window.innerHeight) * 0.22
  const x = ((screen.x + 1) / 2) * window.innerWidth + (Math.random() * 2 - 1) * spread
  const y = ((1 - screen.y) / 2) * window.innerHeight + (Math.random() * 2 - 1) * spread * 0.5
  hud.statPop(x, y, kind, `+${S.short(n)}`)
}
// What the others see of you: pose, rank + strength (name tag, bulk) and the worn gear (net.js sends them).
net.setPresenceSources({
  pose: () => {
    const p = player.renderPosition
    return { x: p.x, y: p.y, z: p.z, yaw: player.facing, speed: Math.hypot(player.velocity.x, player.velocity.z), act: training?.st.kind === 'strength' ? 'bench' : robots.poseAct() }
  },
  presence: () => ({ rank: S.rankIndex(), strength: state.strength, gear: state.gear.on || '' }),
})
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
  if (adPaused) {
    postfx.render() // keep the picture, freeze the game until the ad break ends
    return
  }
  const elapsed = clock.elapsedTime
  elapsedTotal = elapsed
  state.playtime += dt
  S.tickTimed(dt)
  tickRewards(dt, () => {
    sfx.rewardReady()
    say('A playtime reward is ready! Open DAILY to claim it.', true)
  })
  rewardsUi.update(dt)

  player.walkSpeed = S.walkSpeed() * robots.speedMul()
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
  // Spider Arms carry the player: the legs hang still while the arms walk and climb.
  const carried = robots.legsIdle()
  animator?.update(dt, {
    grounded: player.grounded || carried,
    speed: carried ? 0 : training && !benching ? 9 : Math.hypot(player.velocity.x, player.velocity.z),
    verticalVelocity: carried ? 0 : player.velocity.y,
    turn: 0,
    activity: benching ? 'bench' : robots.chuting() ? 'chute' : robots.impactDepth() > 0 ? 'impact' : null,
    flare: robots.chuteFlare(),
    impact: robots.impactDepth(),
    rep,
  })
  back.set(p.x - Math.sin(player.facing) * 0.35, p.y + 1.3, p.z - Math.cos(player.facing) * 0.35)
  tag.sprite.position.set(p.x, p.y + (benching ? 0.9 : 2.5 * robots.bodyScale()), p.z)
  tag.set(myName(), S.rankIndex())
  tag.sprite.visible = !lobby.riding && !finale.active // in the cab the camera is right behind your head; the finale shows cards
  if (!finale.active) emotes.update() // the finale plays its own pose on your avatar
  bubbles.update()
  remotes.update(dt, elapsed, p)

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
        // Robot Gear and Wide Trowel: every block from the bag places `mult` blocks (the
        // fraction, e.g. x1.5, carries over to the next placement).
        const mult = S.gearBlocks() * S.trowelMul()
        const want = n * mult + placeCarry
        const whole = Math.floor(want)
        placeCarry = want - whole
        const took = tower.addBlocks(whole, meWho)
        if (took > 0) {
          if (took < whole) placeCarry = 0
          S.setBag(state.bag - Math.min(n, Math.max(1, Math.ceil(took / mult))))
          S.placedBlocks(took)
          luckyDrop(S.rollLucky(took))
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
        game.placeWide(S.trowelMul())
        if (S.upgradeValue('hands') > 1) game.handsZap()
      }
    } else buildStatus = 'far'
  } else {
    buildAcc = 0
    placeCarry = 0
  }
  S.tickCombo(dt, buildStatus === 'build')
  // Coin Combo: a rising tick for every quarter of the bar, a fanfare at the top, a drop when it runs out.
  const comboTier = S.comboMax() > 1 ? Math.floor(S.comboFill() * 4 + 1e-6) : 0
  if (comboTier > lastComboTier) game.comboStep(comboTier, comboTier === 4)
  else if (comboTier === 0 && lastComboTier > 0) game.comboLost()
  lastComboTier = comboTier
  // Floating "+N" numbers, batched.
  popT -= dt
  if (popAcc > 0 && popT <= 0) {
    popAtPlayer(`+${S.short(popAcc)}`, onRoof ? '#ffd23a' : '#ffffff')
    popAcc = 0
    popT = 0.35
  }

  // --- World systems.
  const ride = elevator.update(dt, elapsed, player)
  const lobbyRide = lobby.update(dt, elapsed)
  // Inside the open building: Strength and Speed tick up by themselves (5X).
  const inside = !training && lobby.contains(player.position)
  if (inside) {
    insideT += dt
    if (insideT >= INSIDE.every) {
      insideT -= INSIDE.every
      insideReward()
    }
  } else insideT = INSIDE.every * 0.5
  const night = dayNight.update(dt)
  if (Math.abs(night - lastNight) > 0.01) {
    lastNight = night
    world.setNight(night)
    const lamp = lighting.getLampFactor()
    pit.bulbs.emissiveIntensity = 0.3 + lamp * 3
    site.bulb.emissiveIntensity = 0.3 + lamp * 3
  }
  const ev = events.update(dt)
  tower.sync(net.towerState(), net.serverNow()) // follow the room's tower (a no-op until it changes / offline)
  tower.update(dt, elapsed, night)
  nextReel.update(dt)
  roofSparks.position.y = tower.visibleTop
  roofSparks.visible = tower.phase === 'building'
  cranes.update(dt, elapsed)
  site.setReady(site.kiosks.invite, invite.ready()) // a "CLAIM!" tag over the sign while a reward waits
  site.update(dt, elapsed)
  pit.update(dt, elapsed)
  hall.update(dt, elapsed)
  spinStage.update(dt, elapsed)
  followers.update(dt, elapsed, player.renderPosition, player.facing, Math.hypot(player.velocity.x, player.velocity.z) > 1, playerGroup.visible && !training)
  gym.update(dt, elapsed, training?.st)
  robotHall.update(dt, elapsed)
  robots.update(dt, elapsed, { building: buildStatus === 'build', collecting: inPit && state.bag < cap, training: !!training })
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
  if (gx === null && !training && tower.lobby && !inside && player.position.y < 2) {
    const s = lobby.spots() // the open building's door
    if (s) {
      gx = s.out.x
      gy = 6.5
      gz = s.out.z
    }
  }
  guide.visible = gx !== null && !anyWindowOpen() && !finale.active
  if (guide.visible) {
    guide.position.set(gx, gy + Math.sin(elapsed * 4) * 0.4, gz)
    guide.rotation.y = elapsed * 2
  }

  // --- Prompts, HUD, status.
  interact.update(camera, training ? null : player.position)
  pets.update(camera, training ? null : player.position, !!training)
  const t = tower.progress()
  hud.ride(lobbyRide ?? ride)
  hud.notice(tower.lobby && !inside && !lobby.riding && player.position.y < 2 ? 'The building is complete! Go inside!' : null)
  if (training) {
    hud.status('GYM', training.st.kind === 'strength' ? 'Training Strength' : 'Training Speed', 'Tap LIFT! (or Space) to go faster · E to stop')
    hud.alert(null)
  } else if (ride.riding || lobby.riding) {
    hud.status(null)
    hud.alert(null)
  } else if (tower.phase !== 'building') {
    if (inside) hud.status(`${INSIDE.mult}X`, 'Training Inside', 'Strength and Speed go up while you stay')
    else if (tower.lobby) hud.status('GO', 'Building complete!', `Go inside for ${INSIDE.mult}X Strength and Speed`)
    else hud.status('DONE', 'Building complete!', 'A new building starts soon')
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
  hud.update(dt, {
    cash: state.cash,
    speed: state.speed,
    walk: player.walkSpeed,
    strength: state.strength,
    bag: Math.floor(state.bag),
    cap,
    buildings: state.buildings,
    rankIdx: S.rankIndex(),
    totalBlocks: state.totalBlocks,
    tower: { ...t, name: tower.spec.def.name, openLeft: tower.lobby ? tower.openLeft : null, next: tower.sinking },
    event: ev,
    nextEvent: events.nextIn(),
    passes: state.passes,
    freeReady: rewardsUi.freeReady(),
    dailyReady: rewardsUi.anyReady(),
    timed: S.timedList(),
    eta,
    muted: isMuted(),
    spins: state.spins.normal + state.spins.golden,
    combo: S.comboMul(),
    comboMax: S.comboMax(),
  })
  dress?.setFill(state.bag / Math.max(1, cap), cap > 120 ? Math.min(3, Math.log2(cap / 120) + 0.5) : 0)

  // Leaderboard + windows.
  board.update(dt, [{ name: myName(), strength: state.strength, speed: state.speed, blocks: state.totalBlocks, cash: state.cash, buildings: state.buildings, playtime: state.playtime }], myName())
  refreshT -= dt
  if (refreshT <= 0) {
    refreshT = 1
    windows.setBlocksPerMin(bpm)
    if (windowsDirty) {
      windowsDirty = false
      windows.refresh()
      spinWin.refresh()
      pets.refresh()
    }
  }

  updateAudio(dt, { player: { grounded: player.grounded, vy: player.velocity.y }, windowOpen: anyWindowOpen(), locked: player.locked })
  updateCamera(camera, dt)
  if (import.meta.env.DEV && window.__view) {
    const v = window.__view // dev: __game.view([x, y, z], [tx, ty, tz]) / __game.view(null)
    camera.position.set(...v[0])
    camera.lookAt(...v[1])
  }
  finale.update(dt) // the Top Builders show drives the camera while it runs
  lighting.update(dt, playerGroup.position)
  nightLights.update(dt, { group: playerGroup, avatar, facing: player.facing, gearOn: state.gear.on })
  postfx.render()

  // Save.
  saveT += dt
  if (saveT > SAVE.every) {
    saveT = 0
    state.tower = tower.toSave()
    net.saveNow()
  }

  if (shownLoading) {
    readySince += dt
    if (avatarReady || readySince > 5) {
      shownLoading = false
      bloxity.notifyFirstFrame()
      offlineUi.arm()
    }
  }
}

let wiping = false // reset(): the save is gone, do not write it back on the way out
window.addEventListener('beforeunload', () => {
  if (!wiping) {
    state.tower = tower.toSave()
    net.saveNow(true)
  }
  bloxity.teardown()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !wiping) {
    state.tower = tower.toSave()
    net.saveNow(true)
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
    lobby,
    gym,
    // Finished buildings (opens gym pads with their unlock burst).
    buildings: (n) => {
      state.buildings = n
      S.emit('buildings', 0)
    },
    give: (r) => S.grant(r),
    view: (from, to) => (window.__view = from ? [from, to] : null),
    blocks: (n) => tower.addBlocks(n),
    // Plays the Next Building reel for building n (default: the next one) without touching the tower.
    reel: (n) => nextReel.show(n ?? tower.spec.n + 1),
    // Finish the building yourself (credited to you): the Top Builders finale follows.
    finish: () => tower.addBlocks(1e15, meWho),
    finale,
    spins: (n = 10) => S.addSpins('normal', n),
    pet: (id, tier = 0) => S.addPet(id, tier, { force: true }),
    robots,
    // Dev: own + wear a Robot Gear piece (null takes it off).
    gear: (id) => {
      if (id) state.gear.owned[id] = true
      S.wearGear(id)
    },
    remotes,
    invite, // invite.open() / invite.ready(); net.invite holds the server's view
    emotes, // emotes.playClip({ len, loop, tracks }) plays a clip on your avatar
    reset: () => {
      wiping = true
      S.resetSave()
      location.reload()
    },
    LAYOUT,
  }
}
