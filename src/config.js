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
export const FOG = { near: 120, far: 375 } // fully fogged just before CAMERA.far (390), so the cut-off is hidden
// Screen-size culling (detailCull.js): a part whose on-screen radius is under `px` device pixels is
// not drawn (it would be at most a pixel or two); inside the fog the limit grows by up to `fogPx`.
// `hysteresis` x the limit brings it back (no flicker at the edge). Checked every `every` frames; the
// list of parts is refreshed every `rebuildEvery` s.
export const DETAIL_CULL = { enabled: true, px: 1, fogPx: 2, hysteresis: 1.2, every: 2, rebuildEvery: 2 }
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

// Night lighting (nightLights.js), all fading in with the lamps at dusk: mobile light towers
// round the building's foot and beside the pit, floodlights on the crane masts aimed at the roof,
// spotlights on every Robot Gear pedestal, a headlamp on your hard hat and a soft glow around you
// (tinted by the gear you wear). Real lights cost on every lit pixel, so each kind has a `tier`:
// only tiers <= the preset's `nightLights` become real lights; the rest just glow (lamp heads,
// halos and fake light beams). Intensities are candela (physically based, decay 2).
export const NIGHT_LIGHTS = {
  lens: '#fff1d6', // lamp head glass
  beam: { color: '#fff3dc', opacity: 0.13 }, // fake volumetric beams
  roof: { tier: 1, color: '#fff4e2', intensity: 3200, angle: 0.62, penumbra: 0.5, above: 15 }, // crane-mast floods, aimed at the roof
  ground: { tier: 2, color: '#fff1d6', intensity: 1500, angle: 0.42, penumbra: 0.55, mast: 8.5, aimY: 14, out: 9 }, // light towers round the building (aimed at most aimY up the wall)
  pit: { tier: 2, x: -80, z: 31, intensity: 1600, angle: 0.55, penumbra: 0.5, mast: 8.5 }, // a light tower over the Blocks pit
  gear: { tier: 2, color: '#d8ecff', intensity: 1400, angle: 0.5, penumbra: 0.6, pole: 7 }, // Robot Gear hall pedestal spots
  headlamp: { tier: 0, color: '#fff6e4', intensity: 90, angle: 0.48, penumbra: 0.55, distance: 40, pitch: 0.3, reach: 8 },
  aura: { tier: 1, color: '#ffe3bf', intensity: 9, distance: 10, height: 3.2 }, // soft fill over you, gear glow colour when suited
}

// Default (fallback) character look, used only when player.glb cannot load.
export const CHARACTER_COLORS = { skin: '#f2c79a', suit: '#2f6fd0', hair: '#4a2f1c' }

export const MATERIAL_PBR = {
  PLAYER: { roughness: 0.7, metalness: 0 },
  GROUND: { roughness: 0.95, metalness: 0 },
}

