// What each player looks like: a skin, and the idle and the dance they fall
// into when standing around. All three come out of one integer, `appearance`,
// which every browser in the room hears from the server.
//
// Every skin is the same Avaturn body in a different outfit, on one shared
// 52-bone skeleton, and every animation is a Mixamo export without a mesh —
// bare bone tracks, bound to whichever skin they are played on by bone name.
// So any animation plays on any skin, and adding either is one line here; the
// server never needs to know how many there are.

export const SKINS = [
  "/models/Animated.glb",
  "/models/denim.glb",
  "/models/scifi.glb",
  "/models/squid.glb",
  "/models/tshirt.glb",
  "/models/milittary.glb",
  "/models/jobs.glb",
  "/models/stylish.glb",
];

export const IDLES = [
  "/models/Idle.fbx",
  "/models/idle2.fbx",
  "/models/idle3.fbx",
];

export const DANCES = [
  "/models/Dance.fbx",
  "/models/Dance2.fbx",
  "/models/Dance3.fbx",
];

// Everyone walks and runs the same way.
export const WALKING = "/models/Walking.fbx";
export const RUNNING = "/models/Running.fbx";

// Exclusive upper bound. Matches APPEARANCE_RANGE in server/src/validate.js,
// which refuses anything outside it.
const APPEARANCE_RANGE = 2 ** 31;

/**
 * This visitor's own roll, made once per page load. Offered to the server on
 * connect, and simply used when there is no server — so a visitor's avatar is
 * dressed from the first frame and never changes clothes on connecting.
 */
export const LOCAL_APPEARANCE = Math.floor(Math.random() * APPEARANCE_RANGE);

/**
 * Splits an appearance into its three picks, as mixed-radix digits: skin
 * lowest, idle next, dance from what is left. Each pick comes out uniform for
 * as long as the lists multiplied together are tiny next to the range.
 */
export function decodeAppearance(appearance) {
  // A server from before appearances were seeds sends small integers, and a
  // missing one should still dress somebody rather than crash the scene.
  let rest =
    Number.isInteger(appearance) && appearance >= 0 ? appearance : 0;

  const skin = SKINS[rest % SKINS.length];
  rest = Math.floor(rest / SKINS.length);
  const idle = IDLES[rest % IDLES.length];
  rest = Math.floor(rest / IDLES.length);
  const dance = DANCES[rest % DANCES.length];

  return { skin, idle, dance };
}
