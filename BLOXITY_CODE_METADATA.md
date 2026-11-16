---
canDie: false
hasScore: true
rewards: false
---

# Bloxity integration metadata (Build the Skyscraper)

Read by Bloxity's `audit_sdk` / `integrate_sdk` before publishing. The frontend is `src/`, the game server is `../Build-the-skyscraper-backend`.

## Implemented

- SDK init, loading steps, `gameplayStart/End`, auth (`onUserChanged`), settings (`graphics_quality`, `camera_sensitivity`, `show_fps`, `fullscreen`, `master_volume`, `enable_chat`), avatar + proportions + customizer, `respawn_request`, reserved UI areas (`src/bloxity.js`).
- Multiplayer through the matchmaker (`Legion.SDK.net.resolveEndpoint`), the game token in the join options (the server verifies it with Bloxity), `?roomId=` deep links, `game.updateRoom` (`src/net.js`).
- Leaderboards: `leaderboard.define` for six boards (`BLOXITY_BOARDS`, `src/config.js`); the server reports the scores from its own saved state (`hasScore: true`).
- Ads: `ads.onBreakStart/onBreakEnd` pause and mute the game, `ads.declareScreens({ gameplay: {} })`.
- Other players' avatars, emotes and chat bubbles (`remotePlayers.js`, `emotes.js`, `chatBubbles.js`).

## notApplicable

- `gems`: not integrated on purpose. Nothing in the game is ever bought with Gems/Robux (project rule); every price is in-game cash.
- Rewarded ads (`ads.showRewarded`): not offered, so `rewards: false`. There is no server-side reward-verify path.
- Death screen (`deathScreen`): `canDie: false`. Falling out of the world only respawns the player (`R` / `respawn_request`).
- Party / play-with-friends / `party.enable`: hosted matchmaking seats parties automatically (`maxClients` 50, within 2-100); the game runs no private-room servers of its own.
- `carriedFrom` (guest progress carried into an account): guests are never saved on the server. They keep their progress in localStorage, and the first account that signs in on that browser adopts it (`src/net.js`, `stats.js` save owner).
- Sign-in / sign-out / menu / chat box / emote / invite / friends / avatar editor buttons: drawn by Boxity, never by the game.
- Stats reporting (`/v1/games/{id}/stats`): handled by the backend, not the frontend.
