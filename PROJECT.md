# just_fun — project state, architecture and plans

An interactive 3D portfolio: a walkable scene where the visitor clicks the floor
to move an avatar around, and four billboards each embed a real HTML page
(about / experience / skills / portfolio) that the camera flies into.

Live repo: `git@github.com:MiriDS/just_fun.git` · deployed as a static bundle.

---

## 1. Stack and commands

| | |
|---|---|
| Build | Vite 4 + `@vitejs/plugin-react` |
| UI | React 18 |
| 3D | three 0.153, `@react-three/fiber` 8.13, `@react-three/drei` 9.80 |
| Physics | `@react-three/rapier` 1.5 (lazy-loaded) |
| Tuning | `leva` 0.9 |
| Node | v22 |

```bash
npm run dev       # http://localhost:5180   (port pinned in vite.config.js)
npm run build     # -> dist/, then pre-compresses it (.gz/.br) for the server
npm run preview   # http://localhost:5181

npm --prefix server run dev     # presence server on :5183
npm --prefix server run smoke   # its 29 protocol checks

docker build -t just-fun . && docker run --rm -p 3000:3000 just-fun
```

The leva tuning panel shows in dev, or on any build with `?debug` in the URL
(`SHOW_TUNER` in `App.jsx`). The "Copy settings" button in the Lighting folder
dumps the whole light rig as JSON so a look can be pasted back in as defaults.

---

## 2. Scene architecture

```
App.jsx                     Canvas + focus state + Esc/back button + Leva + Loader
└── Experience.jsx          scene graph root, billboard list, ground click plane
    ├── Lighting.jsx        env map, key/fill lights, contact + ground shadows, fog
    ├── Ground.jsx          reflective floor + infinite grid
    ├── Scatter.jsx         rapier debris (lazy, own Suspense boundary)
    ├── Avatar.jsx          one character: cloned model, animations, walking
    ├── RemotePlayers.jsx   an Avatar per connected visitor
    ├── ChatBubble.jsx      what someone just said, over their head
    ├── Billboard.jsx  ×4   panel, iframe page, label, projectors, floor marker
    └── CameraRig.jsx       intro sweep, follow camera, billboard focus mode

    usePresence.js          the socket: who is here, their clicks, their chat
```

### Coordinate system and key world numbers

- **Floor sits at `y = -0.5`.** Reflector at `-0.52`, grid at `-0.51`, shadow
  catcher above both — stacked in 1cm steps so the coplanar surfaces never
  z-fight.
- **Avatar** is mounted at `position-y={-0.5}` and only ever moves in x/z.
  Roughly 1.7 units tall.
- **Billboards** live in a `scale={0.02}` group, so their local `[0,0,-100]`,
  `[250,0,-100]`, `[500,0,-100]`, `[750,0,-100]` land at world
  **x = 0, 5, 10, 15, z = -2**. The "stand here" floor markers are at
  **z = -0.2**.
- **Clickable floor** is a 500×500 invisible plane (`±250`), but the physics
  floor is `±60` and fog closes in at 62, so the usable world is about `±60`.
- Avatar spawns at the origin; the camera settles at `[8, 8, 8]`, fov 30.

### Movement model (important — the multiplayer plan depends on it)

`Avatar.jsx` is driven entirely by a `motion` object (see `createMotion`),
whose `target` is `[x, z]` or `null` to stand still. It is mutated rather than
set as state: for the local player it changes on every click, for remote
players on every packet, and none of that is worth re-rendering the scene for.
Everything else is derived each frame:

| Constant | Value | Meaning |
|---|---|---|
| `WALK_SPEED` | 1.6 | units/sec |
| `RUN_SPEED` | 4.4 | units/sec |
| `RUN_DISTANCE` | 3.5 | further than this, break into a run |
| `TURN_SPEED` | 10 | how fast the avatar swings to face the target |
| `ARRIVAL_DISTANCE` | 0.05 | close enough; stop |
| `IDLE_DANCE_DELAY` | 60 | seconds standing still before it dances |

