# HANDOFF — SKI Together

For the next Claude picking this up with Jurek. Written 2026-08-03, after the
second playtest round (commit `26a45e3`).

Read `README.md` first for what the game is. This file is only what you need to
know that the code does not tell you.

---

## Where it stands

The whole game is built and live at **https://jerzysukiennik.github.io/ski-together/**
(repo `JerzySukiennik/ski-together`). Two playtest rounds are done. Everything
Jurek reported in round two is fixed and committed, but **none of it has been
played by a human yet** — that is the next thing that should happen.

```bash
npm test          # 93 checks; 4 fail ON PURPOSE — see "the open defect" below
python3 serve.py 8123
```

`serve.py` sends no-cache headers on purpose: a stale ES module turns one typo
into a debugging session.

---

## The ten things Jurek asked for in round two, and what was done

1. **Snow too white and flat, no relief** — albedo and ambient were high enough
   that midday landed past the flat part of the ACES curve, so a lit slope and a
   shaded one came out within a few percent of each other on screen. Both pulled
   down; the terrain now marches its own height field for a sun shadow and a sky
   occlusion term. `src/world/terrainMesh.js`.
2. **Nothing left tracks** — see "the bug worth knowing about" below.
3. **Both lifts too high** — **NOT ACTUALLY FIXED. See "the open defect".**
4. **Some roofs inverted** — all three pitched buildings were inside out.
   `tools/build_buildings.py` replaces them.
5. **Nothing had collision** — `src/world/collision.js`, plus a test that every
   place the player must reach is still reachable.
6. **HUD too big while skiing** — scales to 0.74 and fades the parts you do not
   read at speed.
7. **Too few sounds, all should be fetched** — audio is now entirely recordings.
8. **Walking on skis was bad** — herringbone arrives in kicks; there is a reverse
   shuffle on `S` at walking pace; on foot the movement is camera-relative.
9. **Turning was bad** — a pivot term was added alongside carving.
10. **Animations** — pose blending, landing absorption, pole plants,
    counter-rotation.

---

## The bug worth knowing about

`SnowField.pass()` accumulated with `value + dose | 0`. The physics runs at
120 Hz, so one substep deposits well under one unit — and `3 + 0.4 | 0` is `3`.
**Every dose below one was thrown away.** A ski could run the length of the
mountain and leave the snow bit-for-bit untouched, which is exactly what Jurek
saw. The fix carries the fraction as a probability (`quantise()` in
`src/shared/snowfield.js`).

The lesson generalises: any 8-bit field accumulated in small increments has this
failure mode, and it is invisible to every test that writes big values at once —
which is what `tests/terrain.test.mjs` was doing.

The second half of the same problem was shading. **A real carve on a groomed
piste is a rut about 1.5 cm deep**, measured. So the mark cannot come from the
depth, and turning the depth up to make it visible would be a lie. It comes from
the snow in the track being a different material: packed, bluer, polished, and
with the tiller marks gone.

---

## The open defect: the lifts really are too high

`npm test` is red on four checks and that is deliberate. Do not make them green
without fixing the cause.

Round two rewrote the cable profile and reported it fixed. It was not. The test
rebuilt both lifts from parameters typed in a second time and **left out
`canSupport`**, so it measured a chairlift with 39 pylons hugging the ground
while the game shipped one with 14 and rope 38 m in the air. Both said "passing".

`liftSpecs()` in `src/world/resort.js` is now the single description of both
lifts, used by the game and by the test, so they cannot drift apart again. With
the real thing measured:

    chairlift: 1180 m, 20 pylons — cable 5.9-26.7 m up, 95% under 16.4 m
               rider averages 6.4 m above the snow  (target: under 5.0)
    drag lift:  380 m, 12 pylons — cable 4.3-12.6 m up, 95% under 10.0 m

**The cause is routing, not the cable solver.** The chairlift line runs up the
middle of the runs, so nearly every position the solver wants a pylon in is on a
piste, `canSupport` refuses it, and the rope spans the gap instead. Two ways of
forcing a pylon in anyway were tried and both reverted — they put hard obstacles
in the middle of the red run, which `tests/collision.test.mjs` catches and which
is worse than a high rope.

The fix is to route the line clear of the pistes. That moves both terminals, so
it touches the run starts, the buildings and the unload point: a design change,
not a constant. A sweep of candidate summit approaches is in the session log; the
best on gradient alone (`summit + (40, 45)`, steepest pitch 71% instead of 163%)
runs straight up the red, so it needs the whole line moved, not just the top.

