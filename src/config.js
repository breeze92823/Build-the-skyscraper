// Every tunable constant lives here; the rest of src/ holds no theme values.

// --- Identity -------------------------------------------------------------
export const GAME_SLUG = 'build-the-skyscraper' // slug registered on bloxity.io
export const GAME_TITLE = 'Build the Skyscraper'

// Forces the Bloxity SDK and avatar CDN to be treated as unavailable (see .env.example).
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

// --- World (metres: +X east, +Z south, +Y up) -------------------------------
export const GROUND_Y = 0
// Spawn on the central plaza, facing the tower (PI = toward -Z, north).
export const SPAWN = { x: 0, y: 0.05, z: 20 }
export const SPAWN_FACING = Math.PI

// --- Player modes (modes.js) -------------------------------------------------
// 'character' = third-person chase cam with the avatar on screen.
// 'player' = first-person, the camera is the player's eyes and the avatar is hidden.
export const MODES = ['character', 'player']
export const START_MODE = 'character'

// --- Physics (physics.js, player.js) ------------------------------------------
export const PHYSICS = {
  gravity: -22, // m/s^2 for dynamic bodies and the player
  fixedStep: 1 / 60, // s per physics tick; rendering interpolates between ticks
  maxSubSteps: 5, // a long frame never runs more ticks than this
  walkSpeed: 8, // m/s
  sprintSpeed: 14, // m/s with Shift held
  accel: 70, // m/s^2 toward the target velocity on the ground
  airAccel: 22, // m/s^2 steering while airborne
  decel: 60, // m/s^2 when no key is held
  turnSpeed: 12, // rad/s the body turns toward its heading
  jumpSpeed: 8.5, // m/s
  coyoteTime: 0.1, // s after leaving a ledge a jump still counts
  jumpBuffer: 0.12, // s a jump pressed before landing is remembered
  stepHeight: 0.45, // m autostep
  maxSlope: 50, // degrees the player can walk up
  snapToGround: 0.4, // m the controller stays glued to downward steps and slopes
  pushMass: 80, // kg the character weighs when shoving crates
  killY: -6, // sank this far: respawn
}
export const PLAYER_DIMS = { radius: 0.75, height: 1.8 } // capsule the character controller moves

// --- Look ------------------------------------------------------------------
export const RENDER = { exposure: 1.0 }
export const FOG = { near: 220, far: 900 }
// The two lighting moods lighting.js blends between (key N toggles).
export const TIME_OF_DAY = {
  transition: 2.5, // s to blend day <-> night
  day: {
    zenith: '#1576f0',
    horizon: '#a9e2ff',
    sunColor: '#fff4de',
    // Sun + hemi + env together keep the pale sand (#eed39c) near its own tan;
    // much more and ACES washes it (and the props) out to grey-white.
    sunIntensity: 2.4,
    sunElevation: 55, // degrees above the horizon
    sunAzimuth: 35, // degrees, 0 = from +Z
    hemiSky: '#e4f2ff',
    hemiGround: '#e0a86a',
    hemiIntensity: 0.8,
    envIntensity: 0.45,
    lampIntensity: 0,
    stars: 0,
    exposure: 0.95,
  },
  night: {
    zenith: '#050b22',
    horizon: '#24345e',
    sunColor: '#9fb4ff', // the moon
    sunIntensity: 0.55,
    sunElevation: 38,
    sunAzimuth: -60,
    hemiSky: '#3a4c80',
    hemiGround: '#1a1a22',
    hemiIntensity: 0.35,
    envIntensity: 0.25,
    lampIntensity: 30,
    stars: 1,
    exposure: 1.15,
  },
  // Sunset / sunrise, blended between day and night (lighting.js setNight 0.5).
  dusk: {
    zenith: '#3d5fb8',
    horizon: '#ffae6b',
    sunColor: '#ffb070',
    sunIntensity: 1.6,
    sunElevation: 9,
    sunAzimuth: 70,
    hemiSky: '#ffd2b0',
    hemiGround: '#a8784a',
    hemiIntensity: 0.6,
    envIntensity: 0.4,
    lampIntensity: 12,
    stars: 0.15,
    exposure: 1.0,
  },
}
export const LIGHT = {
  shadowRange: 45, // half-width of the sun's shadow box around the player
  lampColor: '#ffb35c',
  lampDistance: 22,
}

