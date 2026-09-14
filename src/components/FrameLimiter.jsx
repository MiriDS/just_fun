import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

// The most frames per second the scene is drawn at. Uncapped, r3f draws once
// per display refresh: a 240Hz monitor asked for four times the work of a 60Hz
// one — four full scene passes a frame (shadow map, floor reflection, contact
// shadow, the view itself) plus the billboard page's CSS transform — and on
// Windows machines with fast monitors that is where the scene froze. Nothing
// in the scene depends on the frame rate, since all movement runs off delta.
//
// `?fps=` on the URL overrides it, and `?fps=0` lifts the cap, for comparing
// on a machine that misbehaves.
const DEFAULT_MAX_FPS = 60;
const fpsParam = new URLSearchParams(window.location.search).get("fps");
const MAX_FPS =
  fpsParam !== null && Number.isFinite(Number(fpsParam))
    ? Number(fpsParam)
    : DEFAULT_MAX_FPS;

// Vsync timestamps land either side of the exact interval, so a strict
// comparison would drop every other frame on a display that already runs at
// the cap.
const TOLERANCE_MS = 2;

// A frame this slow is a stall worth hearing about. On Windows it is usually
// shaders compiling the first time something comes into view.
const SLOW_FRAME_MS = 250;

/**
 * Drives a `frameloop="never"` Canvas at no more than MAX_FPS.
 *
 * Mounted outside the scene's Suspense boundary, so it keeps rendering if
 * anything in the scene suspends again after the first load.
 */
export function FrameLimiter() {
  const advance = useThree((state) => state.advance);

  useEffect(() => {
    const interval = MAX_FPS > 0 ? 1000 / MAX_FPS : 0;
    let start = null;
    let next = 0;
    let handle;

    const tick = (now) => {
      handle = requestAnimationFrame(tick);

      // r3f takes the frame's delta from the timestamp we hand it, in seconds
      // since its clock started at zero — so count from our first frame, or
      // the first delta would be the whole time the page took to load.
      if (start === null) start = next = now;
      if (now < next - TOLERANCE_MS) return;

      // Scheduled against the previous deadline rather than against now, so
      // a 144Hz display alternates two and three refreshes and averages the
      // cap. More than a frame behind — a stall, a backgrounded tab — pace
      // from here instead of rendering a burst to catch up.
      next = now - next > interval ? now + interval : next + interval;

      const began = performance.now();
      advance((now - start) / 1000);
      const took = performance.now() - began;

      if (took > SLOW_FRAME_MS) {
        console.warn(`[scene] a frame took ${Math.round(took)}ms`);
      }
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [advance]);

  return null;
}
