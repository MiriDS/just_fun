import { useCallback, useEffect, useState } from "react";
import { Loader, useProgress } from "@react-three/drei";
import { Leva } from "leva";
import { Canvas } from "@react-three/fiber";
import { Experience } from "./components/Experience";

// The tuning panel is for us, not for visitors: it shows while developing,
// or on any build when ?debug is on the URL.
const SHOW_TUNER =
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("debug");

function App() {
  // Index of the billboard the camera has flown into, or null when roaming.
  const [focused, setFocused] = useState(null);
  const [introDone, setIntroDone] = useState(false);

  // Must be stable. As an inline arrow this got a new identity on every
  // render, so finishing the intro re-ran the effect that locks orbit input
  // and the camera stayed frozen.
  const handleIntroDone = useCallback(() => setIntroDone(true), []);
  // The arrival sweep only begins once the scene has finished suspending, so
  // the skip hint would otherwise sit over the loading screen with nothing
  // to skip.
  const { active: loading } = useProgress();

  useEffect(() => {
    if (focused === null) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setFocused(null);
    };

    // Once the viewer clicks into a panel, keyboard focus moves into the
    // iframe and the keydown above stops firing. The billboard pages are
    // ours and same-origin, so they relay Escape back out as a message.
    const handleMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.type === "billboard:exit") setFocused(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("message", handleMessage);
    };
  }, [focused]);

  return (
    <>
      <Canvas
        shadows
        camera={{ position: [8, 8, 8], fov: 30 }}
        // Clicking the empty space around a focused panel backs out of it.
        // Worth having because Esc stops reaching us the moment the user
        // clicks into the embedded page: keyboard focus moves inside a
        // cross-origin iframe, which we cannot listen to.
        onPointerMissed={() => setFocused(null)}
      >
        <Experience
          focused={focused}
          onFocusChange={setFocused}
          onIntroDone={handleIntroDone}
        />
      </Canvas>

      {!loading && !introDone && (
        <p className="skip-hint">click anywhere to skip</p>
      )}

      {focused !== null && (
        <button className="back-button" onClick={() => setFocused(null)}>
          ← Back <span className="back-button__key">Esc</span>
        </button>
      )}

      {/* Hidden while a panel is focused, where it would sit on top of
          the page you are trying to read. */}
      <Leva hidden={!SHOW_TUNER || focused !== null} titleBar={{ title: "Scene" }} />

      <Loader />
    </>
  );
}

export default App;
