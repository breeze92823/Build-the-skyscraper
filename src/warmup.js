// GPU warm-up: gets every shader, texture and mesh buffer onto the GPU BEFORE it first comes into view.
// three.js otherwise does that work lazily on the first frame an object is on screen, so turning to look
// at a new part of the site stalled for a moment (shaders compiling, canvas textures uploading and
// building mipmaps, vertex buffers uploading). Nothing about how things look changes.
//
// full()  : behind the loading screen, after the world is built. Compiles every material against the
//           target the scene really renders into (with bloom on that is an HDR buffer, a different shader
//           variant from the canvas), uploads every texture, then draws one frame with everything shown
//           and frustum culling off, which also uploads geometry and builds the shadow-pass shaders.
// watch() : while playing, an idle-time sweep that warms whatever was added since (Robot Gear, pets,
//           other players, the next building, ...) a few ms at a time, so it is ready when you look at it.
export function createWarmup(renderer, scene, camera, postfx) {
  const props = renderer.properties
  const SWEEP_EVERY = 1.5 // s between idle sweeps
  const SLICE_MS = 4 // max work per idle slice

  function materialsOf(o) {
    const m = o.material
    return m ? (Array.isArray(m) ? m : [m]) : []
  }

  function texturesOf(material, out) {
    for (const key in material) {
      const v = material[key]
      if (v && v.isTexture) out.add(v)
    }
    const u = material.uniforms
    if (u) {
      for (const key in u) {
        const v = u[key]?.value
        if (v && v.isTexture) out.add(v)
        else if (Array.isArray(v)) for (const t of v) if (t && t.isTexture) out.add(t)
      }
    }
  }

  // A texture that still has to go up: not yet seen by the renderer, has pixels, and is not a render
  // target's own texture (those are set up by their target).
  function needsUpload(t) {
    if (t.isRenderTargetTexture || props.get(t).__webglInit) return false
    const img = t.image
    if (!img) return false
    if (t.isCubeTexture) return Array.isArray(img) && img.length === 6 && img.every((i) => i && (i.width || i.data))
    return !!(img.width || img.data || img.length)
  }

  function upload(t) {
    try {
      renderer.initTexture(t)
    } catch {
      // A texture the driver refuses now is simply uploaded on first use, as before.
    }
  }

  // Compile `root`'s materials for the scene's lights/fog/environment and the real render target.
  function compile(root) {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(postfx.sceneTarget())
    try {
      return renderer.compile(root, camera, scene)
    } catch {
      return new Set()
    } finally {
      renderer.setRenderTarget(prev)
    }
  }

  // Resolves once every program in `materials` reports ready (parallel compile), or after `maxMs`.
  function whenReady(materials, maxMs) {
    const t0 = performance.now()
    return new Promise((resolve) => {
      const check = () => {
        for (const m of materials) {
          const p = props.get(m).currentProgram
          if (!p || p.isReady()) materials.delete(m)
        }
        if (materials.size === 0 || performance.now() - t0 > maxMs) resolve()
        else setTimeout(check, 16)
      }
      check()
    })
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()))

  async function full() {
    try {
      // 1. Shaders, compiled in parallel by the driver where it can (KHR_parallel_shader_compile).
      await whenReady(compile(scene), 20000)

      // 2. Textures, a few ms at a time so the loading screen keeps animating.
      const textures = new Set()
      scene.traverse((o) => {
        for (const m of materialsOf(o)) texturesOf(m, textures)
      })
      if (scene.environment) textures.add(scene.environment)
      let t0 = performance.now()
      for (const t of textures) {
        if (!needsUpload(t)) continue
        upload(t)
        if (performance.now() - t0 > 12) {
          await nextFrame()
          t0 = performance.now()
        }
      }

      // 3. One frame with everything visible and nothing culled: uploads every vertex / index /
      // instance buffer and builds the shadow pass's depth shaders. Restored before anything else runs.
      const hidden = []
      const culled = []
      scene.traverse((o) => {
        if (!o.visible) {
          hidden.push(o)
          o.visible = true
        }
        if (o.frustumCulled) {
          culled.push(o)
          o.frustumCulled = false
        }
      })
      try {
        postfx.render()
      } catch {
        // Warm-up is only an optimisation.
      } finally {
        for (const o of hidden) o.visible = false
        for (const o of culled) o.frustumCulled = true
      }
      // Redraw normally in the same task, so the canvas never shows the everything-visible frame.
      postfx.render()
    } catch {
      // Older drivers: things compile / upload on first use instead.
    }
  }

  // --- Runtime: warm what was added since, in idle time ------------------------------------------
  const pendingObjects = []
  const pendingTextures = []
  const queuedTex = new Set()
  let sweepT = 0
  let busy = false

  function sweep() {
    scene.traverse((o) => {
      const mats = materialsOf(o)
      if (mats.length === 0) return
      let cold = false
      for (const m of mats) {
        if (!props.get(m).currentProgram && !tried.has(m)) cold = true
        // Textures can be assigned after a material is made, so look every sweep.
        scratch.clear()
        texturesOf(m, scratch)
        for (const t of scratch) {
          if (!queuedTex.has(t) && needsUpload(t)) {
            queuedTex.add(t)
            pendingTextures.push(t)
          }
        }
      }
      if (cold) pendingObjects.push(o)
    })
  }
  const scratch = new Set()
  const tried = new WeakSet() // materials compile() already went through (never retried every sweep)

  function work(deadline) {
    const until = performance.now() + Math.min(SLICE_MS, deadline?.timeRemaining?.() ?? SLICE_MS)
    while (pendingObjects.length && performance.now() < until) {
      const o = pendingObjects.pop()
      // Still in the scene and still cold (a single compile of a parent may have covered it).
      if (!o.parent) continue
      const mats = materialsOf(o)
      if (mats.some((m) => !props.get(m).currentProgram)) compile(o)
      for (const m of mats) tried.add(m)
    }
    while (pendingTextures.length && performance.now() < until) {
      const t = pendingTextures.pop()
      queuedTex.delete(t)
      if (needsUpload(t)) upload(t)
    }
    if (pendingObjects.length || pendingTextures.length) schedule()
    else busy = false
  }

  const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 500 }) : (fn) => setTimeout(fn, 0)
  function schedule() {
    idle(work)
  }

  // Called every frame with dt; the sweep itself is cheap (one scene walk every SWEEP_EVERY s).
  function update(dt) {
    sweepT -= dt
    if (sweepT > 0 || busy) return
    sweepT = SWEEP_EVERY
    sweep()
    if (pendingObjects.length || pendingTextures.length) {
      busy = true
      schedule()
    }
  }

  return { full, update }
}
