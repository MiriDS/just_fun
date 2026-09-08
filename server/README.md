# just_fun_server

Presence server for the 3D portfolio in the repository root. It keeps track of
who is currently in the scene, relays their movement and their chat, and — in
production — serves the built client too, so the page and the socket share an
origin.

State lives in memory and dies with the process — a player *is* their
connection, so there is nothing worth persisting. No database, no auth.

The design and the reasoning behind it are in [`../PROJECT.md`](../PROJECT.md)
§5; deploying it is [`../DEPLOY.md`](../DEPLOY.md).

---

## Running it

```bash
npm install
npm run dev     # http://localhost:5183, restarts on edit
npm start       # same, without the watcher
npm run smoke   # boots a server on :5199 and drives it with real clients
```

Copy `.env.example` to `.env` to change anything; every value in it is the
default. Set `STATIC_DIR` to a built `dist/` to serve the site from here too,
which is what the production image does:

```bash
npm --prefix .. run build
STATIC_DIR=../dist npm start        # page and socket both on :5183
```

`CORS_ORIGIN` is unset by default, meaning any origin. Same-origin deployments
need nothing; name your origins there to lock a separately-deployed server
down.

`GET /health` → `{ ok, players, capacity, uptime }`, for uptime checks.

---

## How movement is replicated

The client's avatar walks by a pure function of one click target plus fixed
speeds, so **the click is the message** — not a stream of positions. Every
client replays the same walk and arrives at the same place, with the right
walk/run/turn animation, for about 40 bytes per click.

The one weakness is drift: a backgrounded tab has its animation frames
throttled and falls behind. So each client also reports its true position about
once a second, the server batches those into one `sync` per tick, and remote
avatars **ease** toward the correction rather than snapping to it.

## Protocol

### Client → server

| Event | Payload | Notes |
|---|---|---|
| `move` | `{ target: [x, z], from: [x, z] }` | One per click. `from` is where the sender stood as they clicked, so everyone starts the walk from the same place. |
| `sync` | `{ position: [x, z] }` | ~1Hz drift correction. |
| `chat` | `{ text }` | One line. Trimmed, tidied and capped by the server. |

### Server → client

| Event | Payload | Notes |
|---|---|---|
| `welcome` | `{ id, appearance, position, players[] }` | Full snapshot, sent once on join. `players` excludes you. |
| `player-joined` | `{ id, appearance, position, target }` | |
| `player-left` | `{ id }` | |
| `move` | `{ id, target, from }` | Relayed click. |
| `sync` | `{ players: [{ id, position }] }` | Batched, movers only, silent when nobody moved. Includes your own entry — ignore it. |
| `chat` | `{ id, text }` | Sent to **everyone including the sender**, so every bubble holds the same server-trimmed text and nobody has to trim their own optimistically. |
| `full` | `{ capacity }` | At capacity; a disconnect follows immediately. |

`appearance` is an integer in `[0, APPEARANCE_COUNT)`, **assigned by the
server** and fixed for the session. Clients must never roll their own, or two
viewers would disagree about what a player is wearing and a reconnecting player
would change clothes. v1 renders one look for everyone; the field is already
there so adding outfits later is not a protocol change.

## What it refuses

- Coordinates are **clamped** to `WORLD_BOUND` (±60, the walkable world) rather
  than rejected — an out-of-range click usually just means the client's 500-unit
  ground plane is bigger than the part of the world worth standing in.
- Anything that is not a pair of finite numbers is dropped: the sender loses
  their message, nobody else is affected.
- `move` is rate limited to `MOVE_RATE_LIMIT` per second per socket (token
  bucket, refilling continuously), far above human clicking. `chat` has its own
  bucket at `CHAT_RATE_LIMIT`, defaulting to two a second.
- Chat text is collapsed to a single line and capped at `CHAT_MAX_LENGTH`.
  Control characters, bidi overrides (which can garble the rest of a viewer's
  UI) and zero-width padding are stripped; an empty result is dropped.
- Past `MAX_PLAYERS` a joiner gets `full` and is disconnected, rather than
  quietly making the scene expensive for everyone already in.

Every handler treats its payload as a stranger's typing. A thrown exception in a
socket.io handler takes the whole process down, which is exactly what a `null`
payload used to do here before the smoke test caught it.

## Chat has no moderation

Anyone who can open the site can broadcast a line of text to everyone else in
the scene. The server strips anything that could break the layout and caps the
length and the rate, but it does not filter what the words actually say, and it
keeps no log of them. That is fine for a portfolio someone visits from a link;
it is worth revisiting before this is somewhere with an audience.

Bubbles are rendered as text nodes by React, never as HTML, so the usual
injection route is closed on the client side too.

## Deploying

See [`../DEPLOY.md`](../DEPLOY.md). The short version: the repository root has a
Dockerfile that builds the client and runs this server with `STATIC_DIR` set,
so one container serves everything on one port.

The site survives this server being down: if the socket never connects, the
scene quietly falls back to the single-player experience it was before.