// Default (fallback) character look, used only when player.glb cannot load.
export const CHARACTER_COLORS = { skin: '#f2c79a', suit: '#2f6fd0', hair: '#4a2f1c' }

export const MATERIAL_PBR = {
  PLAYER: { roughness: 0.7, metalness: 0 },
  GROUND: { roughness: 0.95, metalness: 0 },
}

// --- Graphics presets, picked by the Bloxity graphics_quality setting ----------
export const GRAPHICS_PRESETS = {
  Low: { shadows: false, shadowMap: 512, antialias: false, dpr: 1, bloom: false, particles: 0.35 },
  Medium: { shadows: true, shadowMap: 1024, antialias: false, dpr: 1.25, bloom: false, particles: 0.6 },
  High: { shadows: true, shadowMap: 2048, antialias: true, dpr: 2, bloom: true, particles: 1 },
  Ultra: { shadows: true, shadowMap: 4096, antialias: true, dpr: 2, bloom: true, particles: 1 },
}

// Bloom (postfx.js): only HDR-bright pixels (above threshold, linear, before
// tone mapping) glow: neon rails, waterfall, VIP gate, particles. Sunlit sand
// stays under the threshold.
export const BLOOM = { strength: 0.6, radius: 0.35, threshold: 2.0 }
// Neon materials (propkit.js): k = HDR colour multiplier with bloom on; with
// bloom off they are capped at plainMax so they stay coloured, not white.
export const NEON = { k: 3.5, plainMax: 1.2 }

// Phones and tablets default to a lighter preset when the portal sends no value,
// and any preset is capped there (a phone at DPR 3 renders 9x the pixels; bloom
// is a full-screen multi-pass blur, so it stays off on phones).
export const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const DEFAULT_GRAPHICS = COARSE_POINTER ? 'Medium' : 'High'
export const MOBILE_GRAPHICS_CAP = { dpr: 1.5, shadowMap: 1024, particles: 0.6 }

// The preset to render with on this device.
export function graphicsPreset(name) {
  const p = GRAPHICS_PRESETS[name] ?? GRAPHICS_PRESETS[DEFAULT_GRAPHICS]
  if (!COARSE_POINTER) return p
  const cap = MOBILE_GRAPHICS_CAP
  return { ...p, dpr: Math.min(p.dpr, cap.dpr), shadowMap: Math.min(p.shadowMap, cap.shadowMap), bloom: false, particles: Math.min(p.particles, cap.particles) }
}

// --- Touch controls (touch.js) --------------------------------------------------
export const TOUCH = {
  deadZone: 0.12, // fraction of the joystick radius that does nothing
  lookScale: 1.5, // touch drag pixels -> look, relative to a mouse pixel
  pinchPixelsPerNotch: 30, // finger spread change that equals one wheel notch
}

// --- Camera (camera.js) -------------------------------------------------------
export const CAMERA = {
  fov: 70,
  near: 0.1,
  far: 2400,
  startPitch: 0.38, // radians above the horizon (looking down a little on the site)
  minPitch: -0.35,
  maxPitch: 1.25,
  firstPersonPitch: 1.45, // |pitch| limit looking up/down in player mode
  eyeHeight: 0.92, // eye height as a fraction of player height (player mode)
  distance: 15, // resting boom length, m
  minDistance: 2.5, // wheel in past this enters player mode
  maxDistance: 60,
  followLerp: 14, // 1/s: the one smoothing stage, on the point the camera follows
  targetHeight: 1.2, // look-at point as a fraction of player height
  lookSensitivity: 0.0026, // rad per pixel of mouse movement
  zoomStep: 0.9, // m per wheel notch
  zoomEase: 12, // 1/s the zoom glides to its target
  speedFov: 6, // degrees the FOV widens at sprint speed
  speedEase: 3, // 1/s the speed framing eases in and out
  clearEase: 6, // 1/s the boom eases back out once a wall stops blocking it
}

