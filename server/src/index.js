import { createServer } from "node:http";
import { Server } from "socket.io";
import sirv from "sirv";
import { config } from "./config.js";
import { World } from "./world.js";
import { serialize } from "./world.js";
import { rateLimiter, readMessage, readPoint } from "./validate.js";

const log = (...parts) =>
  console.log(new Date().toISOString(), ...parts);

// Vite fingerprints everything it emits into /assets, so those files can be
// cached forever. Everything else in public/ — the models, the fonts, the
// billboard pages — keeps its name from one deploy to the next, so it has to
// be revalidated or a new build would never reach anyone who has been here
// before.
const CACHE_FOREVER = "public,max-age=31536000,immutable";
const CACHE_REVALIDATE = "public,max-age=0,must-revalidate";

const world = new World();

// No maxAge passed to sirv on purpose: it would set Cache-Control itself, via
// the header object it hands to writeHead, which wins over anything set here.
// Left alone, setHeaders is the last word — and it only runs for files that
// actually exist.
const serveStatic = config.staticDir
  ? sirv(config.staticDir, {
      etag: true,
      gzip: true,
      brotli: true,
      setHeaders(response, pathname) {
        response.setHeader(
          "cache-control",
          pathname.startsWith("/assets/") ? CACHE_FOREVER : CACHE_REVALIDATE
        );
      },
    })
  : null;

const notFound = (response) => {
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found\n");
};

const http = createServer((request, response) => {
  // One endpoint, for uptime checks and for answering "is anyone in there?"
  // without opening a socket.
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        players: world.size,
        capacity: config.maxPlayers,
        uptime: Math.round(process.uptime()),
      })
    );
    return;
  }

  if (serveStatic) {
    serveStatic(request, response, () => notFound(response));
    return;
  }

  notFound(response);
});

const io = new Server(http, {
  cors: { origin: config.origins ?? true },
  // The scene is playable without any of this, so a client that cannot hold a
  // websocket should be dropped promptly rather than left half-present in
  // everyone else's world.
  pingInterval: 10000,
  pingTimeout: 8000,
});

io.on("connection", (socket) => {
  if (world.isFull()) {
    socket.emit("full", { capacity: config.maxPlayers });
    socket.disconnect(true);
    log(`refused ${socket.id}: full (${world.size}/${config.maxPlayers})`);
    return;
  }

  const player = world.add(socket.id);
  log(`joined ${socket.id} (${world.size}/${config.maxPlayers})`);

  // The newcomer needs the whole room; the room only needs the newcomer.
  socket.emit("welcome", {
    id: player.id,
    appearance: player.appearance,
    position: player.position,
    players: world.snapshot(player.id),
  });
  socket.broadcast.emit("player-joined", serialize(player));

  const allowMove = rateLimiter(config.moveRateLimit);

  // A click. `from` is where the sender was standing as they made it, so
  // everyone else starts the walk from the same place the sender did instead
  // of from wherever their own copy had drifted to.
  socket.on("move", (payload) => {
    if (!allowMove()) return;

    // Optional chaining rather than a default parameter: a client is free to
    // emit `null`, which a default does not catch, and an exception thrown in
    // here takes the whole server process down with it.
    const target = readPoint(payload?.target, config.worldBound);
    const from = readPoint(payload?.from, config.worldBound);
    if (!target || !from) return;

    player.position = from;
    player.target = target;
    player.dirty = false;

    socket.broadcast.emit("move", { id: player.id, target, from });
  });

  // The drift correction: the sender's true position, roughly once a second.
  // Not relayed immediately — it is batched by the loop below.
  socket.on("sync", (payload) => {
    const position = readPoint(payload?.position, config.worldBound);
    if (!position) return;

    player.position = position;
    player.dirty = true;
  });

  const allowChat = rateLimiter(config.chatRateLimit);

  // Chat is echoed to the sender as well as the room, so every bubble in
  // every browser holds exactly the same text: this is the only place it is
  // trimmed, and the sender sees what everyone else sees rather than an
  // optimistic copy of what they typed.
  socket.on("chat", (payload) => {
    if (!allowChat()) return;

    const text = readMessage(payload?.text, config.chatMaxLength);
    if (!text) return;

    io.emit("chat", { id: player.id, text });
  });

  socket.on("disconnect", (reason) => {
    world.remove(player.id);
    io.emit("player-left", { id: player.id });
    log(`left ${socket.id} (${reason}) (${world.size}/${config.maxPlayers})`);
  });
});

// One batched correction for the whole room, rather than a message per player
// per second. Silent when nobody has moved, which is most of the time.
const syncLoop = setInterval(() => {
  const players = world.takeMoved();
  if (players.length > 0) io.emit("sync", { players });
}, config.syncIntervalMs);

http.listen(config.port, () => {
  log(`listening on :${config.port}`);
  log(`origins ${config.origins ? config.origins.join(", ") : "any"}`);
  log(`static ${config.staticDir ?? "none (socket only)"}`);
  log(`capacity ${config.maxPlayers}, ${config.appearanceCount} appearance(s)`);
});

// Without this a container restart drops every socket without a close frame,
// and clients wait out their ping timeout before reconnecting.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    log(`${signal}: shutting down`);
    clearInterval(syncLoop);
    io.close(() => http.close(() => process.exit(0)));
  });
}
