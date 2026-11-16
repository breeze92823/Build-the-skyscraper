import { HalfFloatType, Vector2, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BLOOM } from './config.js'

// Optional bloom, so the neon lane rails, the waterfall, the VIP gate and the
// particles glow like the reference. The scene renders into a half-float
// target (HDR, before tone mapping); the bloom pass only picks up what is
// brighter than BLOOM.threshold, which ordinary sunlit surfaces stay under,
// so materials opt in by going HDR (emissive or a colour scaled above 1).
// OutputPass then applies the renderer's tone mapping + sRGB. Off on the
// lighter graphics presets: there the plain renderer.render path is used.
export function createPostFx(renderer, scene, camera) {
  let composer = null
  let bloom = null
  let enabled = false
  const size = new Vector2()

  function build(antialias) {
    composer?.dispose()
    renderer.getSize(size)
    // No multisampling on the HDR target (samples 0): resolving a multisampled half-float buffer every
    // frame leaves rectangles of the canvas black on some GPU drivers (seen on Firefox / Windows laptops;
    // they vanished with bloom off). Edges are smoothed by an SMAA pass after the tone-mapped output.
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 0 })
    composer = new EffectComposer(renderer, target)
    composer.addPass(new RenderPass(scene, camera))
    bloom = new UnrealBloomPass(new Vector2(size.x, size.y), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
    // Backstop: one NaN / Inf pixel in the HDR buffer is smeared by the bloom blur (and its 1/32-size mips)
    // into large black rectangles. Drop such pixels (and cap absurd values) before the blur sees them.
    const hp = bloom.materialHighPassFilter
    const guarded = hp.fragmentShader.replace(
      /vec4 texel = texture2D\(\s*tDiffuse,\s*vUv\s*\);/,
      (m) => `${m}\n\t\t\tif (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.0);\n\t\t\ttexel.rgb = min(texel.rgb, vec3(64.0));`,
    )
    if (guarded !== hp.fragmentShader) {
      hp.fragmentShader = guarded
      hp.needsUpdate = true
    }
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    if (antialias) composer.addPass(new SMAAPass(size.x, size.y))
    composer.setPixelRatio(renderer.getPixelRatio())
    composer.setSize(size.x, size.y)
  }

  return {
    get bloom() {
      return bloom // for tuning from the dev console
    },
    // preset: a graphicsPreset() result (bloom + antialias decide the setup).
    configure(preset) {
      enabled = !!preset.bloom
      if (!enabled) {
        composer?.dispose()
        composer = null
        bloom = null
        return
      }
      build(!!preset.antialias)
    },
    setSize(w, h) {
      if (!composer) return
      composer.setPixelRatio(renderer.getPixelRatio())
      composer.setSize(w, h)
    },
    render() {
      if (enabled && composer) composer.render()
      else renderer.render(scene, camera)
    },
    // Where the scene itself is drawn (the bloom chain's HDR buffer, or null = the canvas). Shaders are
    // compiled per target (tone mapping + colour space differ), so warmup.js compiles against this one.
    sceneTarget() {
      return enabled && composer ? composer.readBuffer : null
    },
  }
}