// --- Bloxity (bloxity.js, avatar/) -------------------------------------------------
// SDK setting keys this game listens for; registering a listener makes the control
// appear in the portal's settings menu.
export const SETTINGS = {
  graphics_quality: { def: DEFAULT_GRAPHICS, type: 'enum', values: ['Low', 'Medium', 'High', 'Ultra'] },
  camera_sensitivity: { def: '1', type: 'number', min: 0.1, max: 5 },
  show_fps: { def: 'false', type: 'bool' },
  fullscreen: { def: 'false', type: 'bool' },
}

// The base rig, measured from player.glb: origin at the feet, 6.4 units tall at bind pose.
export const RIG_HEIGHT = 6.4
// Bind-pose values of the rig nodes the SDK proportions drive.
export const RIG = { armOffsetX: 2, legOffsetX: 0.6, neckOffsetY: 0.6 }
// getProportions() ranges, straight from the SDK spec; clamped before they reach the scene graph.
export const PROPORTIONS = {
  height: { def: 1, min: 0.5, max: 1.6 },
  shoulderWidth: { def: 1, min: 0.5, max: 1.5 },
  armLength: { def: 1, min: 0.05, max: 3 },
  legOffsetX: { def: 1, min: -0.7, max: 5 },
  torsoScaleX: { def: 1, min: 0.3, max: 2 },
  neckHeight: { def: 1, min: 0.94, max: 1.2 },
  headScale: { def: 1, min: 0.3, max: 2.6 },
}

// Procedural animation (avatar/animator.js), ported from Clean Leaves for Loot.
// Rotations are radians in CHARACTER space: +X swings a limb backward, +Y yaws, +Z rolls.
const deg = (d) => (d * Math.PI) / 180
export const ANIM = {
  airborneDelay: 0.07, // s off the ground before the air pose (ignores a step down a ledge)
  // Walk -> run is one cycle at two depths; phase advances with distance travelled.
  locomotion: {
    minFrequency: 0.7,
    maxFrequency: 3.6,
    strideDistance: 3.8, // m per cycle
    idleSpeed: 0.6,
    walkSpeed: 2.5,
    runSpeed: 8,
    sprintSpeed: 13,
    hipSwing: { walk: deg(22), run: deg(42), sprint: deg(56) },
    kneeBend: { walk: deg(30), run: deg(58), sprint: deg(72) },
    armSwing: { walk: deg(18), run: deg(36), sprint: deg(52) },
    elbowBend: { walk: deg(14), run: deg(44), sprint: deg(70) },
    torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
    torsoLean: { walk: deg(3), run: deg(10), sprint: deg(18) },
    headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
    torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
    bob: { walk: 0.03, run: 0.07, sprint: 0.09 }, // m, on the avatar root
    bankAngle: deg(9),
    bankRate: 8,
  },
  idle: {
    breathFrequency: 0.35,
    breathAmount: deg(1.8),
    breathBob: 0.007,
    basePose: {
      ArmL1: { x: deg(-4), z: deg(8) },
      ArmL2: { x: deg(12) },
      ArmR1: { x: deg(-4), z: deg(-8) },
      ArmR2: { x: deg(12) },
      LegL1: { x: deg(-4) },
      LegR1: { x: deg(4) },
    },
  },
  airborne: {
    rise: {
      LegL1: { x: deg(-38) }, LegR1: { x: deg(8) }, LegL2: { x: deg(62) }, LegR2: { x: deg(40) },
      ArmL1: { x: deg(-40), z: deg(34) }, ArmR1: { x: deg(-30), z: deg(-34) },
      ArmL2: { x: deg(30) }, ArmR2: { x: deg(30) }, Spine1: { x: deg(6) },
    },
    fall: {
      LegL1: { x: deg(-14) }, LegR1: { x: deg(10) }, LegL2: { x: deg(22) }, LegR2: { x: deg(18) },
      ArmL1: { x: deg(-70), z: deg(40) }, ArmR1: { x: deg(-60), z: deg(-40) },
      ArmL2: { x: deg(20) }, ArmR2: { x: deg(20) }, Spine1: { x: deg(-4) },
    },
    velocityReference: 8, // m/s vertical speed that reads as fully rising / falling
  },
  landing: {
    duration: 0.16,
    pose: {
      LegL1: { x: deg(-34) }, LegR1: { x: deg(-34) }, LegL2: { x: deg(58) }, LegR2: { x: deg(58) },
      ArmL1: { x: deg(-18), z: deg(20) }, ArmR1: { x: deg(-18), z: deg(-20) }, Spine1: { x: deg(14) },
    },
    bobY: -0.2,
  },
  transitions: { toLocomotion: 0.14, toAirborne: 0.12, toLanding: 0.06 }, // s to blend a pose change
}

