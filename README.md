# SKI Together

A ski resort in a browser tab, for two to five people. Rent a set, ride the lift,
and ski a mountain whose snow remembers every turn anybody took on it.

**Play:** https://jerzysukiennik.github.io/ski-together/

No install, no build step, no download beyond the page itself.

---

## The snow is the game

The mountain is covered by a grid of half-metre cells. Each one remembers two
things: what condition it is in, and how deeply it has been cut into.

```
freshly groomed  →  skied  →  scraped  →  ice, with rock showing through
                                    (and off-piste: untracked powder)
```

Both are read by the physics on the CPU and uploaded to the GPU as textures, so
**the rut you see is the rut you feel**. Riding wears the cell down and cuts a
groove into the actual geometry of the terrain. Nothing regenerates on its own.

That single system does all of this at once:

- **Wear.** The popular line down the red is ice by the fortieth descent, and it
  is measurably faster and measurably harder to hold than the fresh snow two
  metres to the side.
- **Grooming.** The only way snow comes back is a player driving the machine out
  of the garage. It pays by the square metre genuinely restored, so driving
  circles on fresh corduroy earns nothing.
- **Walking.** In ski boots you stride on a groomed piste, slip on ice, and wade
  to the knee in powder — and you find that out the first time you crash, because
  your skis come off and you have to walk over and pick them up.
- **Off-piste.** Deep, slow, and never groomed. It is also where the shortcuts
  and the hidden jumps are.

## Skiing, not driving

The physics is written for this game rather than borrowed from a rigid-body
engine. Every force is one that was chosen: gravity down the fall line, edge grip
capped by the snow underfoot, drag that depends on what the base is running over,
and air resistance a tuck cuts by a third.

**Speed is what is left when you stop turning.** Measured, on a 27.5% pitch:

| | |
|---|---|
| Straight, upright, rental skis | 61 km/h |
| Same slope, tucked, race skis | 82 km/h |
| Same slope, linking full-edge turns | 48 km/h |
| Off-piste in powder | 11 km/h |
| Snowplough, from 37 km/h | stopped in 4 s |

The three numbers printed on every ski and board in the shop are real inputs to
that model: turn radius, top speed, edge grip. A slalom ski measures a 15 m arc
against the sport ski's 40 m, and on ice the race ski completes a turn the rental
pair cannot.

## The mountain

One mountain, carved rather than authored — each run's difficulty comes from the
line it takes down real terrain:

| Run | | Length | Drop | Average |
|---|---|---|---|---|
| **Panorama** | blue | 1735 m | 329 m | 19.0% |
| **Kanciarz** | red | 1196 m | 328 m | 27.5% |
| **Ostrze** | black | 845 m | 249 m | 29.5% |

The blue is easy because it refuses to go straight down. The black does not reach
the valley at all: it falls down the east face and feeds into the red halfway
down, which is exactly why the lower red is the first thing to get skied out.

Kickers are terrain, not props, so the same movement code that skis also launches:
the biggest gives 1.7 s of air and 4.2 m of height.

## Riding up

A **five-seat chairlift** runs the full mountain; a **drag lift** serves the lower
blue and tows you on your skis, on the snow, where you can still fall off. Both
are real cable, real pylons sized to clear the ground, and real carriers — you sit
on the chair and look wherever you like for the whole ride.

*One honest compromise:* at a realistic 5 m/s the chair would take four minutes.
It runs at 14 m/s instead, which puts the ride at about ninety seconds.

## Everything else

- **Rental shop, colour booth, cafe and garage** — buildings you walk into. The
  lift will not take you without a helmet and boots that match what you are
  riding.
- **Crashes** are the full comedy: a Verlet ragdoll, and your gear leaves. It
  lands 5–15 m away and glows faintly so you can find it in a white world.
- **Cold** is a second bar that never ends your run — low warmth means shivering
  and an edge that holds less well. The cafe, the bonfire and a hot tea fix it.