// --- Graphics presets, picked by the Bloxity graphics_quality setting ----------
export const GRAPHICS_PRESETS = {
  // nightLights: which NIGHT_LIGHTS tiers become real lights (the rest only glow).
  Low: { shadows: false, shadowMap: 512, antialias: false, dpr: 1, bloom: false, particles: 0.35, nightLights: 0 },
  Medium: { shadows: true, shadowMap: 1024, antialias: false, dpr: 1.25, bloom: false, particles: 0.6, nightLights: 1 },
  High: { shadows: true, shadowMap: 2048, antialias: true, dpr: 2, bloom: true, particles: 1, nightLights: 2 },
  Ultra: { shadows: true, shadowMap: 4096, antialias: true, dpr: 2, bloom: true, particles: 1, nightLights: 2 },
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
export const MOBILE_GRAPHICS_CAP = { dpr: 1.5, shadowMap: 1024, particles: 0.6, nightLights: 1 }

// The preset to render with on this device.
export function graphicsPreset(name) {
  const p = GRAPHICS_PRESETS[name] ?? GRAPHICS_PRESETS[DEFAULT_GRAPHICS]
  if (!COARSE_POINTER) return p
  const cap = MOBILE_GRAPHICS_CAP
  return { ...p, dpr: Math.min(p.dpr, cap.dpr), shadowMap: Math.min(p.shadowMap, cap.shadowMap), bloom: false, particles: Math.min(p.particles, cap.particles), nightLights: Math.min(p.nightLights, cap.nightLights) }
}

// --- Touch controls (touch.js) --------------------------------------------------
export const TOUCH = {
  deadZone: 0.12, // fraction of the joystick radius that does nothing
  lookScale: 1.5, // touch drag pixels -> look, relative to a mouse pixel
  pinchPixelsPerNotch: 30, // finger spread change that equals one wheel notch
}

// --- Camera (camera.js) -------------------------------------------------------
export const CAMERA = {
  shakeDecay: 6, // 1/s a camera shake (shakeCamera) dies away
  fov: 70,
  near: 0.1,
  far: 390, // view distance (FOG ends just inside it); the sky dome, stars and clouds are pinned to the far plane (lighting.js pinToFarPlane) so they still show
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
  master_volume: { def: '100', type: 'number', min: 0, max: 100 }, // % of the game's own volume (AUDIO.volume)
  enable_chat: { def: 'true', type: 'bool' }, // chat bubbles over the players' heads
}

// --- Game server (net.js, ../Build-the-skyscraper-backend) --------------------------------------
// Built games never hold a socket URL: Bloxity's matchmaker picks the pod (bloxity.js
// resolveServerEndpoint). Only the dev server (`npm run dev`) talks to a local backend.
export const SERVER_URL = import.meta.env.DEV ? import.meta.env.VITE_SERVER_URL_DEV || 'ws://localhost:2567' : ''
export const NET = {
  saveEvery: 5, // s: progress goes to the server at most this often (and when the tab hides or closes)
  loadTimeout: 12, // s the loading screen waits for the server's saved progress before playing on the browser save
  retry: 2, // s before the first reconnect; doubles after each failed resolve/join...
  retryMax: 30, // ...up to this
  rejoin: 1, // s before joining again after the room closed
  poseHz: 10, // pose messages per second (repeats are skipped)
  buildEvery: 0.25, // s: blocks you place on the shared tower go up as one `build` message at most this often (backend: <= ~10/s)
  avatarMax: 3000, // chars of the avatar JSON relayed to the others (backend AVATAR_MAX_LEN)
}

// --- Bloxity leaderboards (bloxity.js define(); backend src/boxityBoards.ts reports the scores) ----
// Ids are permanent (lowercase a-z 0-9 _ -, max 32). The backend keeps the same ids/modes: blocks =
// state.totalBlocks, the rest are the state fields of the same name (playtime in seconds).
export const BLOXITY_BOARDS = [
  { id: 'blocks', label: 'Most Blocks', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'buildings', label: 'Most Buildings', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
  { id: 'strength', label: 'Most Strength', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'speed', label: 'Most Speed', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'cash', label: 'Most Cash', order: 'desc', mode: 'latest', format: 'compact', reset: 'none' },
  { id: 'playtime', label: 'Most Playtime', order: 'desc', mode: 'best', format: 'time', reset: 'none' },
]

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
  // Parachute harness (activity 'chute'): hands up on the toggles; `flare` pulls them down for touchdown.
  chute: {
    hang: {
      ArmL1: { x: deg(-150), z: deg(22) }, ArmR1: { x: deg(-150), z: deg(-22) },
      ArmL2: { x: deg(38) }, ArmR2: { x: deg(38) },
      LegL1: { x: deg(-18) }, LegR1: { x: deg(-8) }, LegL2: { x: deg(26) }, LegR2: { x: deg(34) },
      Spine1: { x: deg(-6) },
    },
    flare: {
      ArmL1: { x: deg(-62), z: deg(30) }, ArmR1: { x: deg(-62), z: deg(-30) },
      ArmL2: { x: deg(70) }, ArmR2: { x: deg(70) },
      LegL1: { x: deg(-48) }, LegR1: { x: deg(-44) }, LegL2: { x: deg(30) }, LegR2: { x: deg(34) },
      Spine1: { x: deg(8) },
    },
    blend: 0.25, // s into the harness pose
    swayRate: 0.55, // Hz the dangling legs swing
    legSway: 0.12, // rad
  },
  // Robot Gear superhero landing (activity 'impact', input.impact 0..1): front knee up, back knee down,
  // one fist on the ground, the other arm swept back; bobY drops the hips to kneel.
  impact: {
    pose: {
      LegL1: { x: deg(-92), z: deg(-6) }, LegL2: { x: deg(98) },
      LegR1: { x: deg(18), z: deg(8) }, LegR2: { x: deg(112) },
      Spine1: { x: deg(28) }, Neck1: { x: deg(-24) },
      ArmR1: { x: deg(-38), z: deg(-8) }, ArmR2: { x: deg(18) },
      ArmL1: { x: deg(42), z: deg(52) }, ArmL2: { x: deg(28) },
    },
    bobY: -0.62,
    blend: 0.05, // s into the crouch
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
  // Invite Friends kiosk (site.js, invite.js): on the same strip, between the central walkway (x -6..6)
  // and the Upgrades kiosk (x 26), clear of the lamps along z 43.5 (x 0, 22).
  invite: { x: 13, z: 40 },
  leaderboard: { x: 0, z: 76 },
  // Egg hall (eggs.js): a covered hall south of the road, entrance on its north side.
  eggs: { x: 56, z: 80 },
  // Spin wheel (spin.js): on a round stage east of the egg hall, facing north.
  spin: { x: 84, z: 70 },
  // Robot Gear hall (robotGear.js): a T-shaped neon platform south-west of the leaderboard, entrance
  // from the main road at its north end; the bar of the T is at the far (south) end.
  robot: { x: -52, z0: 57, hallW: 28, hallEnd: 90, barW: 52, barEnd: 107, limited: { x: -30, z: 67, r: 4.6 }, showcase: { x: -73, z: 72, r: 5.2, gear: 'truck' } },
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
  floorBonus: 12, // cash x floor number to the player when a floor they helped on completes...
  floorIncome: 15, // ...plus this many seconds of their own recent income PER MINUTE the floor took (main.js, 1-8 min),
  // so a long crowd floor pays as much per minute as a quick solo one and joining others never costs you
  buildingBonus: 2500, // cash x building number when a tower is finished...
  buildingIncome: 90, // ...plus this many seconds of their own recent income (both x the building's rarity bonus)
  incomeTau: 120, // s: the recent-income average those rewards (and Goals) are measured on
  celebrate: 9, // s the finished tower stands before it is cleared away
  sinkTime: 3.2, // s it takes to sink into the sand
  // Brick piles on the floor in progress: late floors need millions of blocks, so the laid blocks barely
  // move. Every block you throw lands on a pile on a pallet near the build front (other players' blocks
  // land too); a full pile gets "laid" (it flattens into the slab with dust + a thud) and starts again.
  pile: {
    count: 4, // piles on the roof
    ahead: 3, // first pile this many cells past the build front...
    spacing: 4, // ...and every `spacing` cells after it
    cols: 2, // bricks per layer: cols x rows
    rows: 3,
    layers: 6, // layers before the pile is laid
    brick: [0.86, 0.42, 0.42], // brick size (x long side, y, z)
    layTime: 0.5, // s the laid pile takes to flatten
  },
}
// Once a building is finished it stays open for `time` s: its two lowest floors become a
// lobby (lobby.js) everyone can walk into through the door on the south face. Inside, Strength
// and Speed tick up by itself: every `every` s, base x mult x the best gym pad you can use x
// your gym passes. An express elevator in the lobby core rides to a hut on the roof (and back).
// Each building's lobby look is its BUILDINGS[].lobby.
export const INSIDE = {
  time: 180, // s the finished building stays open
  mult: 5, // the "5X INSIDE" bonus
  base: 2, // stat per tick at mult 1 on the free gym pad (5X -> +10)
  every: 0.5, // s between ticks
  floors: 2, // lobby height in floors
  doorX: 0, // door centre on the south face (between the hoist and the stairs)
  doorW: 4.4, // door opening (the glass panels it overlaps are cut away)
  core: { w: 8, d: 5.6 }, // elevator core in the middle of the lobby
  cab: { w: 3.2, d: 3, h: 3.3 }, // elevator cab (lobby core and roof hut)
  doors: 0.5, // s the cab doors take
  ride: 3.2, // s the express ride takes, whatever the height
  hutClear: 7.6, // m from the roof edge kept clear of the crown (the hut + a walkway)
}
// Top Builders finale (finale.js): a few seconds after a building is finished the camera
// cuts to its top 3 builders (blocks placed on that building by the room's real players) on
// glowing podiums on the roof, #3 first, then #2, then #1 (crowned), then a wide shot of all
// three. Everyone watches (HUD hidden, you stand still or on your podium); SKIP ends it.
export const FINALE = {
  delay: 2.2, // s after the last block before the show starts (the crown pops first)
  intro: 1.3, // s establishing swoop onto the roof
  shot: 3, // s per close-up (#3, #2)
  shotTop: 3.8, // s on the #1 builder
  roll: 0.9, // s of snare roll at the start of each close-up before the name pops
  wide: 3.6, // s of the closing wide shot
  fov: 46,
  spacing: 2.7, // m between the podiums
  podium: { 1: 1.0, 2: 0.65, 3: 0.4 }, // podium height (m) per rank
  podiumR: 1.15,
  beam: 16, // m spotlight beam height above each podium
  ranks: {
    1: { color: '#ffc21a', rim: '#ffe27a', ink: '#ffb300' },
    2: { color: '#c8b6ff', rim: '#efe8ff', ink: '#b9a2ff' },
    3: { color: '#ff7a2a', rim: '#ffb37a', ink: '#ff6a1a' },
  },
}

// Building n (0-based) gets taller each time: floors = floorsBase + n * floorsPer (max floorsMax).
// A floor's size is NOT fixed: it is set ONCE, when the floor starts, so the floor takes about
// floorMinutes(builders) of the room's real building (backend tower.ts, the server's call; client tower.js in
// local play, always solo): `soloMins` (2.5) for one builder, soloMins + crowdMins * (1 - 1/N) for N (4 for
// two, ~5 for five, ~5.5 for a crowd, never over `maxMins`). So a lone player sees a floor go up every 2-3
// minutes and a crowd works longer on each one. A builder's pace = the blocks they placed over the last
// `window` s, blended in their first `window` s with one full bag (`trip`) every `tripSecs` s; a builder
// counts for `active` s after their last placement. Floor = the builders' summed blocks/min x the floor's
// minutes (never under minBase * minGrowth^n); the minutes ease `rampUp` / `rampDown` of the way toward the
// new crowd size each floor. A started floor never grows; if the room slows under `shrinkAt` of the pace it
// was sized for, only its REMAINING part shrinks. The HUD shows the floor as a percentage, never its size.
// Keep in step with the backend constants.ts.
// Its look is BUILDINGS[pickBuilding(n)] (tower.js): building 0 is always the first one, every
// later one is a weighted roll on `chance` (seeded by n, so a reload keeps the same pick),
// shown by the Next Building reel (nextBuilding.js). `rarity` is a NEXT_BUILDING.rarities key.
export const BUILDING_SCALE = { floorsBase: 8, floorsPer: 2, floorsMax: 40, soloMins: 2.5, crowdMins: 3, maxMins: 6, rampUp: 0.5, rampDown: 0.75, window: 180, tripSecs: 50, shrinkAt: 0.7, minBase: 30, minGrowth: 1.08, active: 90 }
export const BUILDINGS = [
  { name: 'Crystal Spire', rarity: 'common', chance: 26, shape: 'chamfer', size: 21, glass: '#3fd3e6', frame: '#e9f7ff', slab: '#ffffff', base: '#6b3fd1', crown: 'spire', lobby: { name: 'CRYSTAL LOUNGE', carpet: '#123a36', wall: '#16302c', accent: '#3fd3e6', wood: '#8a5a32', sofa: '#f4f1ea', lights: 'chandelier' } },
  { name: 'Wave Towers', rarity: 'common', chance: 22, shape: 'blob', size: 24, glass: '#3f7ff0', frame: '#dfe9ff', slab: '#f4f7ff', base: '#2b3f8f', crown: 'dome', lobby: { name: 'WAVE LOUNGE', carpet: '#132447', wall: '#1a2a52', accent: '#5f9bff', wood: '#6b4a2e', sofa: '#eef2fb', lights: 'ring' } },
  { name: 'Golden Hex', rarity: 'rare', chance: 13, shape: 'hex', size: 22, glass: '#f0b43a', frame: '#fff4d6', slab: '#fff8ea', base: '#7a3d12', crown: 'spire', lobby: { name: 'GOLDEN HALL', carpet: '#4a1d14', wall: '#3a1a10', accent: '#f0b43a', wood: '#9a6a30', sofa: '#fff4dc', lights: 'chandelier' } },
  { name: 'Emerald Round', rarity: 'uncommon', chance: 17, shape: 'round', size: 20, glass: '#35d68a', frame: '#e6fff1', slab: '#ffffff', base: '#155e46', crown: 'ring', lobby: { name: 'EMERALD GARDEN', carpet: '#0f3a2a', wall: '#0f2e22', accent: '#35d68a', wood: '#7a5a34', sofa: '#f2fff6', lights: 'pendant' } },
  { name: 'Ruby Cross', rarity: 'rare', chance: 10, shape: 'cross', size: 23, glass: '#f0566f', frame: '#ffe6ea', slab: '#fff5f6', base: '#6d1424', crown: 'spire', lobby: { name: 'RUBY LOUNGE', carpet: '#3d0f18', wall: '#2e0b12', accent: '#f0566f', wood: '#5a2e22', sofa: '#fff0f2', lights: 'chandelier' } },
  { name: 'Violet Star', rarity: 'epic', chance: 6.5, shape: 'star', size: 24, glass: '#a45cff', frame: '#f1e6ff', slab: '#ffffff', base: '#341266', crown: 'dome', lobby: { name: 'STAR CLUB', carpet: '#221040', wall: '#1c0d35', accent: '#b77bff', wood: '#4a2e5a', sofa: '#f6efff', lights: 'ring' } },
  { name: 'Sapphire Needle', rarity: 'legendary', chance: 4, shape: 'round', size: 19, glass: '#2f6bff', frame: '#ffe9a8', slab: '#fff8e6', base: '#14245e', crown: 'spire', lobby: { name: 'SAPPHIRE SUITE', carpet: '#0f1a45', wall: '#101a3a', accent: '#ffd25a', wood: '#7a5226', sofa: '#fff6e0', lights: 'chandelier' } },
  { name: 'Aurora Crown', rarity: 'mythic', chance: 1.5, shape: 'blob', size: 23, glass: '#ff5fd2', frame: '#fff0fb', slab: '#ffffff', base: '#4a0f4a', crown: 'ring', lobby: { name: 'AURORA CLUB', carpet: '#2a0d30', wall: '#240a2a', accent: '#ff7be0', wood: '#5a2e4a', sofa: '#fff0fa', lights: 'ring' } },
]
// The Next Building reel (nextBuilding.js): when a finished building starts sinking, a dimmed
// screen shows a vertical reel of buildings (portrait, name, chance) spinning past two arrows,
// slowing down onto the next building; then its rarity pops above it over rotating rays with
// confetti, and the new building rises once the reel closes (tower.js `hold`).
// `bonus` multiplies TOWER.buildingBonus when that building is finished (cash only).
export const NEXT_BUILDING = {
  fadeIn: 0.45, // s the screen dims and the reel slides in
  spin: 4.8, // s the reel spins (fast, then easing out onto the pick)
  items: 30, // buildings the reel passes on the way
  settle: 0.35, // s of the little overshoot-and-back at the end of the spin
  hold: 2.9, // s the reveal stays up
  fadeOut: 0.45, // s the screen clears
  rarities: {
    common: { name: 'COMMON', color: '#e9eef5', dark: '#6b7480', level: 0, bonus: 1 },
    uncommon: { name: 'UNCOMMON', color: '#5fe36a', dark: '#1f8a2c', level: 1, bonus: 1.25 },
    rare: { name: 'RARE', color: '#3ba7ff', dark: '#1b5fb8', level: 2, bonus: 1.5 },
    epic: { name: 'EPIC', color: '#36e9ff', dark: '#0b7f9e', level: 3, bonus: 2 },
    legendary: { name: 'LEGENDARY', color: '#ffc21a', dark: '#b86a00', level: 4, bonus: 3 },
    mythic: { name: 'MYTHIC', color: '#ff4fd8', dark: '#8a1478', level: 5, bonus: 5 },
  },
}

// --- Elevator + stairs (elevator.js, stairs.js) ------------------------------------------
export const ELEVATOR = {
  centerX: -11, // the double shaft: your cage east, an empty closed shaft west
  cage: 4.4, // cage width / depth
  mast: 1.3,
  board: 0.7, // s standing in the cage before the doors close
  baseSpeed: 9, // m/s at Elevator Speed level 0
  doors: 0.45, // s the doors take
}
// Switchback stair tower east of the shaft: one floor = two flights.
export const STAIRS = { x0: 7, flight: 5.6, width: 2.2, landing: 2.4 }

// --- Player stats (stats.js) -----------------------------------------------------------------
export const STATS = {
  startStrength: 10,
  startSpeed: 0,
  // ^0.6: Strength keeps paying off but no longer snowballs the economy (economy tuning, see UPGRADES).
  capacity: (strength) => Math.floor(8 + 2.2 * Math.pow(strength, 0.6)),
  walkSpeed: (speed) => Math.min(34, 7 + 3.3 * Math.log(1 + speed / 20)), // m/s
  sprintMul: 1.35,
  fillTime: 7, // s to fill a full bag at Block Grab level 0
  buildTime: 7, // s to empty a full bag into the tower at Build Speed level 0
  minRate: 4, // blocks/s, never slower than this
  // Body bulk from Strength: 1 at the start, 1.75 at ~20K.
  muscle: (strength) => 1 + 0.75 * Math.min(1, Math.max(0, Math.log10(strength / 10) / 3.3)),
}

// --- Upgrades (upgrade station + window) ---------------------------------------------
// value(level) is what the upgrade does; price(level) is the cash for the NEXT level (cash only,
// never Gems/Robux). fmt(value) is how the window shows it ("x1.25", "5%"), so a row reads
// "before >> after". `color` tints the row, `id` doubles as the icon name in hudIcons.js.
const fx = (v) => `x${(Math.round(v * 100) / 100).toFixed(2)}`
const pct = (v) => `${Math.round(v * 10) / 10}%`
// Economy curve: easy start, hard top. Each upgrade's price runs along a ladder from `first` (level 0)
// to `last` (its final level), eased by LADDER_EASE (> 1 = the early levels stay cheap and the climb
// gets steep near the top), rounded to two significant digits so prices read cleanly. Tuned with a
// Monte Carlo of the whole economy (pit trips, gym, gear, pets, eggs, spins, rewards, goals, buildings):
// an average player (1 h a day) buys ~30 things in the first 15 minutes and maxes every upgrade after
// ~37 h of play (~5 weeks); a heavy player in ~2 weeks; nothing in the game shortcuts it with money.
const LADDER_EASE = 1.5
export function ladder(first, last, max, ease = LADDER_EASE) {
  return (l) => {
    const x = max > 1 ? Math.min(1, l / (max - 1)) : 0
    const v = first * Math.pow(last / first, Math.pow(x, ease))
    const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1))
    return Math.round(v / mag) * mag
  }
}
export const UPGRADES = [
  { id: 'grab', name: 'Block Grab', desc: 'Fill your bag faster in the pit', color: 'blue', max: 25, value: (l) => 1 + l * 0.22, fmt: (v) => `${fx(v)} speed`, price: ladder(40, 1.6e12, 25) },
  { id: 'build', name: 'Build Speed', desc: 'Place blocks faster', color: 'green', max: 25, value: (l) => 1 + l * 0.22, fmt: (v) => `${fx(v)} speed`, price: ladder(30, 1.4e12, 25) },
  { id: 'range', name: 'Build Range', desc: 'Build from farther away', color: 'cyan', max: 20, value: (l) => 12 + l * 3.5, fmt: (v) => `${Math.round(v * 10) / 10} m`, price: ladder(25, 1.1e11, 20) },
  { id: 'lift', name: 'Elevator Speed', desc: 'Ride the elevator faster', color: 'yellow', max: 20, value: (l) => 9 * (1 + l * 0.3), fmt: (v) => `${fx(v / 9)} speed`, price: ladder(50, 1.6e11, 20) },
  // Lucky drops: every block you place has a Fortune Luck % chance to drop coins, Golden Touch
  // sets how many coins (each worth LUCKY.coinValue x your cash multiplier).
  { id: 'golden', name: 'Golden Touch', desc: 'More coins in every lucky drop', color: 'yellow', max: 10, value: (l) => 3 + l, fmt: (v) => `${v} coins`, price: ladder(150, 1.1e9, 10) },
  { id: 'fortune', name: 'Fortune Luck', desc: 'Blocks drop coins more often', color: 'green', max: 15, value: (l) => 5 + l, fmt: (v) => pct(v), price: ladder(200, 2.8e9, 15) },
  // Combo: keep placing and your cash multiplier climbs up to this value (see COMBO).
  { id: 'combo', name: 'Coin Combo', desc: 'Keep placing blocks: cash builds up', color: 'orange', max: 12, value: (l) => 1 + l * 0.25, fmt: (v) => fx(v), price: ladder(25000, 4.4e11, 12) },
  { id: 'trowel', name: 'Wide Trowel', desc: 'More blocks with every placement', color: 'blue', max: 10, value: (l) => 1 + l * 0.5, fmt: (v) => fx(v), price: ladder(250000, 1.1e12, 10) },
  { id: 'hands', name: 'Lightning Hands', desc: 'Place even faster (stacks with Build Speed)', color: 'orange', max: 10, value: (l) => 1 + l * 0.1, fmt: (v) => `${Math.round((v - 1) * 100)}% faster`, price: ladder(250000, 1.1e12, 10) },
]
// Lucky drops (Fortune Luck / Golden Touch): one coin is worth coinValue x cashMultiplier().
// (0.5: at max levels a lucky drop adds ~1.3x on top of the block's own cash, not ~4x.)
export const LUCKY = { coinValue: 0.5 }
// Coin Combo: while you keep placing blocks the combo fills over `ramp` s of building (from
// x1 up to the upgrade's value); it holds for `grace` s after you stop, then drains `drain`x as
// fast as it filled.
export const COMBO = { ramp: 20, grace: 3, drain: 3 }

