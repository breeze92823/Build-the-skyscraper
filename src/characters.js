import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { PLAYER_DIMS, RANKS, RIG_HEIGHT } from './config.js'
import { buildDefaultCharacter } from './avatar/character.js'
import { fontReady } from './propkit.js'
import { blockMaterial } from './site.js'

// Everything that makes an avatar a construction worker: a hi-vis vest and hard hat, a
// carrying frame on the back that fills with stone blocks as the bag fills, muscles that
// bulk up with Strength, and a floating name tag with the rank. Works on the Bloxity rig
// (player.glb) and on the procedural fallback / worker bots, which share bone names.
// Accessories are built in rig units and fixed to bones in the bind pose, so they follow
// every animation.

export const RIG_SCALE = PLAYER_DIMS.height / RIG_HEIGHT

// --- Materials --------------------------------------------------------------------------------
let vestMat = null
function vestMaterial() {
  if (vestMat) return vestMat
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#ff7417'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#e7ecef'
  g.fillRect(0, 18, 64, 7)
  g.fillRect(0, 40, 64, 7)
  g.fillStyle = 'rgba(255,255,255,0.35)'
  g.fillRect(0, 19, 64, 2)
  g.fillRect(0, 41, 64, 2)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  vestMat = new MeshStandardMaterial({ map: t, roughness: 0.6 })
  return vestMat
}
const hatMats = {}
function hatMaterial(color) {
  return hatMats[color] || (hatMats[color] = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 }))
}
const frameMat = new MeshStandardMaterial({ color: '#ffc21a', roughness: 0.5, metalness: 0.2 })
const strapMat = new MeshStandardMaterial({ color: '#2b2d33', roughness: 0.8 })

// Fixes `obj` (built in rig/root space units around its origin) to `bone` so that, in the
// current (bind) pose, it sits at `pos` in the character root's space, unrotated.
function attach(root, boneName, obj, pos) {
  const bone = root.nodes?.[boneName]
  if (!bone) return false
  root.updateMatrixWorld(true)
  const rootInv = new Matrix4().copy(root.matrixWorld).invert()
  const boneInRoot = rootInv.multiply(bone.matrixWorld)
  const local = boneInRoot.invert().multiply(new Matrix4().makeTranslation(pos.x, pos.y, pos.z))
  local.decompose(obj.position, obj.quaternion, obj.scale)
  bone.add(obj)
  return true
}

function shadowed(m) {
  m.castShadow = true
  m.receiveShadow = true
  return m
}

// The carrying frame + up to 12 blocks (2 x 2 x 3), shown in proportion to the bag.
function makeBackpack() {
  const g = new Group()
  for (const x of [-0.95, 0.95]) {
    g.add(shadowed(new Mesh(new BoxGeometry(0.16, 3.0, 0.16), frameMat)).translateX(x).translateY(0.2))
    const strap = new Mesh(new BoxGeometry(0.22, 0.2, 1.9), strapMat)
    strap.position.set(x * 0.6, 1.25, 0.85)
    g.add(strap)
  }
  g.add(shadowed(new Mesh(new BoxGeometry(2.1, 0.16, 0.16), frameMat)).translateY(1.6))
  const shelf = shadowed(new Mesh(new BoxGeometry(2.2, 0.16, 1.5), frameMat))
  shelf.position.set(0, -1.25, -0.7)
  g.add(shelf)
  const cube = new BoxGeometry(0.98, 0.98, 0.7)
  const blocks = []
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const b = shadowed(new Mesh(cube, blockMaterial()))
        b.position.set(-0.5 + i * 1.0, -0.66 + layer * 1.0, -0.35 - j * 0.72)
        b.visible = false
        g.add(b)
        blocks.push(b)
      }
    }
  }
  // Bigger loads pile above the frame.
  const heap = shadowed(new Mesh(new BoxGeometry(1.9, 1, 1.4), blockMaterial()))
  heap.geometry.translate(0, 0.5, 0)
  heap.position.set(0, 2.35, -0.7)
  heap.visible = false
  g.add(heap)
  let shownFill = -1
  return {
    group: g,
    // fill 0..1, extra 0.. (how far past a normal load the bag is, grows the heap)
    setFill(fill, extra = 0) {
      const n = fill <= 0 ? 0 : Math.max(1, Math.ceil(fill * blocks.length))
      const key = n + extra * 0.001
      if (key === shownFill) return
      shownFill = key
      blocks.forEach((b, i) => (b.visible = i < n))
      heap.visible = extra > 0 && fill > 0
      heap.scale.y = Math.min(3, extra)
    },
  }
}