- **A live day cycle** from morning to floodlit night. The lamps genuinely light
  the snow: the terrain's custom shader was taught about them by hand, because a
  custom shader gets no scene lights for free.
- **Points last for one session only**, so the shop is balanced to hand you your
  first unlock within a few descents.

## Playing together

WebRTC peer to peer, in a star: every guest holds one connection, to the host, and
the host repeats what it hears to everyone else. Firebase does two things and no
more — it lists the open rooms and carries the handshake. It is the shared
`gzowos-games` Realtime Database, and everything this game writes lives under
`skiTogether/`, because `rooms/` at the top level belongs to another game.

Each connection carries two channels, because the two kinds of traffic want
opposite things:

- **`ski`** — unreliable and unordered, for positions at 20 Hz. A lost packet is
  replaced 50 ms later; re-sending it would only make the skier stutter.
- **`snow`** — reliable and ordered, chunked into 16 kB frames, for the snapshot,
  the snow patches and identities. A half-arrived snapshot is worse than none.

The snow has one owner. The host holds the field, sends a compressed snapshot on
join (**48 kB fresh, 166 kB after forty descents**), and streams only the cells
that changed after that. Guests carve too, so they ship their rectangles up to the
host, which applies them and passes them on — otherwise only the host's tracks
would exist. If the host leaves, the next player picks it up with the copy they
already have.

**Solo is a complete game** — a room of one, with everything working.

The Firebase web config lives in `assets/firebase.json`. It is a public
identifier, not a secret; what protects the data is `database.rules.json`.

**Deploying rules is dangerous and has a procedure.** The database is shared with
every other Gzowo game and has one ruleset for the whole instance, so a deploy of
your own block alone silently deletes theirs:

```bash
firebase database:get "/.settings/rules" --project gzowos-games \
  --instance gzowos-games-default-rtdb > work/firebase/live-rules-backup.json
node work/tools/merge-rules.mjs      # our block into a copy of the LIVE rules
firebase deploy --only database
```

Then read the rules back and check the other games' blocks are still there.

### Testing the network

`tests/net-harness.html` runs two — and then three — whole Sessions in one page,
against the real Firebase and real WebRTC, with stub games around them. Serve the
project and open `/tests/net-harness.html`: it opens a room, joins it, checks the
snapshot arrives whole, that tracks travel in both directions and between two
guests through the host, that a carve does not echo back and forth for ever, and
that leaving cleans up. Seventeen checks, and it is the only thing here that
exercises the wire.

## Running it

```bash
python3 serve.py 8123
```

The dev server sends no-cache headers on purpose: a stale ES module turns one typo
into a debugging session.

```bash
npm test
```

Two suites, 60-odd checks, no browser required. They measure the things that are
easy to get wrong and impossible to eyeball: that no run ever climbs, that the
black really is steeper than the blue, that a schuss settles at a believable
speed, that ice makes the edge let go, that a groomer restores what a day of
skiing took away.

## How it is built

Plain ES modules, [three.js](https://threejs.org) 0.169 from a CDN, no bundler.

```
src/shared/     terrain and snow — pure JS, runs in Node so the tests can measure it
src/core/       renderer, frame loop, quality governor, input
src/world/      terrain mesh, sky, forest, resort, lifts, groomer, spray
src/player/     skier physics, avatar, ragdoll, camera
src/gear/       the shop's stock
src/ui/         HUD and panels
src/net/        rooms, WebRTC, snow sync
src/audio/      synthesised where it must react, recorded where it must be recognised
assets/models/  every model, generated in Blender through the MCP bridge
```

The terrain renders as a camera-centred clipmap: seven concentric rings, half a
metre under your skis out to thirty-two metres at the horizon, about 100 000
triangles for three kilometres of mountain. The forest runs in two tiers — real
geometry for the trees you could ski into, a six-face proxy for the other five
thousand.

Sound follows one rule: anything that has to *react* is synthesised, because a
sample cannot follow your speed; anything that has to be *recognised* is a real
recording.

---

Built with [Claude Code](https://claude.com/claude-code).