export const FONT_FAMILY = 'Fredoka'

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

// Coerce one raw SDK string against its SETTINGS entry.
export function coerceSetting(key, raw) {
  const spec = SETTINGS[key]
  if (!spec) return raw
  const value = raw === '' || raw == null ? spec.def : raw
  if (spec.type === 'bool') return value === 'true' || value === true
  if (spec.type === 'enum') return spec.values.includes(value) ? value : spec.def
  const n = Number(value)
  return clamp(Number.isFinite(n) ? n : Number(spec.def), spec.min, spec.max)
}

// =====================================================================================
// Build the Skyscraper: game tunables
// =====================================================================================

// --- Save ---------------------------------------------------------------------------
export const SAVE = { key: 'build-the-skyscraper.save.v1', every: 5 } // s between autosaves

// --- Day / night cycle (daynight.js) ----------------------------------------------------
// Real seconds per phase. lighting.setNight: 0 = day, 0.5 = dusk/dawn, 1 = night.
// N skips ahead to the next phase.
export const DAYNIGHT = { day: 300, dusk: 35, night: 120, dawn: 35, startAt: 40 }

// --- Desert + compound layout (world.js, site.js) ------------------------------------------
export const DESERT = {
  size: 2600, // ground plane edge, m
  segments: 200,
  flatRadius: 175, // flat around the compound, dunes start past this
  duneHeight: 18,
  sandTile: 22, // m per sand ripple tile
  sand: '#eba45c',
  sandDark: '#c9773a',
  sandLight: '#ffd391',
  mesaColor: '#b8673a',
  mesaRing: [420, 560], // distance band of the mesas
  oasis: { x: -235, z: -200, r: 48 },
}
export const COMPOUND = {
  minX: -130, maxX: 130, minZ: -150, maxZ: 112, // fence rectangle
  gateHalf: 9, // road gate in the south fence (x = 0)
  fenceHeight: 3.2,
}
// Everything you can walk to (world x/z).
export const LAYOUT = {
  plaza: { x: 0, z: 10, r: 14 },
  tower: { x: 0, z: -72 },
  pit: { x: -60, z: 14, w: 34, d: 26, zoneW: 18, zoneD: 13 },
  // Gym: an east-west walkway (z) starting at x0; pads every `spacing` m on both sides.
  gym: { x0: 54, z: 8, spacing: 13, offset: 12, pad: 11 },
  upgrades: { x: 26, z: 40 },
  shop: { x: -26, z: 40 },
  leaderboard: { x: 0, z: 76 },
  roads: [
    // [x1, z1, x2, z2, width]
    [-126, 50, 126, 50, 10], // east-west road south of the plaza
    [0, 50, 0, 116, 10], // to the gate
    [-118, -128, -118, 50, 9], // west service road
    [118, -128, 118, 50, 9], // east service road
    [-118, -128, 118, -128, 9], // north road behind the tower
  ],
}

