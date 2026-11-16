// Chat bubbles over players' heads (docs.bloxity.io #chat). Boxity draws the chat box itself and
// delivers every message of the room through `Legion.SDK.chat.onMessage`; the game only shows the text
// above the sender for `bubbleSeconds`. The sender is our own avatar (`isLocalPlayer`) or the roster
// player whose `uid` matches `userId`. A newer message from the same player replaces their bubble.
// Never builds a chat UI and never throws; without the SDK (dev mode) nothing happens.
import * as THREE from 'three'
import { sdk, settings } from './bloxity.js'
import { normId } from './net.js'

const HEIGHT = 3.6 // m above the feet: over the name tag (which floats at 2.5 m)
const SCALE = 0.6

// remotes.anchorByUid(uid) -> Object3D | null; getLocalPos() -> { x, y, z } (our feet);
// getLocalScale() -> body scale (robot suits are bigger); isLocalVisible() -> false in first person.
export function createChatBubbles(scene, { remotes, getLocalPos, getLocalScale = () => 1, isLocalVisible = () => true }) {
  const mine = new THREE.Object3D() // unrotated, at our feet: a bench lies the avatar down
  scene.add(mine)

  function show(anchor, text, height) {
    try {
      const chat = sdk()?.chat
      if (!anchor || !chat?.attachBubble) return
      anchor.userData.bubble?.remove?.()
      anchor.userData.bubble = chat.attachBubble(THREE, anchor, text, { seconds: chat.bubbleSeconds ?? 4, height, scale: SCALE })
    } catch (err) {
      console.warn('[chatBubbles] bubble failed', err)
    }
  }

  try {
    sdk()?.chat?.onMessage?.((m) => {
      try {
        if (settings.enable_chat === false) return
        const text = sdk().chat.bubbleText(m)
        if (!text) return
        if (m.isLocalPlayer) show(mine, text, HEIGHT * getLocalScale())
        else show(remotes.anchorByUid(normId(m.userId)), text, HEIGHT)
      } catch (err) {
        console.warn('[chatBubbles] message failed', err)
      }
    })
  } catch (err) {
    console.warn('[chatBubbles] could not subscribe', err)
  }

  return {
    // Once per frame.
    update() {
      const p = getLocalPos()
      mine.position.set(p.x, p.y, p.z)
      mine.visible = isLocalVisible()
    },
  }
}