Because motion is a pure function of `target` + current position + these
constants, **any client can reproduce any other client's walk, given only the
click.** That is the whole basis of the netcode below. Measured: replaying the
same click at 60fps, 5fps and 1fps all stop within `ARRIVAL_DISTANCE` of the
target, so two copies agree to within 2× that (10cm) — the last few centimetres
are what the idle correction closes.

`motion` also carries two network fields: `origin`, an exact position adopted
whole (a spawn point, or where a remote player stood when they clicked), and
`correction`, a position up to a second old that is eased onto **only while
standing still** — leaning on one mid-walk would drag the avatar back to where
its owner was a second ago.

Each Avatar gets its own `SkeletonUtils.clone` of the model. Geometry and
materials stay shared, so a second visitor costs a skeleton, not a download.

Animations are Mixamo FBX clips (`Idle`, `Walking`, `Running`, `Dance`,
`Crouch`) retargeted onto `Animated.glb`, cross-faded over 0.5s.

### Camera

`CameraRig.jsx` runs three modes:

1. **Intro** — a 6s Catmull-Rom sweep (`INTRO_PATH`) that starts beside the last
   billboard and lands exactly on the default camera pose. Any click or keypress
   skips it with a 0.6s ease. The skip hint is suppressed until loading is done.
2. **Follow** — nudges the OrbitControls pivot toward the avatar and translates
   the camera by the same amount, so the user's chosen orbit angle and zoom
   survive. Exponential smoothing, `FOLLOW_LAMBDA = 4`.
3. **Focus** — computes the exact camera pose for a billboard panel to fill the
   viewport (accounting for fov *and* aspect, so nothing spills off the edges)
   and animates to it over 0.9s. OrbitControls stays *enabled* throughout —
   drei only calls `update()` while enabled — so input is disabled via
   `enableRotate`/`enableZoom` instead.

### Billboards

Each is `Billboard.glb` plus an extruded `Text3D` label, a floor marker ring you
click to focus, and a drei `<Html transform>` iframe of a real page from
`public/pages/`. The iframe is only made interactive when that board is focused.

Escape exits focus, but once the user clicks *into* the iframe, keyboard focus
moves inside it and our `keydown` stops firing — so the pages post
`{ type: "billboard:exit" }` back out and `App.jsx` listens for it. Clicking the
empty space around a focused panel also exits (`onPointerMissed`).

**Projectors:** five lamp housings per board. The visible beams are *geometry*,
not lights — twenty real spot lights compiled `NUM_SPOT_LIGHTS=20` into every
lit material and overran the uniform limit on some drivers, making every lit
model vanish. There is an optional single real `spotLight` per board
(`castLight`), off by default. As of this session `lamps` also defaults to
**off**.

### Collision

`billboards.js` is the single source of truth for where the four boards stand
and what is solid about them: the scene renders from `BILLBOARDS`, the physics
world builds static colliders from `BILLBOARD_COLLIDERS`, the debris scatter
takes its exclusion circles from `BILLBOARD_KEEP_OUT`, and the character
steers around `isBlocked`.

Measured out of `Billboard.glb`: each board stands on **one central pillar**,
0.90 across and 0.94 deep — not legs at its corners — so a collider spanning
the board's full 4.4m width would be an invisible wall across open ground.

Two separate mechanisms, because they have to be:

- **Debris** meets a fixed `CuboidCollider` per pillar, in the same static body
  as the floor.
- **Characters** do not. The avatar is a *kinematic* body, which rapier drives
  rather than stops, so nothing in the physics world can block it. Walking is
  steered instead: `Avatar` tests each step against `isBlocked` and retries one
  axis at a time, so a character slides along a post rather than sticking to
  it, and gives its target up if the step is refused outright. The footprints
  are pre-grown by the avatar's radius so it can be treated as a point.

Remote avatars run that same code from the same list, so a walk is still
reproducible from the click alone and the netcode premise holds.

There is deliberately **no collider for the panel** four metres up. Nothing can
reach it except an object spawning inside it, and keeping spawns out would need
a circle wide enough to clear debris away from the entire billboard row.

### Physics