// Dresses an avatar root (rig units inside, scaled to metres). Returns
// { setFill(fill, extra), setMuscle(m) }.
export function dressWorker(root, { hat = '#ffd21a', vest = true } = {}) {
  // The bind pose, before any animation moves the bones: gear.js attaches armour against it.
  if (!root.userData.restPose) {
    const rest = new Map()
    root.traverse((o) => {
      if (o.isBone) rest.set(o, o.quaternion.clone())
    })
    root.userData.restPose = rest
  }
  if (vest) {
    const v = shadowed(new Mesh(new BoxGeometry(2.98, 2.2, 1.78), vestMaterial()))
    v.name = 'workVest' // gear.js hides it under a full suit
    attach(root, 'Spine1', v, new Vector3(0, 3.62, 0))
  }
  if (hat) {
    const h = new Group()
    h.name = 'hardHat' // gear.js hides it under a helmet
    const dome = shadowed(new Mesh(new SphereGeometry(0.98, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), hatMaterial(hat)))
    const brim = shadowed(new Mesh(new CylinderGeometry(1.18, 1.18, 0.1, 18), hatMaterial(hat)))
    brim.position.set(0, -0.02, 0.15)
    const ridge = new Mesh(new BoxGeometry(0.22, 0.25, 1.9), hatMaterial(hat))
    ridge.position.y = 0.88
    h.add(dome, brim, ridge)
    attach(root, 'Neck1', h, new Vector3(0, 6.18, 0))
  }
  const pack = makeBackpack()
  pack.group.name = 'workPack' // gear.js hides it under a suit that has its own back unit
  attach(root, 'Spine1', pack.group, new Vector3(0, 3.6, -1.15))
  const n = root.nodes
  // Base values the SDK proportions set (re-applied by applyProportions); muscles multiply in.
  const base = { torso: n.Spine1?.scale.x ?? 1 }
  const offsets = ['ArmL_Offset', 'ArmR_Offset', 'Neck_Offset'].map((name) => n[name]).filter(Boolean)
  const offsetAxes = offsets.map((o) => {
    // Which parent axis each local axis maps to (offsets are axis-aligned rotations).
    const q = o.quaternion
    return [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].map((e) => {
      e.applyQuaternion(q)
      const a = [Math.abs(e.x), Math.abs(e.y), Math.abs(e.z)]
      return a.indexOf(Math.max(...a))
    })
  })
  return {
    setFill: pack.setFill,
    // Torso wider and deeper, arms thicker; the children of the torso get the inverse so the
    // arms and head are not stretched by it.
    setMuscle(m, torsoBase = base.torso) {
      if (!n.Spine1) return
      const sx = torsoBase * m
      const sz = 1 + (m - 1) * 0.55
      n.Spine1.scale.set(sx, 1, sz)
      const parent = [sx, 1, sz]
      offsets.forEach((o, i) => {
        const ax = offsetAxes[i]
        o.scale.set(1 / parent[ax[0]], 1 / parent[ax[1]], 1 / parent[ax[2]])
      })
      const arm = 1 + (m - 1) * 0.9
      for (const name of ['ArmL1', 'ArmR1']) {
        const b = n[name]
        if (b) b.scale.set(arm, b.scale.y, arm)
      }
    },
  }
}

// --- Name tags ------------------------------------------------------------------------------------
function rankStyle(i) {
  return RANKS[Math.max(0, Math.min(RANKS.length - 1, i))]
}

