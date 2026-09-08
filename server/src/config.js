// Every knob is an environment variable so the same build runs in dev and in
// production. Defaults are the dev ones: the Vite app on its pinned port 5180.

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value, fallback) =>
  (value ?? fallback)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export const config = {
  // 5183 rather than 5182: a stray Vite dev server for the site can land on
  // 5181/5182 when its pinned port is busy, and it binds [::1] only — so a
  // server here would start without complaint and lose every "localhost" call
  // to it.
  port: number(process.env.PORT, 5183),

  // Unset means any origin, which is the right default here: the production
  // image serves the page and the socket from one origin so there is nothing
  // to list, and a presence server with no accounts and no cookies has
  // nothing to protect from a cross-origin page. Naming origins here locks it
  // to those sites. Comma-separated.
  //
  // It used to default to the dev ports, which made "forgot to set
  // CORS_ORIGIN" a silent failure: the socket never opens and the scene just
  // quietly stays single-player.
  origins: process.env.CORS_ORIGIN ? list(process.env.CORS_ORIGIN, "") : null,

  // The built client, served by this same process so the page and the socket
  // share an origin. Set in the production image; unset in development, where
  // Vite serves the page on its own port.
  staticDir: process.env.STATIC_DIR || null,

  // A portfolio, not a game lobby. Past this the scene gets busy and the
  // shadow pass gets expensive, so latecomers are turned away rather than
  // silently degrading it for everyone already in.
  maxPlayers: number(process.env.MAX_PLAYERS, 20),

  // How many outfits the client knows how to render. The server picks one per
  // player and it is fixed for that session — clients must never roll their
  // own, or two viewers would disagree about what someone is wearing.
  // v1 renders a single look, so the pool is 1.
  appearanceCount: number(process.env.APPEARANCE_COUNT, 1),

  // Movement is replicated as intent ("walk to x,z"), which every client
  // reproduces exactly. This slower channel only exists to correct the drift
  // that builds up in throttled background tabs.
  syncIntervalMs: number(process.env.SYNC_INTERVAL_MS, 1000),

  // The visual world is about ±60 (the physics floor is ±60 and the fog closes
  // in at 62), so anything outside this is a bug or a hand-crafted packet.
  worldBound: number(process.env.WORLD_BOUND, 60),

  // A click is one message. Ten a second is far beyond human clicking and
  // still cheap to relay.
  moveRateLimit: number(process.env.MOVE_RATE_LIMIT, 10),

  // A line of chat, not an essay — it has to fit in a bubble over someone's
  // head. Longer than this is truncated rather than rejected, so a paste is
  // shortened instead of silently vanishing.
  chatMaxLength: number(process.env.CHAT_MAX_LENGTH, 120),

  // Two a second is a fast typist. Anything above it is a script.
  chatRateLimit: number(process.env.CHAT_RATE_LIMIT, 2),
};
