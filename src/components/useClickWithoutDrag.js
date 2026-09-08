import { useRef } from "react";

// Pointer travel (in px) above which a press is treated as a camera drag
// rather than a click.
const DRAG_THRESHOLD = 5;

/**
 * Returns pointer handlers that fire `onClick` only for a genuine click.
 *
 * r3f fires onClick whenever pointer-down and pointer-up land on the same
 * object, with no regard for how far the pointer travelled in between — so
 * without this, every camera orbit that happened to start and finish over a
 * mesh would register as a click on it.
 */
export function useClickWithoutDrag(onClick, { stopPropagation = false } = {}) {
  const downAt = useRef([0, 0]);

  return {
    onPointerDown: (event) => {
      if (stopPropagation) event.stopPropagation();
      downAt.current = [event.clientX, event.clientY];
    },
    onPointerUp: (event) => {
      if (stopPropagation) event.stopPropagation();
      const [downX, downY] = downAt.current;
      const travel = Math.hypot(event.clientX - downX, event.clientY - downY);
      if (travel > DRAG_THRESHOLD) return;
      onClick(event);
    },
  };
}
