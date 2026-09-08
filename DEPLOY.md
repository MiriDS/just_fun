# Deploying

One image, one process, one domain. The Vite build and the presence server are
served by the same Node process, which means:

- **no CORS to configure** — the page and the socket share an origin;
- **no socket URL to bake into the client** — Vite fixes `VITE_SOCKET_URL` at
  build time, so a separate server would mean rebuilding the client whenever
  that URL changed. Unset, the client talks to whatever origin served it;
- **one domain, one certificate, one WebSocket upgrade path.**

## Dokploy

Create an **Application**, point it at this repository, and set:

| Setting | Value |
|---|---|
| Build Type | **Dockerfile** |
| Port | **3000** |
| Health check path | `/health` |
| Environment | *nothing required* |

Add your domain and let Dokploy issue the certificate. Traefik proxies
WebSockets on that domain already, so nothing further is needed for the socket.

`SIGTERM` is handled, so a redeploy closes sockets cleanly instead of leaving
browsers to wait out a ping timeout — `docker stop` returns immediately rather
than hitting the ten-second kill.

### Optional environment variables

Everything has a working default; these are for changing your mind later.

| Variable | Default | |
|---|---|---|
| `PORT` | 3000 | |
| `MAX_PLAYERS` | 20 | Past this, joiners are turned away |
| `CHAT_MAX_LENGTH` | 120 | |
| `CHAT_RATE_LIMIT` | 2 | Messages per second, per socket |
| `MOVE_RATE_LIMIT` | 10 | Clicks per second, per socket |
| `CORS_ORIGIN` | *any* | Comma-separated. Locks the socket to named sites |
| `STATIC_DIR` | `/app/public` | Where the built client lives |

`CORS_ORIGIN` is unset by default on purpose. There are no accounts and no
cookies here, so there is nothing for a cross-origin page to steal — and the
old default of naming specific origins made "forgot to set it" a silent
failure, where the socket never opens and the scene quietly stays
single-player.

## What the image does

```
node:22-alpine  →  npm ci  →  npm run build   (Vite + precompression)
node:22-alpine  →  npm ci --omit=dev  →  server/src + dist/  →  node src/index.js
```

Two stages: the first builds the client, the second keeps only the server's
production dependencies and the built files. About 260MB, most of which is the
Node base image.

**Assets are pre-compressed at build time** (`scripts/precompress.mjs`). sirv
serves a `.br` or `.gz` file when one sits beside the original but never
compresses on the fly, so without that step the main bundle would go over the
wire at 1.3MB instead of 321kB.

Caching: everything Vite fingerprints into `/assets/` is `immutable` for a
year; everything else — models, fonts, the billboard pages — revalidates,
because those keep their filenames from one deploy to the next and would
otherwise never update for anyone who had visited before.

## Running the image locally

```bash
docker build -t just-fun .
docker run --rm -p 3000:3000 just-fun
```

Then open http://localhost:3000. Two browser windows will see each other.

## If you ever split them apart

Nothing here forecloses it. Deploy `server/` on its own, then build the client
with `VITE_SOCKET_URL=https://your-server` and set `CORS_ORIGIN` to your site's
origin. `VITE_SOCKET_URL=off` disables multiplayer entirely and ships the
scene as it was before any of this.

## Scaling

One replica. socket.io keeps its player list in memory, so a second replica
would be a second, separate world — and websocket clients would need sticky
sessions to reach the right one. Past one box you would want the Redis adapter
and a shared world, which is a different piece of work.