// --- Tower (tower.js) -------------------------------------------------------------------
export const TOWER = {
  floorHeight: 4,
  slab: 0.55, // the white band at the bottom of each floor
  foundation: 0.4, // concrete pad the first floor stands on (walkable step)
  cell: 2.2, // roof grid cell for placed blocks
  block: 1.9, // placed block size
  roofEdge: 1.1, // invisible parapet height at the roof edge (gaps at the exits)
  floorBonus: 12, // cash x floor number to the player when a floor they helped on completes
  buildingBonus: 2500, // cash x building number when a tower is finished
  celebrate: 9, // s the finished tower stands before it is cleared away
  sinkTime: 3.2, // s it takes to sink into the sand
}
// Building n (0-based) uses BUILDINGS[n % length] for its look and gets taller and
// heavier each time: floors = floorsBase + n * floorsPer (max floorsMax); blocks per floor =
// blocksBase * blockGrowth^n * (1 + floor * floorGrowth).
export const BUILDING_SCALE = { floorsBase: 18, floorsPer: 6, floorsMax: 70, blocksBase: 220, blockGrowth: 2.15, floorGrowth: 0.05 }
export const BUILDINGS = [
  { name: 'Crystal Spire', shape: 'chamfer', size: 21, glass: '#3fd3e6', frame: '#e9f7ff', slab: '#ffffff', base: '#6b3fd1', crown: 'spire' },
  { name: 'Wave Towers', shape: 'blob', size: 24, glass: '#3f7ff0', frame: '#dfe9ff', slab: '#f4f7ff', base: '#2b3f8f', crown: 'dome' },
  { name: 'Golden Hex', shape: 'hex', size: 22, glass: '#f0b43a', frame: '#fff4d6', slab: '#fff8ea', base: '#7a3d12', crown: 'spire' },
  { name: 'Emerald Round', shape: 'round', size: 20, glass: '#35d68a', frame: '#e6fff1', slab: '#ffffff', base: '#155e46', crown: 'ring' },
  { name: 'Ruby Cross', shape: 'cross', size: 23, glass: '#f0566f', frame: '#ffe6ea', slab: '#fff5f6', base: '#6d1424', crown: 'spire' },
  { name: 'Violet Star', shape: 'star', size: 24, glass: '#a45cff', frame: '#f1e6ff', slab: '#ffffff', base: '#341266', crown: 'dome' },
]

// --- Elevator + stairs (elevator.js, stairs.js) ------------------------------------------
export const ELEVATOR = {
  centerX: -11, // the double shaft: your cage east, the crew cage west
  cage: 4.4, // cage width / depth
  mast: 1.3,
  board: 0.7, // s standing in the cage before the doors close
  baseSpeed: 9, // m/s at Elevator Speed level 0
  doors: 0.45, // s the doors take
  botWait: 3.5, // s the crew cage waits at each end
}
// Switchback stair tower east of the shaft: one floor = two flights.
export const STAIRS = { x0: 7, flight: 5.6, width: 2.2, landing: 2.4 }

// --- Player stats (stats.js) -----------------------------------------------------------------
export const STATS = {
  startStrength: 10,
  startSpeed: 0,
  capacity: (strength) => Math.floor(8 + 2.2 * Math.pow(strength, 0.75)),
  walkSpeed: (speed) => Math.min(34, 7 + 3.3 * Math.log(1 + speed / 20)), // m/s
  sprintMul: 1.35,
  fillTime: 7, // s to fill a full bag at Block Grab level 0
  buildTime: 7, // s to empty a full bag into the tower at Build Speed level 0
  minRate: 4, // blocks/s, never slower than this
  // Body bulk from Strength: 1 at the start, 1.75 at ~20K.
  muscle: (strength) => 1 + 0.75 * Math.min(1, Math.max(0, Math.log10(strength / 10) / 3.3)),
}

// --- Upgrades (upgrade station + window) ---------------------------------------------
// value(level) is what the upgrade does; price(level) is the cash for the NEXT level.
export const UPGRADES = [
  { id: 'grab', name: 'Block Grab', desc: 'Fill your bag faster in the pit', max: 25, value: (l) => 1 + l * 0.22, unit: 'x', price: (l) => Math.round(60 * Math.pow(1.55, l)) },
  { id: 'build', name: 'Build Speed', desc: 'Place your blocks faster', max: 25, value: (l) => 1 + l * 0.22, unit: 'x', price: (l) => Math.round(80 * Math.pow(1.55, l)) },
  { id: 'range', name: 'Build Range', desc: 'Build from further away', max: 20, value: (l) => 12 + l * 3.5, unit: 'm', price: (l) => Math.round(70 * Math.pow(1.6, l)) },
  { id: 'lift', name: 'Elevator Speed', desc: 'Ride your elevator faster', max: 20, value: (l) => 9 * (1 + l * 0.3), unit: 'm/s', price: (l) => Math.round(90 * Math.pow(1.55, l)) },
]

