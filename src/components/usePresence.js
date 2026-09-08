import { useCallback, useEffect, useRef, useState } from "react";
import { createMotion } from "./Avatar";

// Where the presence server is. Vite bakes this in at build time, so it is a
// property of the build, not of the running site.
//
// Unset in a production build means the page's own origin, which is how the
// deployed image serves it: one process, one domain, nothing to configure and
// no CORS to get wrong. Unset in development means the server next door.
// "off" disables multiplayer entirely.
const CONFIGURED = import.meta.env.VITE_SOCKET_URL;
const MULTIPLAYER = CONFIGURED !== "off";
const SERVER_URL =
  CONFIGURED && CONFIGURED !== "off"
    ? CONFIGURED
    : // socket.io reads undefined as "this page's origin".
      import.meta.env.DEV
      ? "http://localhost:5183"
      : undefined;

// How often we tell the server where we really are. Everyone else is walking
// their own copy of us from our last click, and this is what stops the two
// drifting apart when a tab is backgrounded and its frames are throttled.
const SYNC_INTERVAL = 1000;
// Not worth a packet: we have not meaningfully moved since the last report.
const SYNC_EPSILON = 0.05;

// How long a chat bubble stays over someone's head: long enough to notice,
// plus reading time, capped so nobody can park a wall of text up there.
const MESSAGE_BASE_MS = 3500;
const MESSAGE_PER_CHARACTER_MS = 55;
const MESSAGE_MAX_MS = 9000;

const lifetime = (text) =>
  Math.min(
    MESSAGE_BASE_MS + text.length * MESSAGE_PER_CHARACTER_MS,
    MESSAGE_MAX_MS
  );

/**
 * Everyone else in the scene, and what they are saying.
 *
 * Movement is replicated as intent rather than as a position stream: the
 * avatar's walk is a pure function of one target plus fixed speeds, so
 * relaying the click is enough for every browser to reproduce the same walk.
 * See PROJECT.md §5.
 *
 * Joins, leaves and chat are React state, because they change what is on
 * screen. Everything arriving per-packet is a mutation of a motion object
 * instead, so a busy scene does not re-render on every step.
 */
export function usePresence({ motion, positionRef }) {
  const [players, setPlayers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState(null);
  // Keyed by player id, one message each: a second message from the same
  // person replaces the first rather than stacking up.
  const [messages, setMessages] = useState({});

  // Keyed by player id. Mutated in place by the handlers below and read every
  // frame by each Avatar, so nothing here is React state.
  const [motions] = useState(() => new Map());
  const socket = useRef(null);
  const timers = useRef(new Map());

  const forget = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setMessages((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const say = useCallback(
    (id, text) => {
      // `at` is what makes a repeated message a new one as far as React is
      // concerned, so the bubble replays its entrance instead of sitting
      // there unchanged.
      setMessages((current) => ({ ...current, [id]: { text, at: Date.now() } }));

      clearTimeout(timers.current.get(id));
      timers.current.set(id, setTimeout(() => forget(id), lifetime(text)));
    },
    [forget]
  );

  useEffect(() => {
    if (!MULTIPLAYER) return;

    let connection = null;
    let cancelled = false;

    const remember = (player) => {
      const remote = createMotion(player.position);
      remote.target = player.target;
      motions.set(player.id, remote);
      return { id: player.id, appearance: player.appearance };
    };

    // Fetched only once a server is actually configured, so a single-player
    // deploy never pays for the client — the same reason the physics chunk is
    // split out of the main bundle.
    import("socket.io-client").then(({ io }) => {
      if (cancelled) return;

      connection = io(SERVER_URL, {
        transports: ["websocket"],
        // The scene is fully playable without any of this, so a server that is
        // down must not become a console full of retries.
        reconnectionAttempts: 5,
        timeout: 4000,
      });
      socket.current = connection;

      connection.on("connect", () => setConnected(true));
      connection.on("disconnect", () => setConnected(false));

      connection.on("welcome", (payload) => {
        // The server picks where we stand, so two visitors arriving at once
        // do not end up inside each other. The first one in is given the
        // origin, which is exactly where the single-player scene started.
        motion.origin = payload.position;

        setSelfId(payload.id);
        motions.clear();
        setPlayers(payload.players.map(remember));
      });

      connection.on("player-joined", (player) => {
        const entry = remember(player);
        setPlayers((current) => [
          ...current.filter((other) => other.id !== entry.id),
          entry,
        ]);
      });

      connection.on("player-left", ({ id }) => {
        motions.delete(id);
        forget(id);
        setPlayers((current) => current.filter((other) => other.id !== id));
      });

      connection.on("move", ({ id, target, from }) => {
        const remote = motions.get(id);
        if (!remote) return;

        // `from` is where they actually stood as they clicked, so the walk
        // starts from the same place for everyone rather than from wherever
        // our copy of them had drifted to.
        remote.origin = from;
        remote.target = target;
        remote.correction = null;
      });

      connection.on("sync", (payload) => {
        for (const { id, position } of payload.players) {
          // Our own entry comes back in the batch. It is not in this map, so
          // it falls out here with nothing to do.
          const remote = motions.get(id);
          if (remote) remote.correction = position;
        }
      });

      // Our own messages come back to us too, so every bubble in every
      // browser holds the same server-trimmed text.
      connection.on("chat", ({ id, text }) => say(id, text));

      // At capacity. Nothing to do but carry on alone.
      connection.on("full", () => connection.close());
    });

    return () => {
      cancelled = true;
      connection?.close();
      socket.current = null;
      motions.clear();
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      setPlayers([]);
      setMessages({});
      setConnected(false);
      setSelfId(null);
    };
  }, [motion, motions, forget, say]);

  useEffect(() => {
    if (!MULTIPLAYER) return;

    let reported = null;

    const timer = setInterval(() => {
      const connection = socket.current;
      if (!connection?.connected || !positionRef.current) return;

      const position = [positionRef.current.x, positionRef.current.z];
      const still =
        reported &&
        Math.hypot(position[0] - reported[0], position[1] - reported[1]) <
          SYNC_EPSILON;
      if (still) return;

      reported = position;
      connection.emit("sync", { position });
    }, SYNC_INTERVAL);

    return () => clearInterval(timer);
  }, [positionRef]);

  const sendMove = useCallback((target, from) => {
    socket.current?.emit("move", { target, from: [from.x, from.z] });
  }, []);

  // No optimistic bubble: the server trims the text and echoes it back, and
  // waiting for that round trip is what guarantees our own bubble says
  // exactly what everyone else's does.
  const sendChat = useCallback((text) => {
    socket.current?.emit("chat", { text });
  }, []);

  return { players, motions, messages, selfId, connected, sendMove, sendChat };
}
