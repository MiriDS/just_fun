// End-to-end check of the whole protocol against a real server process.
// Self-contained: it boots the server on its own port, drives it with real
// socket.io clients, and shuts it down. Run with `npm run smoke`.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const PORT = 5199;
const ORIGIN = `http://localhost:${PORT}`;
const SERVER = fileURLToPath(new URL("../src/index.js", import.meta.url));

const ENV = {
  ...process.env,
  PORT: String(PORT),
  // Small enough that a third client proves the capacity path.
  MAX_PLAYERS: "2",
  APPEARANCE_COUNT: "3",
  // Faster than the real 1s, so the sync assertion does not dominate runtime.
  SYNC_INTERVAL_MS: "300",
};

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves with the next `event` on `socket`, or rejects on timeout. */
function once(socket, event, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeout);

    const handler = (payload) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

/** Rejects if `event` arrives within `ms` — for asserting a packet was dropped. */
function silence(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => {
      socket.off(event, handler);
      reject(new Error(`unexpected "${event}": ${JSON.stringify(payload)}`));
    };

    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
  });
}

const connect = () => io(ORIGIN, { transports: ["websocket"], forceNew: true });

function startServer() {
  const child = spawn(process.execPath, [SERVER], { env: ENV, stdio: "pipe" });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server did not start in time")),
      5000
    );

    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening on")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
}

const server = await startServer();
const sockets = [];