// --- Gym (gym.js) ----------------------------------------------------------------------------
// Each pad has a bench press (Strength) and a treadmill (Speed). `need` = buildings finished
// to use it; premium pads unlock for good with cash (`price`), never gems.
export const GYM = {
  repEvery: 0.55, // s between automatic reps
  tapBoost: 0.2, // s a tap / click knocks off the next rep
  tiers: [
    { mult: 1, label: 'FREE', color: '#dfe6ee', need: 0 },
    { mult: 2, label: '2x', color: '#ffd23a', need: 1 },
    { mult: 5, label: '5x', color: '#35c8ff', need: 3 },
    { mult: 10, label: '10x', color: '#b04dff', need: 8 },
    { mult: 25, label: '25x', color: '#ff4a3a', need: 15 },
    { mult: 50, label: '50x', color: '#2bd96b', need: 25 },
    { mult: 75, label: '75x', color: '#ff7a1a', need: 50 },
    { mult: 100, label: '100x', color: '#3b6dff', need: 100 },
    { mult: 250, label: '250x ELITE', color: '#ff3dc8', price: 2500000 },
    { mult: 500, label: '500x LEGEND', color: '#ffc21a', price: 12000000 },
  ],
}

// --- Ranks -------------------------------------------------------------------------------------
// `at` = total blocks placed. Each rank above the first adds RANK_CASH_BONUS to cash earned.
export const RANK_CASH_BONUS = 0.03
export const RANKS = [
  { name: 'Laborer', at: 0, color: '#c9ccd2' },
  { name: 'Hod Carrier', at: 100, color: '#e2cfa6' },
  { name: 'Apprentice', at: 300, color: '#7ee07a' },
  { name: 'Bricklayer', at: 700, color: '#ff8a5c' },
  { name: 'Carpenter', at: 1500, color: '#ffb35c' },
  { name: 'Scaffolder', at: 3000, color: '#ffc04d' },
  { name: 'Welder', at: 5500, color: '#ffd23a' },
  { name: 'Mason', at: 9000, color: '#efe6c8' },
  { name: 'Chief Mason', at: 15000, color: '#ffe27a' },
  { name: 'Steelworker', at: 25000, color: '#7fc4ff' },
  { name: 'Crane Operator', at: 40000, color: '#ffe23a' },
  { name: 'Foreman', at: 65000, color: '#5fe39a' },
  { name: 'Site Supervisor', at: 100000, color: '#4ee0c8' },
  { name: 'Site Manager', at: 160000, color: '#59c6ff' },
  { name: 'Engineer', at: 250000, color: '#6f9dff' },
  { name: 'Chief Engineer', at: 400000, color: '#8f7dff' },
  { name: 'Architect', at: 650000, color: '#b27dff' },
  { name: 'Master Architect', at: 1000000, color: '#ff7ad9' },
  { name: 'Master Builder', at: 1750000, color: '#ff5f7a' },
  { name: 'Sky Legend', at: 3000000, color: '#ff6b8b', theme: 'sky' },
  { name: 'Cloud Walker', at: 5000000, color: '#ffffff', theme: 'cloud' },
  { name: 'Sky Titan', at: 8000000, color: '#8fd3ff', theme: 'titan' },
  { name: 'Tower Lord', at: 12000000, color: '#ffbf3a', theme: 'fire' },
  { name: 'Steel Emperor', at: 20000000, color: '#e6edf6', theme: 'steel' },
  { name: 'Star Builder', at: 35000000, color: '#ffd76a', theme: 'gold' },
  { name: 'Orbit Architect', at: 60000000, color: '#e2b8ff', theme: 'orbit' },
  { name: 'Galaxy Builder', at: 100000000, color: '#cdbcff', theme: 'galaxy' },
  { name: 'Cosmic Legend', at: 175000000, color: '#ffa3d9', theme: 'cosmic' },
  { name: 'Universe Maker', at: 300000000, color: '#7dffe0', theme: 'aurora' },
  { name: 'Infinity Builder', at: 500000000, color: '#ffffff', theme: 'infinity' },
]

