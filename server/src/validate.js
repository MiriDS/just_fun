// Anything arriving over a socket is a stranger's typing until proven
// otherwise. These return null rather than throwing, so a malformed packet
// costs the sender their message and nobody else anything.

const clamp = (value, bound) => Math.min(bound, Math.max(-bound, value));

/**
 * Reads an `[x, z]` ground coordinate, clamped into the world.
 *
 * Coordinates are clamped rather than rejected because the honest cause of an
 * out-of-range click is a client whose ground plane (500 units across) is
 * bigger than the part of the world worth standing in.
 */
export function readPoint(value, bound) {
  if (!Array.isArray(value) || value.length !== 2) return null;

  const [x, z] = value;
  // Rejects NaN and Infinity, which would otherwise poison every distance
  // calculation downstream of here.
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

  return [clamp(x, bound), clamp(z, bound)];
}

// Everything that has no business in a single line of text drawn over an
// avatar's head: C0/C1 control characters, the bidi overrides that can garble
// the rest of a viewer's UI, and the zero-width characters used to pad a
// message out invisibly.
const UNPRINTABLE =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * Reads a line of chat: one line, trimmed, capped.
 *
 * Returns null for anything that is not a usable message, so an empty or
 * whitespace-only send costs the sender their turn and nobody else anything.
 */
export function readMessage(value, maxLength) {
  if (typeof value !== "string") return null;

  // Newlines and tabs become spaces rather than being stripped, so words
  // either side of one do not run together.
  const text = value.replace(UNPRINTABLE, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  return text.slice(0, maxLength);
}

/**
 * Token bucket. Returns a function that answers "may I send another one?",
 * refilling at `perSecond` and never banking more than one second's worth.
 */
export function rateLimiter(perSecond) {
  let tokens = perSecond;
  let last = Date.now();

  return () => {
    const now = Date.now();
    tokens = Math.min(perSecond, tokens + ((now - last) / 1000) * perSecond);
    last = now;

    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