`Scatter.jsx` is lazy-loaded behind its own Suspense boundary because rapier
inlines its WASM and more than doubles the main bundle. It drops ~26 rigid
bodies in a disc, laid out by a seeded `mulberry32` RNG so a given seed always
produces the same scene, with `KEEP_OUT` circles around the billboards and the
avatar's spawn. Defaults: 40 objects, seed 1, gravity 5.9, bounciness 0.68. The avatar is a **kinematic** capsule, so it barges through the
debris and is never pushed off course. Velocity and spin are clamped every frame
(`MAX_SPEED` 7, `MAX_SPIN` 12) because a kinematic pusher can otherwise launch
things, and anything falling below `y = -10` is recycled to its spawn.

---

## 3. Conventions

- Comments explain **why**, not what — especially where a value was measured out
  of a model, or where an obvious approach was tried and failed. Keep that
  standard; several comments in here are load-bearing bug history.
- Tunable numbers go in a `leva` folder with a human label, and are declared
  **once** at the level that owns them (the billboard controls live in
  `Experience.jsx`, not in `Billboard.jsx`, because four instances would fight
  over the same leva paths).
- Named constants at module top, `SCREAMING_CASE`, with the measurement or
  reasoning in a comment above.
- Components are `export function X` / `export const X = ` — both appear, match
  the file you're in.

---

## 4. Current state

Last commit: `8a680fc` "going forward", which picked up the in-progress work on
`App.jsx`, `Billboard.jsx`, `CameraRig.jsx`, `Lighting.jsx` and
`vite.config.js`. Uncommitted on top of it: the multiplayer client
(`Avatar.jsx`, `Experience.jsx`, `RemotePlayers.jsx`, `usePresence.js`,
`.env.example`) and this file.

**Changed this session:** billboard projectors now default to off
(`lamps: { value: false }` in `Experience.jsx`). A bike model and then a sci-fi
fan model were each added to the scene as tests and both removed again at your
request; nothing of either remains in `src/`. Multiplayer presence was then
built end to end — see §5, steps 1-4 are done and confirmed working in two real
browsers — followed by chat.

The local player (their `motion`, their position ref and the `usePresence`
connection) is owned by `App.jsx` rather than `Experience.jsx`, because the
chat box that sends their messages is DOM and lives outside the `<Canvas>`.

### Known issues

- **`dist/` is ~800MB.** Vite copies `public/` verbatim, and `public/models/`
  holds three source zips (224MB + 127MB + 37MB) plus their extracted texture
  folders. Move these out of `public/` before deploying — this is the single
  biggest problem in the repo right now.
- `Animated.glb` is **Draco-compressed**, so drei fetches a decoder from
  `gstatic.com` at runtime. The avatar does not load if that CDN is blocked.
- Unused model files still on disk: `bike.fbx`, `fan_low.fbx`,
  `mesh_for_mixamo_*.fbx`, `scene.gltf`, `Typing.fbx`, `animations.glb`.
- Importing `three/examples/jsm/loaders/FBXLoader` directly costs ~48kB, because
  drei already bundles its own FBX loader (from `three-stdlib`) for the avatar
  animations. **Use drei's `useFBX` instead** for any new FBX model.
- Main chunk is 1.35MB (394kB gzip); the rapier chunk is 2.08MB.

---

## 5. Plan: multiplayer presence

**Goal.** Visitors see each other in the scene, like a small online world. Every
player is a walking avatar. Same look for everyone in v1; later, randomly
assigned outfit textures per player.

### The core decision: replicate intent, not position

Do **not** stream positions at 10–20Hz. Since motion is a pure function of the
click (see §2), the wire message is the click itself:

```js
{ type: "move", id, target: [x, z], from: [x, z] }   // ~40 bytes, once per click
```

Remote avatars run the same `Avatar.jsx` frame logic and produce identical
motion, with correct walk/run/turn/idle transitions for free. Under 1 KB/s for
30 players, and smooth on a bad connection because nothing waits on packets.

The cost is drift — background tabs get their rAF throttled, and late joiners
need current state. Correct it with a low-rate channel: each client reports its
true position ~1×/sec, the server rebroadcasts, and remote avatars **ease**
toward the correction rather than snapping to it.

