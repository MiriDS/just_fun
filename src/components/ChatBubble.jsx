import { Html } from "@react-three/drei";

// Clear of the top of the head. The avatar is roughly 1.7 units tall and
// stands with its feet on its group's origin.
const BUBBLE_HEIGHT = 2.05;

// drei's Html is absolutely positioned inside a container that resolves to
// zero width, so anything auto-width in here collapses to its min-content —
// which, for a line of text, is one character per line. A definite width is
// what gives the bubble something to wrap inside.
const BUBBLE_WIDTH = 220;

// drei scales the element by `distanceFactor / (2 * tan(fov/2) * distance)`.
// The camera is fov 30 and settles about 13 units out, so the divisor there
// is ~6.97: this is the value that makes a bubble render at its true CSS size
// at the resting camera distance, and grow or shrink as you orbit in and out.
// Raise it to make every bubble bigger.
const BUBBLE_SCALE = 7;

/**
 * What someone just said, floating over their head.
 *
 * drei's `Html` rather than in-scene text: the billboard panels already pull
 * it into the bundle, so a bubble costs nothing extra, and a transient DOM
 * node per speaker is cheap in a way a permanent one per player would not be.
 */
export function ChatBubble({ text }) {
  return (
    <Html
      position={[0, BUBBLE_HEIGHT, 0]}
      center
      distanceFactor={BUBBLE_SCALE}
      style={{
        // A bubble must never eat a click: the floor underneath it is how you
        // walk, and drei's wrapper would otherwise swallow the pointer.
        pointerEvents: "none",
        width: BUBBLE_WIDTH,
        textAlign: "center",
      }}
      // Under the billboard pages, which sit at 100, so someone talking
      // behind a panel cannot cover the page being read.
      zIndexRange={[60, 0]}
    >
      <p className="chat-bubble">{text}</p>
    </Html>
  );
}
