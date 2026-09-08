import { useCallback, useEffect, useRef, useState } from "react";
import { Loader, useProgress } from "@react-three/drei";
import { Leva } from "leva";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { createMotion } from "./components/Avatar";
import { Experience } from "./components/Experience";
import { usePresence } from "./components/usePresence";

// The tuning panel is for us, not for visitors: it shows while developing,
// or on any build when ?debug is on the URL.
const SHOW_TUNER =
  import.meta.env.DEV ||
  new URLSearchParams(window.location.search).has("debug");

// Matches the server's CHAT_MAX_LENGTH. Only an affordance — the server
// trims anything longer regardless, and its copy is the one everybody sees.
const CHAT_MAX_LENGTH = 120;

function App() {
  // Index of the billboard the camera has flown into, or null when roaming.
  const [focused, setFocused] = useState(null);
  const [introDone, setIntroDone] = useState(false);
  const [draft, setDraft] = useState("");

  // The local player. Owned here rather than in the scene because the chat
  // box that sends their messages is DOM, and lives outside the Canvas.
  //
  // What they are doing: where they are walking to, and any position handed
  // to them by the server. Mutated rather than set, so a click does not
  // re-render the scene — see createMotion.
  const [motion] = useState(createMotion);
  // Where they are: written every frame by the Avatar, read by the camera
  // rig, the contact shadow and the drift reporter. A ref rather than state,
  // so following costs no re-renders.
  const avatarPosition = useRef(new THREE.Vector3(0, -0.5, 0));
  // Everyone else. Silently inert when no presence server is configured or
  // reachable, which leaves the scene exactly as it was single-player.
  const presence = usePresence({ motion, positionRef: avatarPosition });

  // Must be stable. As an inline arrow this got a new identity on every
  // render, so finishing the intro re-ran the effect that locks orbit input
  // and the camera stayed frozen.
  const handleIntroDone = useCallback(() => setIntroDone(true), []);
  // The arrival sweep only begins once the scene has finished suspending, so
  // the skip hint would otherwise sit over the loading screen with nothing
  // to skip.
  const { active: loading } = useProgress();

  const { sendChat } = presence;
  const handleSend = useCallback(
    (event) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) return;

      sendChat(text);
      // Cleared straight away: the bubble appears when the server echoes the
      // message back, which is also when everyone else sees it.
      setDraft("");
    },
    [draft, sendChat]
  );

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
          motion={motion}
          avatarPosition={avatarPosition}
          presence={presence}
        />
      </Canvas>

      {!loading && !introDone && (
        <p className="skip-hint">click anywhere to skip</p>
      )}

      {/* Only once there is somebody to talk to. With no server configured
          the site looks and behaves exactly as it always has, and while a
          page is being read this would sit on top of it. */}
      {presence.connected && introDone && focused === null && (
        <form className="chat" onSubmit={handleSend}>
          <input
            className="chat__input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="say something"
            maxLength={CHAT_MAX_LENGTH}
            aria-label="Send a message to everyone here"
          />
        </form>
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