### Decisions taken

| Decision | Choice | Why |
|---|---|---|
| World | One shared room, capped at ~20 visible players | It's a portfolio, not a game lobby |
| Debris | Stays local-only decoration | See below |
| Appearance | **Server**-assigned | See below |
| Transport | socket.io | Reconnect, heartbeats, rooms for free; ~40kB is worth it |
| Hosting | Separate service from the static site | The site stays static and free |

**Why debris stays local.** `Scatter` is deterministic per seed, so everyone
starts identical — then the first knocked box diverges every client forever,
since each avatar is kinematic in its *own* simulation. Making it authoritative
means running rapier on the server and streaming transforms, which would become
the bandwidth hog of the whole system. So: only the local player gets a
kinematic body; remote avatars walk through the clutter. Nobody notices.

**Why the server assigns appearance.** If each client rolls its own random
outfit, two viewers disagree about what a player is wearing and a reconnecting
player changes clothes. `appearance` is in the join payload from day one, as a
server-assigned integer seed, even though v1 renders one look for everyone.
Costs nothing now; avoids a protocol change later.

### Hazard: `Avatar.jsx` breaks if mounted twice

It renders `<primitive object={nodes.Hips} />` and passes `nodes.X.skeleton`
straight through. Those are single shared objects out of the drei cache — mount
a second one and three re-parents the bones out of the first.

**Fix:** `SkeletonUtils.clone(scene)` per player, with `useAnimations` bound to
the clone. Clips are immutable and can stay shared; drei's cache means no extra
downloads. **Do this refactor first**, before any networking, and verify with
two local dummy avatars. It is the most likely thing to eat a day.

Also budget for draw calls: 6 skinned meshes per avatar, doubled by the shadow
pass. Cap rendered players and let only nearby ones cast shadows.

### Protocol

Client → server:

- `move` `{ target: [x, z], from: [x, z] }`
- `sync` `{ position: [x, z] }` — about 1Hz
- `chat` `{ text }` — one line, trimmed and capped by the server

Server → client:

- `welcome` `{ id, appearance, position, players: [...] }` — snapshot on join
- `player-joined` `{ id, appearance, position, target }`
- `player-left` `{ id }`
- `move` `{ id, target, from }`
- `sync` `{ players: [{ id, position }] }` — batched, ~1Hz, movers only
- `chat` `{ id, text }` — to everyone **including the sender**
- `full` — at capacity, followed by a disconnect

### Build order

1. ~~`SkeletonUtils.clone` refactor~~ — done. Verified: each clone gets its own
   bones, its meshes bind to their own skeleton, two mixers drive them to
   different poses, and geometry/materials stay shared.
2. ~~Server + join/leave~~ — done, `../just_fun_server`, 23 smoke tests.
3. ~~Broadcast `move`; remote avatars walk~~ — done.
4. ~~1Hz sync + easing~~ — done.
5. **Next:** outfits. The plumbing is already there — the server assigns an
   `appearance` integer, `usePresence` keeps it on each player record, and
   `RemotePlayers` is where it would be passed to `Avatar`. What is missing is
   the textures and a swap inside `Avatar`, plus raising `APPEARANCE_COUNT` on
   the server to match.

### Chat

A line typed into the box at the bottom appears in a bubble over the sender's
head, in every browser, for a few seconds.

- **The server echoes the message back to the sender** rather than the client
  showing it optimistically. It costs a round trip, and it buys the guarantee
  that every bubble everywhere holds exactly the same text: the server is the
  only place it is trimmed.
- Bubbles are drei `Html`, which the billboard iframes already pull into the
  bundle, so a bubble costs nothing extra. They are mounted as children of the
  Avatar's group, so they follow it with no code at all, and sit on its axis so
  turning does not swing them around. `pointerEvents: none` — a bubble must
  never eat a click meant for the floor.
- One message per person, replacing the last. It clears after
  3.5s + 55ms per character, capped at 9s.
- The input only appears once connected, after the intro, and never while a
  billboard is focused. With no server configured the site looks exactly as it
  always did.