// --- Gym (gym.js, gymKit.js) -------------------------------------------------------------------
// Each pad has a bench press (Strength) and a treadmill (Speed). `need` = buildings finished
// to use it; premium pads unlock for good with cash (`price`), never gems. `theme` picks the
// pad's floor, decor and ambient particles (GYM.themes); `frame` / `trim` / `cushion` colour
// its machines.
export const GYM = {
  repEvery: 0.55, // s between automatic reps
  tapBoost: 0.2, // s a tap / click knocks off the next rep
  beltSpeed: 4.2, // m/s the treadmill belt runs while someone is on it
  heatUp: 2.5, // 1/s a machine's glow ramps up while in use
  heatDown: 1.2, // 1/s it fades once they get off
  premiumRise: 0.8, // m the premium pads stand above the ground (two steps up from the walkway)
  unlockTime: 1.4, // s the force field takes to drop when a pad unlocks
  tiers: [
    { mult: 1, label: 'FREE', color: '#dfe6ee', need: 0, theme: 'basic', frame: '#eef1f5', trim: '#8f99a6', cushion: '#2b2e35' },
    { mult: 2, label: '2x', color: '#ffd23a', need: 1, theme: 'hazard', frame: '#ffc21a', trim: '#24252b', cushion: '#1d1e23' },
    { mult: 5, label: '5x', color: '#35c8ff', need: 3, theme: 'ice', frame: '#dff7ff', trim: '#35c8ff', cushion: '#0f3d57' },
    { mult: 10, label: '10x', color: '#b04dff', need: 8, theme: 'neon', frame: '#2a1a40', trim: '#c06bff', cushion: '#3b1763' },
    { mult: 25, label: '25x', color: '#ff4a3a', need: 15, theme: 'lava', frame: '#231a1c', trim: '#ff4a3a', cushion: '#5c0f0c' },
    { mult: 50, label: '50x', color: '#2bd96b', need: 25, theme: 'toxic', frame: '#26332b', trim: '#2bd96b', cushion: '#123d22' },
    { mult: 75, label: '75x', color: '#ff7a1a', need: 50, theme: 'solar', frame: '#4a2a12', trim: '#ff8a2a', cushion: '#5e2a08' },
    { mult: 100, label: '100x', color: '#3b6dff', need: 100, theme: 'storm', frame: '#151d40', trim: '#4f86ff', cushion: '#10204f' },
    // The premium pads are the long-term goals AFTER the upgrades (and Spin Wheel jackpots).
    { mult: 250, label: '250x ELITE', color: '#ff3dc8', price: 5e12, theme: 'elite', frame: '#1c1022', trim: '#ff3dc8', cushion: '#4d0f3d' },
    { mult: 500, label: '500x LEGEND', color: '#ffc21a', price: 5e13, theme: 'legend', frame: '#ffcf3a', trim: '#fff2b8', cushion: '#2d1d0a' },
  ],
  // Pad looks. floor: base / alt / line colours for the painted floor (textures.js
  // paintGymFloor), glow = emissive strength of its glowing lines. fx: the pad's ambient
  // particles (particles.js createEmitter options; the spawn box is the pad, `y` / `sy` its
  // height band).
  themes: {
    basic: { floor: { base: '#3d4148', alt: '#33363c', line: '#e8edf3', glow: 0 }, fx: { count: 18, life: 5, y: 1.6, sy: 1, velocity: [0, 0.25, 0], spread: [0.2, 0.1, 0.2], size: 0.09, color: '#ffffff', intensity: 1.6, opacity: 0.45, sprite: 'sparkle', twinkle: 3 } },
    hazard: { floor: { base: '#2c2d33', alt: '#24252a', line: '#ffc21a', glow: 0 }, fx: { count: 26, life: 3, y: 0.6, sy: 0.4, velocity: [0, 0.6, 0], spread: [0.3, 0.3, 0.3], size: 0.18, color: '#ffd23a', intensity: 2.2, sprite: 'sparkle', twinkle: 6 } },
    ice: { floor: { base: '#3f9fd2', alt: '#9edcf7', line: '#1fb4ff', glow: 0.9 }, fx: { count: 60, life: 6, y: 4.2, sy: 0.4, velocity: [0.15, -0.7, 0.05], spread: [0.25, 0.15, 0.25], size: 0.2, color: '#eaffff', intensity: 2, sprite: 'sparkle', twinkle: 5 } },
    neon: { floor: { base: '#1c0f2e', alt: '#2a1745', line: '#d36bff', glow: 1.6 }, fx: { count: 40, life: 3.5, y: 0.5, sy: 0.3, velocity: [0, 0.9, 0], spread: [0.25, 0.3, 0.25], size: 0.22, color: '#e07bff', intensity: 3, sprite: 'sparkle', twinkle: 7 } },
    lava: { floor: { base: '#1a1416', alt: '#2a2022', line: '#ff5a1a', glow: 2.2 }, fx: { count: 70, life: 2.6, y: 0.4, sy: 0.2, velocity: [0, 1.5, 0], spread: [0.35, 0.5, 0.35], size: 0.18, color: '#ff7a2a', intensity: 3.4, sprite: 'dot', twinkle: 9 } },
    toxic: { floor: { base: '#28322c', alt: '#1f2823', line: '#37ff7a', glow: 1.8 }, fx: { count: 45, life: 3.2, y: 0.35, sy: 0.15, velocity: [0, 0.75, 0], spread: [0.15, 0.25, 0.15], size: 0.26, color: '#4dff8a', intensity: 2.4, sprite: 'dot', twinkle: 0 } },
    solar: { floor: { base: '#3a2414', alt: '#4c3018', line: '#ffa040', glow: 1.7 }, fx: { count: 50, life: 3, y: 0.6, sy: 0.4, velocity: [0, 1.1, 0], spread: [0.4, 0.3, 0.4], size: 0.22, color: '#ffb347', intensity: 3.2, sprite: 'sparkle', twinkle: 6 } },
    storm: { floor: { base: '#141b33', alt: '#1c2645', line: '#5f9bff', glow: 2 }, fx: { count: 45, life: 1.6, y: 1.2, sy: 1, velocity: [0, 0.3, 0], spread: [1.2, 1.2, 1.2], size: 0.16, color: '#9fc4ff', intensity: 3.6, sprite: 'sparkle', twinkle: 14 } },
    elite: { floor: { base: '#3a0d33', alt: '#5a1550', line: '#ff6ad8', glow: 1.8 }, fx: { count: 60, life: 4.5, y: 5, sy: 0.3, velocity: [0, -0.9, 0], spread: [0.35, 0.2, 0.35], size: 0.22, color: '#ff8ae0', intensity: 2.8, sprite: 'sparkle', twinkle: 8 } },
    legend: { floor: { base: '#f4efe6', alt: '#ddd3c2', line: '#ffc21a', glow: 1.6 }, fx: { count: 80, life: 3.4, y: 0.6, sy: 0.4, velocity: [0, 1.3, 0], spread: [0.3, 0.4, 0.3], size: 0.26, color: '#ffd84a', intensity: 3.4, sprite: 'sparkle', twinkle: 6 } },
  },
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

// --- Pets + eggs (eggs.js, pets.js, petUi.js) -----------------------------------------------------------
// Rarity tiers: tile colour in the egg panel / pets window and the reveal sound level.
export const RARITIES = {
  common: { name: 'Common', color: '#b9c0c9', dark: '#6b7480', level: 0 },
  uncommon: { name: 'Uncommon', color: '#4fd65a', dark: '#1f8a2c', level: 1 },
  rare: { name: 'Rare', color: '#3ba7ff', dark: '#1b5fb8', level: 2 },
  epic: { name: 'Epic', color: '#a65cff', dark: '#5a22b0', level: 3 },
  legendary: { name: 'Legendary', color: '#ffbb1a', dark: '#b86a00', level: 4 },
  limited: { name: 'Limited', color: '#ff3d6e', dark: '#9a0f35', level: 5 },
}
// Every pet. `bonus` is added to the CASH multiplier while equipped (0.2 = +20%). Pets no longer boost gym
// gains: cash -> eggs -> pets -> Strength -> cash was the loop that let players max the game in an hour.
// `kind` picks the body (pets.js): cat, dog, bunny, bear, fox, mouse, bird, dragon, robot.
// `c` = [body, belly/face, accent]; `hat` = wears a hard hat.
export const PETS = [
  // Hazard Egg
  { id: 'cone_cat', name: 'Cone Cat', egg: 'hazard', rarity: 'common', bonus: 0.02, kind: 'cat', c: ['#ff8a2a', '#fff3e0', '#ffffff'] },
  { id: 'hardhat_pup', name: 'Hard Hat Pup', egg: 'hazard', rarity: 'uncommon', bonus: 0.03, kind: 'dog', c: ['#e2b07a', '#fff1dc', '#8a5a33'], hat: true },
  { id: 'bolt_bunny', name: 'Bolt Bunny', egg: 'hazard', rarity: 'rare', bonus: 0.05, kind: 'bunny', c: ['#c9ced6', '#ffffff', '#3fb6ff'] },
  { id: 'caution_fox', name: 'Caution Fox', egg: 'hazard', rarity: 'epic', bonus: 0.1, kind: 'fox', c: ['#ffcc1a', '#fff8d6', '#1d1d22'], hat: true },
  { id: 'hazard_dragon', name: 'Hazard Dragon', egg: 'hazard', rarity: 'legendary', bonus: 0.25, kind: 'dragon', c: ['#ffcc1a', '#1d1d22', '#ff5a1a'] },
  // Brick Egg
  { id: 'brick_bear', name: 'Brick Bear', egg: 'brick', rarity: 'common', bonus: 0.04, kind: 'bear', c: ['#c8553a', '#f0c8a8', '#7a2a1a'] },
  { id: 'mortar_mouse', name: 'Mortar Mouse', egg: 'brick', rarity: 'uncommon', bonus: 0.08, kind: 'mouse', c: ['#a7acb4', '#e8e4dc', '#ff8fa8'], hat: true },
  { id: 'clay_cat', name: 'Clay Cat', egg: 'brick', rarity: 'rare', bonus: 0.15, kind: 'cat', c: ['#d9784a', '#ffe0c8', '#8a3a1a'] },
  { id: 'kiln_fox', name: 'Kiln Fox', egg: 'brick', rarity: 'epic', bonus: 0.3, kind: 'fox', c: ['#ff5a2a', '#ffe8c8', '#ffd23a'] },
  { id: 'brick_titan', name: 'Brick Titan', egg: 'brick', rarity: 'legendary', bonus: 0.6, kind: 'robot', c: ['#b8442a', '#f0c8a8', '#7dff6b'] },
  // Steel Egg
  { id: 'rivet_rat', name: 'Rivet Rat', egg: 'steel', rarity: 'common', bonus: 0.12, kind: 'mouse', c: ['#8a9099', '#d6dbe2', '#3bd9ff'] },
  { id: 'steel_pup', name: 'Steel Pup', egg: 'steel', rarity: 'uncommon', bonus: 0.25, kind: 'dog', c: ['#9aa3ad', '#e6ebf0', '#3a3f48'], hat: true },
  { id: 'girder_bird', name: 'Girder Bird', egg: 'steel', rarity: 'rare', bonus: 0.5, kind: 'bird', c: ['#ff6a1a', '#ffe0c0', '#ffd23a'] },
  { id: 'weld_wolf', name: 'Weld Wolf', egg: 'steel', rarity: 'epic', bonus: 1, kind: 'fox', c: ['#4a505a', '#c9ced6', '#3bd9ff'] },
  { id: 'chrome_dragon', name: 'Chrome Dragon', egg: 'steel', rarity: 'legendary', bonus: 2, kind: 'dragon', c: ['#d6dde6', '#7d8590', '#3bd9ff'] },
  // Golden Egg
  { id: 'gold_bunny', name: 'Gold Bunny', egg: 'golden', rarity: 'common', bonus: 0.4, kind: 'bunny', c: ['#ffd23a', '#fff6c8', '#ff9a1a'] },
  { id: 'gilded_bear', name: 'Gilded Bear', egg: 'golden', rarity: 'uncommon', bonus: 0.75, kind: 'bear', c: ['#f0b43a', '#fff0b8', '#a8650a'] },
  { id: 'crown_cat', name: 'Crown Cat', egg: 'golden', rarity: 'rare', bonus: 1.5, kind: 'cat', c: ['#ffe066', '#fffbe0', '#ff4f9a'], hat: true },
  { id: 'treasure_fox', name: 'Treasure Fox', egg: 'golden', rarity: 'epic', bonus: 3, kind: 'fox', c: ['#ffc21a', '#fff4c8', '#2bd96b'] },
  { id: 'golden_dragon', name: 'Golden Dragon', egg: 'golden', rarity: 'legendary', bonus: 7.5, kind: 'dragon', c: ['#ffcf3a', '#fff2b0', '#ff3d6e'] },
  // Spin wheel only.
  { id: 'mech', name: 'Mech', egg: null, rarity: 'limited', bonus: 1.25, kind: 'robot', c: ['#ffd23a', '#4a505a', '#ff3d3d'] },
]
// Eggs in the hall. `odds` (%) line up with that egg's pets in PETS order. Every egg costs cash.
// `side`/`row`: where its pedestal stands (-1 west / +1 east, 0 near the entrance / 1 deeper in).
export const EGGS = [
  { id: 'hazard', name: 'Hazard Egg', price: 2000, odds: [55, 28, 11, 5, 1], side: -1, row: 0, color: '#ffcc1a' },
  { id: 'brick', name: 'Brick Egg', price: 100000, odds: [50, 30, 13, 6, 1], side: 1, row: 0, color: '#d0583a' },
  { id: 'steel', name: 'Steel Egg', price: 5e8, odds: [45, 32, 15, 7, 1], side: -1, row: 1, color: '#9aa3ad' },
  { id: 'golden', name: 'Golden Egg', price: 5e11, odds: [32, 28, 22, 12, 6], side: 1, row: 1, color: '#ffcf3a' },
]
export const PET = {
  slots: 3, // pets you can have out at once (+2 with the Pet Slots pass)
  storage: 60, // pets you can own
  merge: 5, // the same pet this many times at the Pet Merge machine -> one of the next tier
  tiers: [
    { name: '', mult: 1 },
    { name: 'Golden', mult: 2.5 },
    { name: 'Rainbow', mult: 6 },
  ],
  luck: 2, // Lucky Eggs pass: Epic and Legendary odds x this
  // The Pets window's +1 SLOT: extra slots bought one at a time with cash (never gems), on top of the pass.
  extraSlots: [150000, 750000, 4000000],
  // SELL: a pet pays its egg's price x this share by rarity level (common..limited) x its tier's mult.
  sell: [0.1, 0.2, 0.4, 0.8, 2, 1],
  sellLimited: 50000, // egg price used for pets that do not come from an egg (the spin wheel's Mech)
  near: { x: 3.6, z: 4 }, // half-size (m) of the box on the carpet beside a pedestal where its egg panel shows
  hatchTime: 1.25, // s the eggs rock before they crack (auto hatch: autoTime)
  autoTime: 0.55,
}
// Hatching passes (the egg panel's side buttons open the Shop on them): cash only.
export const PET_PASSES = [
  { id: 'egg3', name: '+3 Eggs', desc: 'Hatch 3 eggs at once (F / Multi)', price: 30000, multi: 3, icon: 'egg' },
  { id: 'egg8', name: '+8 Eggs', desc: 'Hatch 8 eggs at once', price: 450000, multi: 8, icon: 'egg' },
  { id: 'egg16', name: '+16 Eggs', desc: 'Hatch 16 eggs at once', price: 6000000, multi: 16, icon: 'egg' },
  { id: 'lucky', name: 'Lucky Eggs', desc: '2x Epic and Legendary odds', price: 250000, icon: 'lucky' },
  { id: 'slots', name: '+2 Pet Slots', desc: 'Equip 5 pets instead of 3', price: 350000, icon: 'paw' },
]

// --- Spin wheel (spin.js, spinUi.js) --------------------------------------------------------------------
// Ten equal slices, clockwise from the top. `chance` is %, prizes: cash (x cashScale), gym (unlocks that
// GYM tier for good; cash instead if you have it), pet, golden (+1 golden spin).
export const SPIN = {
  start: 3, // free spins on a new save
  perBuilding: 1, // free spins for every building you help finish
  pity: 40, // spins until the Mystery Jackpot
  // Cash prizes and spin prices grow with buildings finished: x (1 + buildings * scale).
  scale: 0.5,
  turns: 6, // full turns before it settles
  time: 4.2, // s a spin takes
  buy: [
    { n: 1, price: 15000 },
    { n: 3, price: 42750, tag: 'SAVE 5%' },
    { n: 10, price: 120000, tag: 'BEST -20%' },
  ],
  normal: [
    { kind: 'cash', amount: 1400, chance: 46.6, color: '#ffc21a' },
    { kind: 'pet', pet: 'mech', chance: 0.55, color: '#d94dff', tag: 'LIMITED' },
    { kind: 'cash', amount: 3400, chance: 30, color: '#ff9a1a' },
    { kind: 'gym', tier: 2, chance: 1.9, color: '#2f8fff' },
    { kind: 'cash', amount: 8600, chance: 13, color: '#ff7a1a' },
    { kind: 'golden', chance: 0.5, color: '#fff0b0' },
    { kind: 'gym', tier: 9, chance: 0.2, color: '#e8263a', label: 'OP GYM' },
    { kind: 'gym', tier: 3, chance: 1.9, color: '#8a3dff' },
    { kind: 'gym', tier: 4, chance: 0.5, color: '#22b44a' },
    { kind: 'cash', amount: 21000, chance: 4.85, color: '#ff5a1a' },
  ],
  golden: [
    { kind: 'cash', amount: 12000, chance: 40, color: '#ffd84a' },
    { kind: 'pet', pet: 'mech', chance: 2, color: '#d94dff', tag: 'LIMITED' },
    { kind: 'cash', amount: 30000, chance: 25, color: '#ffb02a' },
    { kind: 'gym', tier: 3, chance: 5, color: '#8a3dff' },
    { kind: 'cash', amount: 75000, chance: 14, color: '#ff8a1a' },
    { kind: 'pet', pet: 'mech', gold: 1, chance: 0.5, color: '#fff0b0', tag: 'GOLDEN' },
    { kind: 'gym', tier: 9, chance: 1, color: '#e8263a', label: 'OP GYM' },
    { kind: 'gym', tier: 4, chance: 4, color: '#22b44a' },
    { kind: 'gym', tier: 7, chance: 2.5, color: '#3b6dff' },
    { kind: 'cash', amount: 200000, chance: 6, color: '#ff5a1a' },
  ],
  // Mystery Jackpot after `pity` spins: the first of these you do not have yet, else jackpotCash.
  jackpot: [{ kind: 'pet', pet: 'mech', gold: 1 }, { kind: 'gym', tier: 9 }, { kind: 'gym', tier: 8 }, { kind: 'gym', tier: 7 }],
  jackpotCash: 500000,
  dupeCash: 25000, // a gym prize you already have pays this (x cashScale) instead
}

// --- Robot Gear (robotGear.js, gear.js) ----------------------------------------------------------
// Wearable robot gear, bought with cash at the Robot Gear hall (never gems). One piece is worn at
// a time: blocks = how many blocks each block from your bag places, build = Build Speed multiplier,
// walk = Walk Speed bonus in HUD units (the HUD shows m/s x 3.6), capacity = extra bag space.
// `ability` (key G / the touch gear button): 'transform' (robot <-> vehicle), 'fly' (transform into
// a jet; hold Jump to climb), 'drop' (a dropship delivers the armor with a ground slam and a timed
// build boost).
// `size` = full suits are a giant robot this many times the player (the player pilots it, unscaled),
// `fly` = hold Jump
// to fly in robot form ({ climb, sink } m/s).
// `slot` = where the pedestal stands: hall rows by the walkway (side -1 west / 1 east), or the bar.
export const ROBOT_GEAR = [
  { id: 'jetboots', name: 'Jet Boots', price: 25000, blocks: 1.5, build: 2, walk: 10, capacity: 25, color: '#ff9a1a', glow: '#3bd9ff', row: 0, side: -1, fly: { climb: 8, sink: -2.2 } },
  { id: 'gauntlets', name: 'Robot Gauntlets', price: 75000, blocks: 2, build: 1.75, walk: 15, capacity: 50, color: '#ffc21a', glow: '#ff7a1a', row: 0, side: 1 },
  { id: 'arms', name: 'Robotic Arms', price: 300000, blocks: 2, build: 2, walk: 20, capacity: 200, color: '#e8ecf2', glow: '#ffc21a', row: 1, side: -1 },
  { id: 'mech', name: 'Mech Suit', price: 25e6, blocks: 2.5, build: 2.5, walk: 30, capacity: 750, color: '#ffb81a', glow: '#3bd9ff', row: 1, side: 1, size: 2 },
  { id: 'blackmech', name: 'Black Mech Suit', price: 250e6, blocks: 3, build: 3, walk: 45, capacity: 1250, color: '#25272e', glow: '#3bd9ff', bar: 0, size: 2, fly: { climb: 11, sink: -3 } },
  { id: 'mixer', name: 'Mixer Transformer', price: 1.5e9, blocks: 4, build: 4, walk: 60, capacity: 1600, color: '#2f6fd0', glow: '#ff9a3b', bar: 1, ability: 'transform', vehicle: 'mixer', size: 2 },
  { id: 'titan', name: 'Titan Armor', price: 150e9, blocks: 8, build: 7, walk: 100, capacity: 3000, color: '#d61f2c', glow: '#ffd23a', bar: 2, ability: 'drop', size: 2, fly: { climb: 14, sink: -3 } },
  { id: 'truck', name: 'Truck Transformer', price: 6e9, blocks: 5, build: 5, walk: 75, capacity: 2000, color: '#7a3dd1', glow: '#ff5fd2', bar: 3, ability: 'transform', vehicle: 'truck', size: 2 },
  { id: 'jet', name: 'Jet Transformer', price: 25e9, blocks: 6, build: 6, walk: 90, capacity: 2000, color: '#f2f4f7', glow: '#ffc21a', bar: 4, ability: 'fly', vehicle: 'jet', size: 2 },
  // LIMITED (on its own red pad outside the hall): stock counts down through each `hours` window from
  // `stock` toward `floor` and restocks when the window ends; `was` is the struck-out list price.
  { id: 'spider', name: 'Spider Arms', price: 2e6, was: 3e6, blocks: 3, build: 3, walk: 40, capacity: 600, color: '#f2f4f7', glow: '#ff3a4a', spot: 'limited', limited: { stock: 1000, hours: 72, floor: 30 }, carry: true, climb: true },
]
export const ROBOT = {
  maxWalk: 55, // m/s cap on walk speed with gear
  vehicleSpeed: 1.45, // walk speed multiplier in vehicle form
  vehicleScale: { mixer: 0.55, truck: 0.55, jet: 0.5 },
  transformTime: 1.1, // s robot -> vehicle (built piece by piece out of the robot)
  foldTime: 0.9, // s vehicle -> robot
  // Driving / walking physics (robotPlayer.js): springs on the body's pitch / roll / heave.
  spring: { k: 90, damp: 11, pitchPerAccel: 0.012, rollPerLateral: 0.006, steer: 0.35, maxSteer: 0.5, flyLean: 0.025, maxFlyLean: 0.55 },
  fly: { climb: 14, sink: -3.5, dive: -16, accel: 28, maxY: 260 }, // m/s while flying as a jet (hold Jump to climb, hold C / DOWN to dive)
  flyAccel: 26, // m/s^2 toward the climb / sink speed for gear that flies in robot form
  flyMaxY: 240, // m, flying gear stops climbing here
  trail: 0.045, // s between thruster spark bursts
  stride: 2.4, // m walked per heavy mech footstep (x suit size)
  drop: { cooldown: 45, boost: 2, boostTime: 20, fallTime: 1.1, hover: 2.2 }, // Titan Armor's G
  suitUp: 1.4, // s the equip assembly takes
  // Gear with `carry` lifts the player off the ground on its legs (theirs hang still); gear with
  // `climb` scales the tower: walk into a wall to latch on, forward / back climbs, Jump kicks off,
  // reaching the roof hauls you over the edge.
  carry: { lift: 0.95, bob: 0.08 }, // m
  climb: { speed: 10, reach: 1.7, detach: 2.6, mantleAt: 0.6, mantleTime: 0.8, inward: 2.2, gait: 1.6 },
  // Parachute (parachute.js): a player NOT wearing Robot Gear opens a ram-air canopy when they drop off
  // something high (the tower roof); gear wearers land on their shock absorbers instead (`impact`). It opens once the ground is `deployAlt` m away, or earlier when
  // falling so fast it needs more room to slow down (stopping distance at `decel` + `margin`), and
  // only after a free fall that began at least `minDrop` m up. Under it you sink at `sink` m/s, fly
  // forward at `glide` (steer with the move keys, up to `speed`), and flare to `flareSink` in the last
  // `flareAlt` m. m, m/s, m/s^2, s.
  chute: {
    minDrop: 14, deployAlt: 26, minAlt: 4, margin: 15, triggerVy: -9, decel: 55,
    sink: 4.2, glide: 6, speed: 13, flareAlt: 3.4, flareSink: 1.4,
    pack: 0.22, inflate: 0.8, collapse: 1.25, cells: 9, span: 7.4, chord: 2.5, lines: 4.8,
    color: '#e8322f', glow: '#ffd23a', // canopy panels (alternating with white) and the glowing trim
  },
  // Robot Gear wearers dropping from high take the hit (impact.js): landing faster than `minVy` m/s is a
  // superhero landing (knee down, fist to the ground) whose effects grow up to `minVy + range`. The crouch
  // comes in over `down` s, holds `hold` (+ `holdExtra` at full power) while the legs absorb the shock
  // (walk slowed to `slow`x), then the suit rises over `rise` s.
  impact: { minVy: 16, range: 30, down: 0.07, hold: 0.38, holdExtra: 0.25, rise: 0.45, slow: 0.15 },
}

// --- Daily, Playtime + Free rewards (rewards.js, rewardsUi.js) ------------------------------------------
// Server-authoritative for signed-in players (backend rewards.ts; DAILY_DAYS / PLAY_TIERS_MIN there must
// match `daily.length` / `play[].at`), kept in the browser save for guests. Prizes (`kind`):
// cash { amount }, boost { stat: 'cash' | 'strength' | 'speed', mult, time (min of play) }, gear { gear } (a
// ROBOT_GEAR id; owned already -> `dupeGear` of its price in cash), egg { egg } (one free hatch of an EGGS
// egg; full storage -> its price in cash). `color` = the card: blue, purple, gold, red, rainbow.
export const REWARDS = {
  // One claim per UTC day, in a row; missing a day starts over at day 1.
  daily: [
    { kind: 'boost', stat: 'strength', mult: 2, time: 15, color: 'blue' },
    { kind: 'gear', gear: 'arms', color: 'blue' },
    { kind: 'boost', stat: 'strength', mult: 4, time: 30, color: 'blue' },
    { kind: 'gear', gear: 'gauntlets', color: 'purple' },
    { kind: 'cash', amount: 17000, color: 'purple' },
    { kind: 'boost', stat: 'strength', mult: 2, time: 180, color: 'gold' },
    { kind: 'gear', gear: 'mech', color: 'rainbow', wide: true },
  ],
  // Minutes played today (UTC), each claimable once a day.
  play: [
    { at: 1, kind: 'cash', amount: 500, color: 'blue' },
    { at: 3, kind: 'gear', gear: 'jetboots', color: 'blue' },
    { at: 5, kind: 'cash', amount: 1500, color: 'blue' },
    { at: 15, kind: 'gear', gear: 'gauntlets', color: 'gold' },
    { at: 20, kind: 'egg', egg: 'steel', color: 'purple' },
    { at: 25, kind: 'boost', stat: 'cash', mult: 2, time: 10, color: 'purple' },
    { at: 30, kind: 'boost', stat: 'cash', mult: 3, time: 15, color: 'gold' },
    { at: 45, kind: 'boost', stat: 'strength', mult: 5, time: 10, color: 'red' },
  ],
  // The FREE button's card: once ever, after the three steps.
  free: { kind: 'boost', stat: 'cash', mult: 1.5, time: 15, color: 'purple' },
  freeSteps: ['Join the group', 'Favorite the game', 'Like the game'],
  dupeGear: 0.5,
  timedMax: 12, // running timed boosts kept at once
}

// --- Goals (goals.js, the HUD goal card) -------------------------------------------------------------------
// One short personal goal at a time, sized to YOUR pace (about `minutes` of play: your recent income, bag and
// gym gain), so everyone finishes one every few minutes. The reward is `rewardSec` seconds of your recent
// income (at least `minReward`); when the next upgrade costs at most `topUp` x that more than you have, the
// reward is EXACTLY what it still costs ("Exactly enough for Block Grab Lv 7!"). Every `chestEvery` goals a
// chest adds a timed boost (`chest`, seconds). The first `perDay` goals of a UTC day pay in full, later ones
// `afterCap` of it until midnight (come back tomorrow); after `welcome.away` s away the next goal pays
// `welcome.mult` x. `weights` = how often each kind comes up; `floors` / `reps` size those kinds. Cash only.
export const GOALS = {
  minutes: 3,
  rewardSec: 45,
  minReward: 25,
  topUp: 2,
  chestEvery: 5,
  chest: { stat: 'cash', mult: 2, time: 300 },
  perDay: 15,
  afterCap: 0.25,
  welcome: { away: 4 * 3600, mult: 2 },
  floors: 2,
  reps: 100,
  weights: { place: 3, earn: 2, floors: 2, strength: 1.5, upgrade: 1 },
}

// --- Offline rewards: "While You Were Away" (offline.js, offlineUi.js) -----------------------------------
// Closing the game keeps you training. The SERVER measures the time away (backend src/offline.ts;
// `min` / `max` here must match OFFLINE_MIN_S / OFFLINE_MAX_S there; guests are timed by their browser):
// under `min` seconds earns nothing, at most `max` (24 h) is ever paid. `perMinute` = Strength and Speed
// per minute away at the Free pad (x1); it is multiplied by the best gym pad you can use and by your
// 2x passes, but NOT by world events or running boosts (pets boost cash only). Never Gems/Robux.
export const OFFLINE = { min: 300, max: 86400, perMinute: 0.07, localKey: 'build-the-skyscraper.away' }

// --- Invite Friends (invite.js; backend src/invite.ts decides who counts) --------------------------------
// A friend counts for the player who invited them once they ACTUALLY PLAY: `need` of play and blocks
// placed (keep in step with the backend constants.ts INVITE_ACTIVE_PLAYTIME / INVITE_ACTIVE_BLOCKS).
// `tiers[].friends` mirrors the backend INVITE_TIERS. A `prize` is one prize or a list, in the REWARDS
// shapes (cash / boost / gear / egg, granted by stats.grantReward) plus { kind: 'upgrade', id, levels }
// (id 'all' = every upgrade; capped at each upgrade's max). `scale: true` on cash = x (1 + buildings
// finished * SPIN.scale), like the spin wheel, so a prize keeps up with the economy late in the game.
// Never Gems/Robux. Value reference: a spin $15K, Jet Boots $25K, Gauntlets $75K, Mech Suit $25M, Black
// Mech $250M, Steel Egg $500M (the daily week already ends on the Mech Suit, so invites top out one step above it).
export const INVITE = {
  need: { playtime: 180, blocks: 300 },
  tiers: [
    { friends: 1, color: 'blue', prize: { kind: 'cash', amount: 5000, scale: true } },
    { friends: 2, color: 'blue', prize: { kind: 'boost', stat: 'cash', mult: 2, time: 15 } },
    { friends: 3, color: 'purple', prize: [{ kind: 'upgrade', id: 'grab', levels: 2 }, { kind: 'upgrade', id: 'build', levels: 2 }] },
    { friends: 5, color: 'purple', prize: { kind: 'egg', egg: 'brick' } },
    { friends: 8, color: 'gold', prize: { kind: 'gear', gear: 'gauntlets' } },
    { friends: 12, color: 'gold', prize: [{ kind: 'boost', stat: 'strength', mult: 3, time: 30 }, { kind: 'cash', amount: 75000, scale: true }] },
    { friends: 20, color: 'red', prize: [{ kind: 'egg', egg: 'steel' }, { kind: 'upgrade', id: 'all', levels: 3 }] },
    { friends: 25, color: 'rainbow', prize: { kind: 'gear', gear: 'blackmech' } },
  ],
  // The invited friend's gift (claim "welcome"), ready as soon as they join through an invite.
  welcome: [{ kind: 'cash', amount: 2500, scale: true }, { kind: 'boost', stat: 'cash', mult: 2, time: 10 }],
}

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
