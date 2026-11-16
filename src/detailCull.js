import { Vector3 } from 'three'
import { DETAIL_CULL } from './config.js'

// Screen-size culling: a part smaller on screen than DETAIL_CULL.px (radius, device pixels) is not
// drawn. Anything that small is at most a pixel or two (it only shimmers), so the picture does not
// change; the game simply stops paying a draw call for every bolt, LED and finger across the site.
// Inside the fog the limit grows by up to DETAIL_CULL.fogPx, as fog has already washed those parts
// into the horizon. With the long view distance this is what keeps the far half of the compound cheap.
//
// It never touches `visible` (game code owns that): a culled mesh gets layers.mask = 0, which the
// renderer skips, and gets its mask back as soon as it is big enough again (with a little hysteresis
// so nothing flickers at the limit). Only leaf meshes / sprites that are frustum-culled anyway take
// part; skinned and instanced meshes, particles and always-drawn things (sky, beams) never do.
export function createDetailCull(scene, camera, renderer) {
  const C = DETAIL_CULL
  let list = []
  const culled = new Set()
  const centre = new Vector3()
  const camPos = new Vector3()
  let rebuildT = 0
  let frame = 0

  const eligible = (o) =>
    o.frustumCulled &&
    o.children.length === 0 &&
    ((o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isPoints) || o.isSprite) &&
    !o.userData.noDetailCull

  function rebuild() {
    const next = []
    scene.traverse((o) => {
      if (eligible(o)) next.push(o)
    })
    list = next
    // Anything that left the scene (or stopped qualifying) gets drawn normally again.
    const inList = new Set(list)
    for (const o of culled) {
      if (!inList.has(o)) {
        if (!o.userData.rigidBone) o.layers.mask = 1 // (a part merged by bakeRigid stays undrawn)
        culled.delete(o)
      }
    }
  }

  function update(dt) {
    if (!C.enabled) return
    rebuildT -= dt
    if (rebuildT <= 0) {
      rebuildT = C.rebuildEvery
      rebuild()
    }
    if (++frame % C.every !== 0) return
    camera.getWorldPosition(camPos)
    // Device pixels per metre at 1 m: the projected radius of a sphere r at distance d is r / d * k.
    const k = ((renderer.domElement.height / 2) * (camera.zoom || 1)) / Math.tan((camera.fov * Math.PI) / 360)
    const fog = scene.fog
    const fogNear = fog?.near ?? Infinity
    const fogSpan = fog ? Math.max(1, fog.far - fog.near) : 1
    for (let i = 0; i < list.length; i++) {
      const o = list[i]
      let radius
      if (o.isSprite) {
        centre.setFromMatrixPosition(o.matrixWorld)
        radius = 0.5 * o.matrixWorld.getMaxScaleOnAxis()
      } else {
        const g = o.geometry
        if (!g.boundingSphere) g.computeBoundingSphere()
        const bs = g.boundingSphere
        centre.copy(bs.center).applyMatrix4(o.matrixWorld)
        radius = bs.radius * o.matrixWorld.getMaxScaleOnAxis()
      }
      const d = centre.distanceTo(camPos) - radius
      if (d <= 1) {
        if (culled.has(o)) restore(o)
        continue
      }
      const px = (radius / d) * k
      const fogged = Math.min(1, Math.max(0, (d - fogNear) / fogSpan))
      const limit = C.px + C.fogPx * fogged
      if (culled.has(o)) {
        if (px > limit * C.hysteresis) restore(o)
      } else if (px < limit) {
        o.layers.mask = 0
        culled.add(o)
      }
    }
  }

  function restore(o) {
    o.layers.mask = 1
    culled.delete(o)
  }

  // Everything back on (warm-up draws the whole scene, debugging).
  function reset() {
    for (const o of culled) o.layers.mask = 1
    culled.clear()
  }

  return {
    update,
    reset,
    get culledCount() {
      return culled.size
    },
  }
}