- `BUBBLE_SCALE` in `ChatBubble.jsx` is the knob for how big bubbles read.
- **No moderation.** Anyone who can open the site can broadcast to everyone
  else. The server strips control characters, bidi overrides and zero-width
  padding, caps length and rate, and logs nothing — but it does not filter
  what is actually said.

### A trap worth remembering

`Avatar` used to end its animation effect with
`return () => actions[animation].fadeOut(0.5)`. That was fine for as long as
there was exactly one avatar and it never unmounted. The moment remote players
could leave, it crashed every other browser in the room and left them staring
at the page background.

drei's `actions` getter is `if (actualRef.current) { ... }` with no else — it
returns **undefined** once the group ref is detached, and React detaches refs
during the commit phase, before passive cleanups run. So never look an action
up inside a cleanup; capture it when the effect runs.

A second thing in the same console output was **not** related and **not** new:
`THREE.PropertyBinding: Trying to update node for track: Armature_1.quaternion
but it wasn't found.` Every Mixamo clip carries 54 tracks over 53 nodes — 53
bones that bind fine, plus one for an armature root called `Armature_1`, which
our character's GLB calls `Armature`. It was always there; multiplayer just
multiplied it by the number of people in the room. `Avatar` now drops
unbindable tracks when it names the clips, which is a no-op for every avatar
after the first because the clips are shared out of drei's cache.

Two things that were *not* the problem, checked at the time: three's
`existingAction` guards its clip lookup with a truthy test, so drei's own
`uncacheAction` cleanup no-ops rather than throwing; and R3F never disposes a
`<primitive>` or recurses into one, so a departing avatar cannot dispose the
geometry and materials it shares with yours.

### What is not done

- **No name tags.** In-scene `Text` beats drei `Html` here (a DOM node per
  player).
- **No shadow budget.** Every remote avatar casts a full shadow; the plan was
  to cap that by distance once there are enough of them to notice.
- **No connection UI.** Failure is silent by design, but there is nothing that
  says "3 others here" either.
- **Chat is unverified in a browser.** The wire is covered end to end, but
  nobody has watched a bubble appear over a head yet.

### How the client is wired

- `usePresence({ motion, positionRef })` in `Experience.jsx` owns the socket and
  returns `{ players, motions, sendMove }`. Joins and leaves are React state;
  everything per-packet is a mutation of a `motion` object.
- The ground click sets `motion.target` **and** calls `sendMove` — the click is
  the whole message.
- `VITE_SOCKET_URL` sets the server. Unset, dev falls back to
  `http://localhost:5183` and **production stays single-player**: the socket is
  never opened and `socket.io-client` is never even downloaded (it is a
  dynamic import, a 43kB chunk of its own).
- If the server is unreachable, five attempts are made and the scene carries on
  alone. No error UI, by design.
- Only the local player has a body in `Scatter`. Remote avatars walk through the
  debris, because two browsers simulating the same rigid bodies diverge the
  moment one of them touches something.
- `CameraRig` still follows the local avatar; no change was needed.
- The 60-second idle → Dance behaviour applies to remote players for free.

---

## 6. Companion server

Lives in this repo at `server/`. Node 22 + socket.io, state in memory. See its
own README for the full protocol, and `DEPLOY.md` for how it ships.

In production it serves the built client as well, so the page and the socket
share an origin: no CORS, no socket URL baked into the client, one domain, one
container. `Dockerfile` at the root builds both.

- `npm --prefix server run dev` → **http://localhost:5183**, `GET /health` for
  status.
  (Not 5182: a stray Vite dev server for this site lands there when 5180/5181
  are busy, and it binds `[::1]` only, so it silently wins every `localhost`
  call.)
- `npm run smoke` boots a real server on :5199 and drives it with real clients —
  23 checks covering join/leave, movement relay, coordinate clamping, malformed
  input, the sync batch, rate limiting and capacity.
- Status: **step 2 of the build order is done** on the server side. Nothing in
  this app talks to it yet; the client work starts with the `SkeletonUtils`
  refactor in §5.
- `VITE_SOCKET_URL` is unset by default: the client talks to its own origin in
  production and to `localhost:5183` in development. `off` disables
  multiplayer.
