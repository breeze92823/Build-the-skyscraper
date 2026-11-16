import { DAYNIGHT, EVENTS } from './config.js'
import { boosts } from './stats.js'

// Two clocks that run on their own:
//  - the day / night cycle: day -> dusk -> night -> dawn, driving lighting.setNight
//    (N or the moon button skips to the next phase)
//  - world events: every EVENTS.gap seconds one of EVENTS.list runs for EVENTS.length
//    seconds, multiplying cash / gym gains / build speed for everyone (stats.boosts).

export function createDayNight(lighting) {
  const D = DAYNIGHT
  const total = D.day + D.dusk + D.night + D.dawn
  let t = D.startAt
  let night = 0
  function value(time) {
    let x = time % total
    if (x < D.day) return 0
    x -= D.day
    if (x < D.dusk) return x / D.dusk // 0 -> 1 through dusk (0.5 = the sunset itself)
    x -= D.dusk
    if (x < D.night) return 1
    x -= D.night
    return 1 - x / D.dawn
  }
  return {
    get night() {
      return night
    },
    // Jump to the start of the next phase (with a short blend handled by the cycle itself).
    skip() {
      const x = t % total
      const ends = [D.day, D.day + D.dusk, D.day + D.dusk + D.night, total]
      const next = ends.find((e) => e > x + 0.5) ?? total
      // Day -> straight to dusk's start; dusk -> night; night -> dawn; dawn -> day.
      t += next - x
    },
    update(dt) {
      t += dt
      night = value(t)
      lighting.setNight(night)
      return night
    },
  }
}

export function createEvents() {
  let clock = EVENTS.gap * 0.35 // the first event comes sooner
  let current = null
  let left = 0
  let index = Math.floor(Math.random() * EVENTS.list.length)
  const listeners = []
  function apply() {
    boosts.eventCash = current?.cash ?? 1
    boosts.eventGym = current?.gym ?? 1
    boosts.eventBuild = current?.build ?? 1
  }
  return {
    on(fn) {
      listeners.push(fn)
    },
    get current() {
      return current
    },
    update(dt) {
      if (current) {
        left -= dt
        if (left <= 0) {
          current = null
          clock = EVENTS.gap
          apply()
          listeners.forEach((fn) => fn(null))
        }
      } else {
        clock -= dt
        if (clock <= 0) {
          current = EVENTS.list[index++ % EVENTS.list.length]
          left = EVENTS.length
          apply()
          listeners.forEach((fn) => fn(current))
        }
      }
      return current ? { name: current.name, color: current.color, left, length: EVENTS.length, desc: current.desc } : null
    },
    nextIn: () => clock,
  }
}