## Things that will bite you

- **The Browser pane's tab does not tick `requestAnimationFrame` when it is not
  the visible tab.** The game freezes, `javascript_exec` still runs, and the
  stale `stats.fps` reads 59 — so it looks like it is running and nothing moves.
  To drive it, patch the clock and call the frame loop by hand:
  ```js
  const rd = e.clock.getDelta.bind(e.clock);
  e.clock.getDelta = () => 1 / 60;
  for (let i = 0; i < 600; i++) e.frame();
  e.clock.getDelta = rd;
  ```
  This is the third time this family of bug has cost this project a session (see
  `gzowo-tv`, and the loading screen in round one).
- **`e.camera.up` is not reset by `FollowCamera`.** If you set it to inspect
  something from above, put it back or every later shot is tilted.
- **Blender's `-Y` is the game's `+Z`.** A model built facing `+Y` arrives facing
  away. This is what put the whole character backwards in round one.
- **A bounding box cannot tell a gable from its mirror image.** That is how three
  inverted roofs survived a playtest. `tools/render_models.py` renders every
  top-level object of a `.glb` to a PNG — run it before trusting any hand-made
  asset, and show Jurek the picture.
- Another chat may already have a dev server on **8123** in this folder. Do not
  restart it; run your own on another port.

---

## Shape of the code

```
src/shared/     terrain and snow — pure JS, runs in Node so the tests measure it
src/core/       renderer, frame loop, quality governor, input
src/world/      terrain mesh, sky, forest, resort, lifts, groomer, spray, collision
src/player/     skier physics, avatar, ragdoll, camera
src/gear/       the shop's stock
src/ui/         HUD and panels
src/net/        rooms, WebRTC, snow sync
src/audio/      every sound, all fetched
tools/          Blender build scripts and the .glb inspectors
```

Everything visible is generated by a script in `tools/`. There is no hand-made
asset left without a source file — that was true of `buildings.glb` and is the
reason its roofs were wrong.

### Numbers that are load-bearing

- `CLEARANCE = { chair: 6.0, drag: 4.4 }` in `resort.js` — the whole lift height
  fix hangs off these, and `tests/terrain.test.mjs` measures the result.
- `CARVE_MAX = 0.28` m in `snowfield.js` — the geometry budget for a rut. A fresh
  track uses about 5% of it. Do not raise it to make tracks show.
- The turn radii printed in `src/gear/catalog.js` are real inputs, and
  `tests/physics.test.mjs` measures whether the skier honours them. They
  currently land within about a metre.

---

## What is NOT done

- **Multiplayer has never run on two machines.** There is no
  `assets/firebase.json`, so the game deliberately runs solo and says so. Someone
  needs to make a Firebase project, drop the web config in, and test two
  browsers. The code path exists and the snow-sync patch format is under test,
  but that is not the same as having run it.
- **The host-without-rendering mode** from the interview (weak machine hosts,
  strong machine renders) is designed but there is no `host.html`.
- **Buildings are shells.** You walk into a zone, not a room. The models now have
  doors and windows but no interiors.
- **`assets/audio/music.mp3`** (Jurek's, 3.8 MB) plays in the cafe only. Menu
  music is not wired: audio cannot start before the first user gesture and the
  menu is before it.
- Round two's fixes have not been played. **Do not assume they feel right** —
  one of them turned out not to be a fix at all.
- **Do not trust a passing acceptance test that constructs its own copy of the
  thing under test.** That is how the lift bug survived a whole round. If a test
  needs the game's parameters, it should import them.

---

## How Jurek works

Read the vault first — `~/Downloads/Claude/ClaudeMemory/`, especially
`projects/ski-together.md`, `core/communication.md` and `core/agent-habits.md`.
The short version:

- Pure vibecoding. He does not touch code, terminal or git. You do all of it.
- He reports playtest findings as a numbered list. Work through all of them; do
  not narrow the scope.
- He likes being shown things. Send rendered files in chat — before/after images,
  screenshots — rather than describing them.
- Talk to him in Polish. Code, comments and commits in English.
- If his idea has a flaw, say so plainly and propose better. He does not want
  hedging.
- Measure instead of guessing, and prefer a test that will catch the regression
  next time over a fix you eyeballed once.

---

Built with [Claude Code](https://claude.com/claude-code).
