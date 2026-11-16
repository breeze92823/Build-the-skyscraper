// Day-time light gate. The site lamps, floodlights and headlamp aura (16 point / spot lights) sit at
// intensity 0 all day, yet every lit pixel still loops over them, which roughly doubled the GPU time per
// frame. While ALL of them are at 0 they are switched off (visible = false) together, and back on
// together the moment any of them rises. Lights off at 0 intensity add nothing, so the picture is the
// same; and because they always switch as one set there are exactly two shader variants (day / night),
// both compiled up front by warmup.js, so dusk and dawn never stall on shader compiles.
export function createLightGate(scene) {
  const lights = []
  scene.traverse((o) => {
    if (o.isPointLight || o.isSpotLight) lights.push(o)
  })
  let on = null

  function update() {
    let any = false
    for (const l of lights) {
      if (l.intensity > 0) {
        any = true
        break
      }
    }
    if (any === on) return
    on = any
    for (const l of lights) l.visible = any
  }

  return {
    update,
    get on() {
      return on
    },
  }
}