// --- Shop: everything costs cash (the game sells nothing for gems or real money) --------------------
export const SHOP = {
  passes: [
    { id: 'str2', name: '2x Strength', desc: 'Double Strength from every rep, forever', price: 40000, icon: 'strength' },
    { id: 'spd2', name: '2x Speed', desc: 'Double Speed from every run, forever', price: 30000, icon: 'speed' },
    { id: 'cash2', name: '2x Cash', desc: 'Double the cash from every block', price: 75000, icon: 'cash' },
    { id: 'bag2', name: 'Big Bag', desc: '+50% bag capacity, forever', price: 120000, icon: 'bag' },
  ],
  // Instant blocks straight into the tower (they count for your rank too); priced a little
  // above the cash those blocks would pay.
  boosts: [
    { blocks: 1000, price: 1500, color: 'green' },
    { blocks: 5000, price: 7000, color: 'orange' },
    { blocks: 10000, price: 13000, color: 'red' },
    { blocks: 50000, price: 60000, color: 'purple' },
  ],
}

// --- Free gift + daily rewards ------------------------------------------------------------------
export const GIFT = { every: 8 * 60 } // s of play between free gifts
export const DAILY = [
  { cash: 250 },
  { cash: 600 },
  { strength: 150 },
  { cash: 1500 },
  { speed: 120 },
  { cash: 4000 },
  { cash: 10000, strength: 500 },
]

// --- Crew (playing with friends) ----------------------------------------------------------------
// Workers you add to your crew (E next to one) each add `bonus` cash, up to `max` of them.
export const CREW = { bonus: 0.1, max: 5, radius: 4.5 }

// --- World events (events.js) -------------------------------------------------------------------
export const EVENTS = {
  length: 180, // s an event runs
  gap: 420, // s between events
  list: [
    { id: 'cash', name: 'CASH RUSH', desc: '2x cash', color: '#3bff7a', cash: 2 },
    { id: 'gym', name: 'IRON HOUR', desc: '2x gym gains', color: '#ff9a3b', gym: 2 },
    { id: 'build', name: 'TURBO BUILD', desc: '2x build + grab speed', color: '#3bc8ff', build: 2 },
    { id: 'void', name: 'VOID STORM', desc: '2x cash and gym gains', color: '#b45cff', cash: 2, gym: 2 },
  ],
}

// --- Crew workers (bots.js): the rest of the "server", building the same tower -------------------
export const BOTS = {
  names: ['BrickByBrick_77', 'sandy_hardhat', 'CraneQueen', 'mortar_mike', 'ToweringTina', 'rebar_rex', 'SkyHook99'],
  walkSpeed: [7.5, 11], // m/s
}

// --- Audio (audio/core.js) -------------------------------------------------------------------------
export const AUDIO = {
  volume: 0.8,
  storageKey: 'build-the-skyscraper.sound',
  buses: { ui: 0.8, sfx: 0.9, amb: 0.5, engine: 0.45 },
  duck: 0.45,
  maxVoices: 48,
  maxVoicesTouch: 24,
  latency: 0.04,
  latencyTouch: 0.07,
  lead: 0.02,
  reverb: { seconds: 1.8, preDelay: 0.012, early: [[19, 0.5], [31, 0.35], [47, 0.28], [73, 0.2], [97, 0.12]], decay: 1.4, tail: 0.18, darken: 1.6, send: 0.9 },
}
// DOM particle bursts (juice.js).
export const JUICE = { coins: 16, stars: 18, sparks: 12, big: 40, touchScale: 0.55, cascade: 28 }
// Interact prompts (interact.js).
export const INTERACT = { toastSeconds: 2.2 }