function drawDiamond(g, x, y, r, color, num) {
  g.save()
  g.translate(x, y)
  g.rotate(Math.PI / 4)
  g.fillStyle = '#1c1c22'
  g.fillRect(-r - 5, -r - 5, (r + 5) * 2, (r + 5) * 2)
  g.fillStyle = color
  g.fillRect(-r, -r, r * 2, r * 2)
  g.restore()
  g.font = `700 ${Math.round(r * 1.05)}px Fredoka, "Arial Black", sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 6
  g.strokeStyle = '#1c1c22'
  g.strokeText(String(num), x, y + 2)
  g.fillStyle = '#ffffff'
  g.fillText(String(num), x, y + 2)
}

// A sprite showing "<rank diamond> RANK NAME" over the username. Returns { sprite, set(name, rankIndex) }.
export function makeNameTag(name, rankIndex, { you = false } = {}) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }))
  sprite.scale.set(3.2, 1.0, 1)
  sprite.renderOrder = 5
  let cur = { name, rankIndex }
  function draw() {
    const g = c.getContext('2d')
    g.clearRect(0, 0, c.width, c.height)
    const r = rankStyle(cur.rankIndex)
    g.font = '700 46px Fredoka, "Arial Black", sans-serif'
    const rankText = r.name.toUpperCase()
    const w = g.measureText(rankText).width
    const total = w + 70
    const x0 = (c.width - total) / 2
    drawDiamond(g, x0 + 24, 44, 20, r.color, cur.rankIndex + 1)
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 10
    g.strokeStyle = '#1c1c22'
    g.strokeText(rankText, x0 + 62, 46)
    g.fillStyle = r.color
    g.fillText(rankText, x0 + 62, 46)
    g.font = '600 50px Fredoka, "Arial Black", sans-serif'
    g.textAlign = 'center'
    g.lineWidth = 10
    g.strokeText(cur.name, c.width / 2, 112)
    g.fillStyle = you ? '#ffffff' : '#f2f2f2'
    g.fillText(cur.name, c.width / 2, 112)
    tex.needsUpdate = true
  }
  draw()
  fontReady.then(draw)
  return {
    sprite,
    set(nextName, nextRank) {
      if (nextName === cur.name && nextRank === cur.rankIndex) return
      cur = { name: nextName, rankIndex: nextRank }
      draw()
    },
  }
}

// --- Worker bots' bodies ----------------------------------------------------------------------------
const SKINS = ['#f2c79a', '#d9a273', '#a8724a', '#7a4e2e', '#ffd9b3']
const HAIRS = ['#3a2516', '#1d1d1f', '#8a5a2b', '#d9b25a', '#b5432a']
const SHIRTS = ['#2f6fd0', '#3a3d46', '#2fae5a', '#7a3dd1', '#d63a2a', '#1aa3b8']
const PANTS = ['#2b3a5a', '#3b3b40', '#4a3a2a', '#26324a']
const faceMat = new MeshStandardMaterial({ color: '#1d1d1f', roughness: 0.5 })

export function makeBotBody(seed) {
  const pick = (list, k) => list[(seed * 7 + k * 3) % list.length]
  const root = buildDefaultCharacter()
  const mats = {
    skin: new MeshStandardMaterial({ color: pick(SKINS, 1), roughness: 0.7 }),
    hair: new MeshStandardMaterial({ color: pick(HAIRS, 2), roughness: 0.8 }),
    shirt: new MeshStandardMaterial({ color: pick(SHIRTS, 3), roughness: 0.7 }),
    pants: new MeshStandardMaterial({ color: pick(PANTS, 4), roughness: 0.75 }),
  }
  root.traverse((o) => {
    if (!o.isMesh) return
    const bone = o.parent?.name ?? ''
    if (bone.startsWith('Leg')) o.material = mats.pants
    else if (bone.startsWith('Arm') || bone === 'Spine1') o.material = mats.shirt
    else if (bone === 'Neck1') o.material = o.geometry.type === 'CylinderGeometry' ? mats.skin : mats.hair
  })
  // A simple face: two eyes and a smile on the front of the head.
  const neck = root.nodes.Neck1
  if (neck) {
    for (const x of [-0.28, 0.28]) {
      const eye = new Mesh(new BoxGeometry(0.14, 0.24, 0.06), faceMat)
      eye.position.set(x, 0.85, 0.79)
      neck.add(eye)
    }
    const smile = new Mesh(new BoxGeometry(0.42, 0.08, 0.06), faceMat)
    smile.position.set(0, 0.45, 0.79)
    neck.add(smile)
  }
  return root
}

export { Quaternion }
