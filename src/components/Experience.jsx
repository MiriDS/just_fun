import { Suspense, lazy, useRef, useState } from "react";
import { OrbitControls } from "@react-three/drei";
import { folder, useControls } from "leva";
import * as THREE from "three";
import { Avatar } from "./Avatar";
import { Billboard } from "./Billboard";
import { CameraRig } from "./CameraRig";
import { Ground } from "./Ground";
import { Lighting } from "./Lighting";

import { useClickWithoutDrag } from "./useClickWithoutDrag";

// Rapier inlines its WASM, which more than doubles the main bundle. Split
// out behind its own Suspense boundary the scene paints on time and the
// debris drops in a moment later — which is how it behaves anyway.
const Scatter = lazy(() =>
  import("./Scatter").then((module) => ({ default: module.Scatter }))
);

const BILLBOARDS = [
  { position: [0, 0, -100], label: "about", url: "/pages/about.html" },
  {
    position: [250, 0, -100],
    label: "experience",
    url: "/pages/experience.html",
  },
  { position: [500, 0, -100], label: "skills", url: "/pages/skills.html" },
  {
    position: [750, 0, -100],
    label: "portfolio",
    url: "/pages/portfolio.html",
  },
];

export const Experience = ({ focused, onFocusChange, onIntroDone }) => {
  // Where the avatar is walking to, as [x, z]. null means "stay put".
  const [target, setTarget] = useState(null);

  // Live avatar position, written every frame by the Avatar and read by the
  // camera rig and the contact shadow. A ref rather than state, so following
  // costs no re-renders.
  const avatarPosition = useRef(new THREE.Vector3(0, -0.5, 0));
  // Empties at the centre of each billboard panel, for the camera to fly to.
  const faces = useRef([]);

  // Declared once here rather than inside Billboard: four instances calling
  // useControls with the same schema would fight over the same leva paths.
  const signage = useControls({
    Billboards: folder({
      labelColor: { value: "#e6e6ea", label: "sign color" },
      labelEmissive: { value: "#ff6a3d", label: "sign glow color" },
      labelGlow: { value: 1.1, min: 0, max: 5, step: 0.05, label: "sign glow" },
      // Off: the five bulbs and beams per board read as clutter against
      // the lit signage.
      lamps: { value: false, label: "projectors" },
      // Off by default: five real lights per board (twenty in total) overran
      // the shader's light budget on some GPUs and blanked every lit model.
      castLight: { value: false, label: "real light (1/board)" },
      lampIntensity: {
        value: 6,
        min: 0,
        max: 60,
        step: 0.5,
        label: "projector power",
      },
      lampAngle: {
        value: 0.5,
        min: 0.05,
        max: 1.2,
        step: 0.01,
        label: "beam angle",
      },
      lampPenumbra: {
        value: 0.65,
        min: 0,
        max: 1,
        step: 0.05,
        label: "beam softness",
      },
      lampColor: { value: "#fff1d6", label: "projector color" },
      beams: { value: true, label: "visible beams" },
      beamOpacity: {
        value: 0.28,
        min: 0,
        max: 1,
        step: 0.02,
        label: "beam opacity",
      },
    }),
  });

  const isFocused = focused !== null;

  const groundHandlers = useClickWithoutDrag((event) => {
    // While reading a billboard the floor is an exit, not a walk target.
    if (isFocused) {
      onFocusChange(null);
      return;
    }
    setTarget([event.point.x, event.point.z]);
  });

  return (
    <>
      <Lighting targetRef={avatarPosition} />
      <Ground />
      <Suspense fallback={null}>
        <Scatter targetRef={avatarPosition} />
      </Suspense>

      <Avatar position-y={-0.5} target={target} positionRef={avatarPosition} />

      <group position={[0, -0.5, 0]} scale={0.02}>
        {BILLBOARDS.map((billboard, index) => (
          <Billboard
            key={index}
            {...billboard}
            signage={signage}
            faceRef={(node) => (faces.current[index] = node)}
            showSpot={!isFocused}
            interactive={focused === index}
            onSpotClick={() => onFocusChange(index)}
          />
        ))}
      </group>

      <group position={[0, -0.5, 0]}>
        {/* Invisible ground plane that catches clicks. It has to be an
            actual material rather than visible={false}, because three
            skips invisible objects when raycasting. Sized generously so
            clicks still land once the avatar has wandered off. */}
        <mesh rotation-x={-Math.PI / 2} {...groundHandlers}>
          <planeGeometry args={[500, 500]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* Mounted after the Avatar so its frame callback runs afterwards and
          the camera reads this frame's position, not last frame's. */}
      <CameraRig
        targetRef={avatarPosition}
        focusObject={isFocused ? faces.current[focused] : null}
        onIntroDone={onIntroDone}
      />

      <OrbitControls
        makeDefault
        // The character is the pivot, so panning is disabled — it would
        // shove the orbit target away and fight the follow rig.
        enablePan={false}
        enableDamping
        dampingFactor={0.05}
        // Stop just short of straight down, and never dip below the
        // horizon into the underside of the floor.
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
        minDistance={5}
        maxDistance={20}
      />
    </>
  );
};