try {
  console.log("\nhealth");
  const health = await (await fetch(`${ORIGIN}/health`)).json();
  check("reports ok with an empty world", health.ok === true && health.players === 0);
  check("reports capacity", health.capacity === 2);

  console.log("\njoining");
  const alice = connect();
  sockets.push(alice);
  const aliceWelcome = await once(alice, "welcome");
  check("welcome carries an id", typeof aliceWelcome.id === "string");
  check(
    "welcome carries a server-assigned appearance",
    Number.isInteger(aliceWelcome.appearance) &&
      aliceWelcome.appearance >= 0 &&
      aliceWelcome.appearance < 3,
    `got ${aliceWelcome.appearance}`
  );
  check(
    "welcome carries a spawn position",
    Array.isArray(aliceWelcome.position) && aliceWelcome.position.length === 2
  );
  check("first player sees an empty room", aliceWelcome.players.length === 0);

  const aliceSeesJoin = once(alice, "player-joined");
  const bob = connect();
  sockets.push(bob);
  const [bobWelcome, joined] = await Promise.all([
    once(bob, "welcome"),
    aliceSeesJoin,
  ]);
  check("second player sees the first", bobWelcome.players.length === 1);
  check(
    "the room is told about the newcomer",
    joined.id === bobWelcome.id,
    `${joined.id} vs ${bobWelcome.id}`
  );

  const gap = Math.hypot(
    aliceWelcome.position[0] - bobWelcome.position[0],
    aliceWelcome.position[1] - bobWelcome.position[1]
  );
  check("players spawn apart", gap > 1.5, `gap ${gap.toFixed(2)}`);

  console.log("\nmovement");
  const aliceSeesMove = once(alice, "move");
  bob.emit("move", { target: [4, 6], from: [1, 2] });
  const move = await aliceSeesMove;
  check("a click reaches the room", move.id === bobWelcome.id);
  check(
    "target and origin survive the trip",
    JSON.stringify(move.target) === "[4,6]" &&
      JSON.stringify(move.from) === "[1,2]",
    JSON.stringify(move)
  );

  const aliceSeesClamped = once(alice, "move");
  bob.emit("move", { target: [9999, -9999], from: [0, 0] });
  const clamped = await aliceSeesClamped;
  check(
    "out-of-world coordinates are clamped, not relayed raw",
    JSON.stringify(clamped.target) === "[60,-60]",
    JSON.stringify(clamped.target)
  );

  console.log("\nbad input");
  await silence(alice, "move", 400).then(
    () => check("nothing relayed while idle", true),
    (error) => check("nothing relayed while idle", false, error.message)
  );

  const garbage = [
    { target: ["x", 0], from: [0, 0] },
    { target: [NaN, 0], from: [0, 0] },
    { target: [1, 2] },
    { target: [1, 2, 3], from: [0, 0] },
    {},
    null,
  ];
  const dropped = silence(alice, "move", 500);
  for (const payload of garbage) bob.emit("move", payload);
  await dropped.then(
    () => check("malformed clicks are dropped", true),
    (error) => check("malformed clicks are dropped", false, error.message)
  );

  // Same class of bug as the clicks above: `null` is not caught by a default
  // parameter, and a throw in a socket handler takes the process down. These
  // are all bad *points*, unlike the list above, where some entries are a
  // good point in a bad message.
  const badPoints = [["x", 0], [NaN, 0], [Infinity, 0], [1, 2, 3], [1], "1,2", null, undefined, {}];
  const droppedSync = silence(alice, "sync", 500);
  for (const position of badPoints) bob.emit("sync", { position });
  bob.emit("sync", null);
  bob.emit("sync", "nonsense");
  await droppedSync.then(
    () => check("malformed corrections are dropped", true),
    (error) => check("malformed corrections are dropped", false, error.message)
  );

  console.log("\nsync");
  const aliceSeesSync = once(alice, "sync");
  bob.emit("sync", { position: [7, 8] });
  const sync = await aliceSeesSync;
  const bobEntry = sync.players.find((entry) => entry.id === bobWelcome.id);
  check("a position correction is batched out", Boolean(bobEntry));
  check(
    "the corrected position is the one reported",
    JSON.stringify(bobEntry?.position) === "[7,8]",
    JSON.stringify(bobEntry?.position)
  );
  await silence(alice, "sync", 700).then(
    () => check("the sync loop is silent when nobody moves", true),
    (error) => check("the sync loop is silent when nobody moves", false, error.message)
  );

  console.log("\nchat");
  const aliceSeesChat = once(alice, "chat");
  const bobSeesOwnChat = once(bob, "chat");
  bob.emit("chat", { text: "  hello   world  " });
  const [heard, echoed] = await Promise.all([aliceSeesChat, bobSeesOwnChat]);
  check("a message reaches the room", heard.id === bobWelcome.id && heard.text === "hello world",
    JSON.stringify(heard));
  check("and is echoed to the sender, identically", echoed.text === heard.text,
    `${JSON.stringify(echoed.text)} vs ${JSON.stringify(heard.text)}`);

  // The bucket refills at CHAT_RATE_LIMIT per second, so the sends below are
  // spaced out: this exercises the real default rather than a loosened one.
  await wait(600);
  const aliceSeesLong = once(alice, "chat");
  bob.emit("chat", { text: "y".repeat(400) });
  const long = await aliceSeesLong;
  check("an overlong message is truncated, not dropped", long.text.length === 120,
    `${long.text.length} chars`);

  await wait(600);
  const aliceSeesTidied = once(alice, "chat");
  // A newline, a bidi override and a zero-width pad: none of them belong in a
  // single line drawn over someone's head.
  bob.emit("chat", { text: "one\ntwo\u202ethree\u200b" });
  const tidied = await aliceSeesTidied;
  check("control, bidi and zero-width characters are stripped",
    tidied.text === "one two three", JSON.stringify(tidied.text));

  // One message, sent with a full bucket, so what drops it is the validation
  // and not the rate limiter sitting in front of it.
  await wait(1200);
  const noChat = silence(alice, "chat", 500);
  bob.emit("chat", { text: "   " });
  await noChat.then(
    () => check("empty and malformed messages are dropped", true),
    (error) => check("empty and malformed messages are dropped", false, error.message)
  );

  console.log("\nrate limit");
  let relayed = 0;
  const count = (payload) => { if (payload.id === bobWelcome.id) relayed++; };
  alice.on("move", count);
  for (let i = 0; i < 40; i++) bob.emit("move", { target: [i % 10, 1], from: [0, 0] });
  await wait(600);
  alice.off("move", count);
  check(
    "a flood of clicks is throttled",
    relayed > 0 && relayed < 40,
    `${relayed} of 40 relayed`
  );

  let said = 0;
  const countChat = () => said++;
  alice.on("chat", countChat);
  for (let i = 0; i < 20; i++) bob.emit("chat", { text: `spam ${i}` });
  await wait(600);
  alice.off("chat", countChat);
  check(
    "a flood of messages is throttled",
    said > 0 && said < 20,
    `${said} of 20 relayed`
  );

  console.log("\ncapacity");
  const carol = connect();
  sockets.push(carol);
  const full = await once(carol, "full");
  check("the third player is turned away", full.capacity === 2);
  await once(carol, "disconnect");
  check("and is disconnected rather than left hanging", true);

  console.log("\nleaving");
  const aliceSeesLeave = once(alice, "player-left");
  bob.disconnect();
  const left = await aliceSeesLeave;
  check("the room is told about the departure", left.id === bobWelcome.id);

  await wait(100);
  const after = await (await fetch(`${ORIGIN}/health`)).json();
  check("the departed player is released", after.players === 1, `players ${after.players}`);
} catch (error) {
  failures.push(`threw: ${error.message}`);
  console.log(`\n  FAIL ${error.message}`);
} finally {
  for (const socket of sockets) socket.close();
  server.kill("SIGTERM");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
