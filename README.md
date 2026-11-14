# Ember Yard — a three.js tactical FPS

A round-based tactical first-person shooter in the style Counter-Strike made famous,
built on three.js 0.187.0 with no build step and no network requests. Ember attacks,
Vigil defends: plant the charge at Site A (North Dock) or Site B (South Yard), or wipe
the other team out. Money earned each round buys rifles, SMGs, grenades and kevlar
between rounds. First to 7 rounds takes the match.

## How to play

- **W A S D** — move (acceleration, with friction when you stop)
- **Mouse** — look (click the panel to capture the pointer)
- **Click** — fire. Stopping to aim pays: spread grows while you move and with each
  shot, and crouching tightens it. Headshots deal triple damage.
- **R** — reload. **1 / 2 / 3** — switch between the weapons you own.
- **B** — buy menu during the freeze time between rounds (Longhorn rifle $2700,
  Hornet SMG $1500, frag grenade $300, kevlar $650). You start with $800 and the
  Sidewinder pistol.
- **G** — throw a frag grenade. **E (hold)** — plant the charge inside a site;
  it detonates 35 seconds later unless Vigil defuses it.
- **Ctrl / C** — crouch. **Shift** — sprint. **Space** — jump.

Bots fight on both teams: Ember teammates push the sites along the rail line, the
middle yard or the container row, while Vigil holds the sites, patrols mid and reacts
to gunfire they hear. Bots plant and defuse the charge too, so a round can end on the
objective even if you never fire a shot.

## How to run

```sh
node serve.ts
# open http://localhost:8080 in desktop Chrome
```

Or serve `game/` with any static file server. The game is plain ES modules under
`game/`; `game/index.html` is the entry point and three.js 0.187.0 is vendored under
`game/vendor/three/`.

## Layout

- `game/src/main.js` — boot and the fixed 60 Hz sim / render loop
- `game/src/world.js` — the Ember Yard map, colliders, sites and bot routes
- `game/src/player.js` — movement: acceleration, crouch, sprint, jump, collision
- `game/src/weapons.js` — rifle / SMG / pistol / grenade, view models, spread
- `game/src/bots.js` — bot AI: routes, vision, hearing, bursts, plant/defuse
- `game/src/rounds.js` — round state machine and the economy
- `game/src/hud.js` — the DOM HUD (health, ammo, money, timer, score, buy menu)
- `game/src/audio.js` — procedural WebAudio sounds, no audio files
- `game/src/input.js` — keyboard, mouse and pointer lock
- `game/src/palette.js` — the dusk-desert look plan, in one place

## Screenshots

`?shot=start|play|site|end&seed=N` renders a deterministic frame for capture
(`window.__shotReady` is set when it is painted). `?demo=1` starts a round without
pointer lock, for headless testing.
