import './interact.css'
import { Vector3 } from 'three'
import { anyWindowOpen } from './uiWindow.js'

// Proximity prompts: near something usable a dark pill floats over it with the key, what
// it is and what pressing does ("E  Bench Press / Train +25 Strength"). E (or tapping the
// pill, the touch path) runs it. In portrait the pill docks above the bottom of the screen
// instead of over the object so it never hides under a thumb or the HUD.
// A target: { x, y, z, r, info() -> { title, verb, price?, off? } | null, run() }.

export function createInteract() {
  const prompt = document.createElement('button')
  prompt.type = 'button'
  prompt.className = 'ix-prompt'
  prompt.hidden = true
  prompt.innerHTML = '<span class="ix-key">E</span><span class="ix-text"><span class="ix-title"></span><span class="ix-verb"></span></span>'
  const titleEl = prompt.querySelector('.ix-title')
  const verbEl = prompt.querySelector('.ix-verb')
  prompt.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    trigger()
  })
  document.body.append(prompt)

  const targets = []
  let active = null
  let shownKey = ''
  let enabled = true
  const v = new Vector3()

  function trigger() {
    if (!active || anyWindowOpen()) return false
    const info = active.info()
    if (!info || info.off) return false
    active.run()
    shownKey = ''
    return true
  }

  return {
    add(t) {
      targets.push(t)
      return t
    },
    trigger,
    setEnabled(on) {
      enabled = on
    },
    get active() {
      return active
    },
    update(camera, pos) {
      active = null
      let info = null
      if (enabled && pos && !anyWindowOpen()) {
        let best = Infinity
        for (const t of targets) {
          const ty = typeof t.y === 'function' ? t.y() : t.y ?? 1
          const tx = typeof t.x === 'function' ? t.x() : t.x
          const tz = typeof t.z === 'function' ? t.z() : t.z
          if (Math.abs(pos.y - (ty - 1.2)) > 3) continue
          const d = Math.hypot(pos.x - tx, pos.z - tz)
          if (d < t.r && d < best) {
            const i = t.info()
            if (!i) continue
            best = d
            active = t
            info = i
            v.set(tx, ty + 0.6, tz)
          }
        }
      }
      if (active) {
        v.project(camera)
        if (v.z > 1) active = null
      }
      prompt.hidden = !active
      if (!active) return
      const key = `${info.title}|${info.verb}|${info.price ?? ''}|${info.off ? 1 : 0}|${info.short ? 1 : 0}`
      if (key !== shownKey) {
        shownKey = key
        titleEl.textContent = info.title
        verbEl.innerHTML = ''
        verbEl.append(info.verb)
        if (info.price != null) {
          const cost = document.createElement('span')
          cost.className = `ix-cost${info.short ? ' short' : ''}`
          cost.textContent = info.price
          verbEl.append(cost)
        }
        prompt.classList.toggle('off', !!info.off)
      }
      const w = window.innerWidth
      const h = window.innerHeight
      let x = Math.min(w - 110, Math.max(110, ((v.x + 1) / 2) * w))
      let y = Math.min(h - 140, Math.max(120, ((1 - v.y) / 2) * h))
      if (h > w) {
        x = w / 2
        y = h * 0.62
      }
      prompt.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`
    },
  }
}
