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
npm run build     # -> dist/
npm run preview   # http://localhost:5181
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
    ├── Avatar.jsx          the character: model, animations, walk/run logic
    ├── Billboard.jsx  ×4   panel, iframe page, label, projectors, floor marker
    └── CameraRig.jsx       intro sweep, follow camera, billboard focus mode
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

`Avatar.jsx` is driven entirely by a `target` prop of `[x, z]`, or `null` to
stand still. Everything else is derived each frame:

| Constant | Value | Meaning |
|---|---|---|
| `WALK_SPEED` | 1.6 | units/sec |
| `RUN_SPEED` | 4.4 | units/sec |
| `RUN_DISTANCE` | 3.5 | further than this, break into a run |
| `TURN_SPEED` | 10 | how fast the avatar swings to face the target |
| `ARRIVAL_DISTANCE` | 0.05 | close enough; stop |
| `IDLE_DANCE_DELAY` | 60 | seconds standing still before it dances |

Because motion is a pure function of `target` + current position + these
constants, **any client can reproduce any other client's walk exactly, given
only the click.** That is the whole basis of the netcode below.

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

### Physics

`Scatter.jsx` is lazy-loaded behind its own Suspense boundary because rapier
inlines its WASM and more than doubles the main bundle. It drops ~26 rigid
bodies in a disc, laid out by a seeded `mulberry32` RNG so a given seed always
produces the same scene, with `KEEP_OUT` circles around the billboards and the
avatar's spawn. The avatar is a **kinematic** capsule, so it barges through the
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

Uncommitted work in progress on `main` (predates this session): `App.jsx`,
`Billboard.jsx`, `CameraRig.jsx`, `Experience.jsx`, `Lighting.jsx`,
`vite.config.js`.

**Changed this session:** billboard projectors now default to off
(`lamps: { value: false }` in `Experience.jsx`). A bike model and then a sci-fi
fan model were each added to the scene as tests and both removed again at your
request; nothing of either remains in `src/`.

### Known issues

- **`dist/` is ~800MB.** Vite copies `public/` verbatim, and `public/models/`
  holds three source zips (224MB + 127MB + 37MB) plus their extracted texture
  folders. Move these out of `public/` before deploying — this is the single
  biggest problem in the repo right now.
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

Server → client:

- `welcome` `{ id, appearance, players: [...] }` — full snapshot on join
- `player-joined` `{ id, appearance, position, target }`
- `player-left` `{ id }`
- `move` `{ id, target, from }`
- `sync` `{ players: [{ id, position }] }` — batched, ~1Hz, movers only
- `full` — at capacity, followed by a disconnect

### Build order

1. `SkeletonUtils.clone` refactor; two dummy avatars locally.
2. Server + join/leave only — avatars pop in and out at spawn points.
3. Broadcast `move`; remote avatars walk.
4. 1Hz sync + easing.
5. Server-assigned `appearance`, still one look rendered.

Steps are independently verifiable; demoable after step 2.

### Client integration notes

- Socket URL from an env var (`VITE_SOCKET_URL`) so dev and prod differ.
- **If the server is down, degrade silently to today's single-player scene.**
  Plan for it now; it's a one-line guard up front and a refactor later.
- `CameraRig` keeps following the local avatar — no change needed.
- Spawn players apart, not all on the origin.
- The 60-second idle → Dance behaviour applies to remote players for free.
- Name tags: prefer in-scene `Text` over drei `Html` (a DOM node per player).

---

## 6. Companion server

Lives beside this repo at `../just_fun_server` (separate app, separate deploy).
Node 22 + socket.io, no build step, state in memory. See its own README for the
full protocol.

- `npm run dev` there → **http://localhost:5183**, `GET /health` for status.
  (Not 5182: a stray Vite dev server for this site lands there when 5180/5181
  are busy, and it binds `[::1]` only, so it silently wins every `localhost`
  call.)
- `npm run smoke` boots a real server on :5199 and drives it with real clients —
  23 checks covering join/leave, movement relay, coordinate clamping, malformed
  input, the sync batch, rate limiting and capacity.
- Status: **step 2 of the build order is done** on the server side. Nothing in
  this app talks to it yet; the client work starts with the `SkeletonUtils`
  refactor in §5.
- The client will need `VITE_SOCKET_URL` (dev: `http://localhost:5183`) and the
  server needs this site's origin in its `CORS_ORIGIN`.
