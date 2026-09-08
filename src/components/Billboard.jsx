import { useEffect, useState } from "react";
import { DoubleSide } from "three";
import { Center, Html, Text3D, useGLTF } from "@react-three/drei";
import { useClickWithoutDrag } from "./useClickWithoutDrag";

// Measured off the "Default" (pure white) plane in Billboard.glb, in the
// model's own local units. It's a flat quad, so depth is zero.
// Exported because the camera rig needs them to work out how far back it
// has to sit for the panel to fill the viewport.
export const FACE_WIDTH = 203.16;
export const FACE_HEIGHT = 87.47;
export const FACE_CENTER = [0, 185.67, 9.37];
// Nudge the page just in front of the panel so the two don't co-plane.
const FACE_OFFSET = 0.5;

// The iframe's own pixel resolution. Aspect is locked to the panel so the
// page is never letterboxed or stretched.
const SCREEN_WIDTH_PX = 1440;
const SCREEN_HEIGHT_PX = Math.round((SCREEN_WIDTH_PX * FACE_HEIGHT) / FACE_WIDTH);

// drei lays <Html transform> content out at 40 CSS px per world unit, so
// this is the scale at which SCREEN_WIDTH_PX exactly covers FACE_WIDTH.
const HTML_PX_PER_UNIT = 40;
const SCREEN_SCALE = (FACE_WIDTH * HTML_PX_PER_UNIT) / SCREEN_WIDTH_PX;

// The extruded section name hanging below the panel. Sits in front of the
// pole and below the lamp housings (which top out at y=132) so nothing
// intersects.
const LABEL_FONT = "/fonts/helvetiker_bold.typeface.json";
// Sized so the longest label ("experience") sits at roughly half the
// panel's 203-unit width, rather than crowding the neighbouring board.
const LABEL_SIZE = 18;
const LABEL_DEPTH = 3.5;
const LABEL_Y = 105;
const LABEL_Z = 15;

// The "stand here to read this" marker, on the ground in front of the panel.
const SPOT_Z = 90;
const SPOT_INNER_RADIUS = 26;
const SPOT_OUTER_RADIUS = 34;
// Lifted a hair off the floor so it doesn't z-fight with the grid.
const SPOT_LIFT = 1;

export function Billboard({
  url,
  label,
  standColor = "#dd0000",
  faceRef,
  showSpot = false,
  interactive = false,
  onSpotClick,
  ...props
}) {
  const { nodes, materials } = useGLTF("/models/Billboard.glb");
  const [hovered, setHovered] = useState(false);

  const spotHandlers = useClickWithoutDrag(() => onSpotClick && onSpotClick(), {
    // Otherwise the click carries on through to the ground plane behind and
    // sends the avatar walking off at the same time.
    stopPropagation: true,
  });

  useEffect(() => {
    if (!hovered) return;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = "auto";
    };
  }, [hovered]);

  return (
    <group {...props} dispose={null}>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes["Billboard_A-Mesh"].geometry}
        material={materials.Default}
      >
        {/* The panel is white in the model, but a page is composited over it.
            Tinting it to the page's own background keeps the floor reflection
            honest and kills the white flash before the iframe loads. */}
        {url && <meshStandardMaterial color="#1c1c20" roughness={0.9} />}
      </mesh>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes["Billboard_A-Mesh_1"].geometry}
        material={materials["Tree color"]}
      >
        <meshStandardMaterial color="hotpink" />
      </mesh>
      <mesh
        castShadow
        receiveShadow
        geometry={nodes["Billboard_A-Mesh_2"].geometry}
        material={materials["Mat.3"]}
      />

      {label && (
        <Center position={[0, LABEL_Y, LABEL_Z]}>
          <Text3D
            font={LABEL_FONT}
            size={LABEL_SIZE}
            height={LABEL_DEPTH}
            curveSegments={6}
            bevelEnabled
            bevelThickness={0.7}
            bevelSize={0.45}
            bevelSegments={3}
          >
            {label}
            <meshStandardMaterial
              color="#e6e6ea"
              metalness={0.55}
              roughness={0.35}
            />
          </Text3D>
        </Center>
      )}

      {/* Empty marker at the centre of the panel. The camera rig reads its
          world transform to work out where to fly to, so moving the board
          needs no changes anywhere else. */}
      <group ref={faceRef} position={FACE_CENTER} />

      {url && showSpot && (
        <group position={[0, SPOT_LIFT, SPOT_Z]} rotation-x={-Math.PI / 2}>
          {/* The hit target is the whole disc, not the ring. An annulus has
              a hollow middle, so aiming at the centre of the ring would miss
              it and fall through to the floor as a walk command instead. */}
          <mesh
            onPointerOver={(event) => {
              event.stopPropagation();
              setHovered(true);
            }}
            onPointerOut={() => setHovered(false)}
            {...spotHandlers}
          >
            <circleGeometry args={[SPOT_OUTER_RADIUS, 48]} />
            <meshBasicMaterial
              color={hovered ? "#ffffff" : "#9d4b4b"}
              transparent
              opacity={hovered ? 0.22 : 0.1}
              side={DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>

          {/* Outline, purely decorative — raycasting is off so it can never
              steal a click from the disc underneath. */}
          <mesh position-z={0.1} raycast={() => null}>
            <ringGeometry args={[SPOT_INNER_RADIUS, SPOT_OUTER_RADIUS, 48]} />
            <meshBasicMaterial
              color={hovered ? "#ffffff" : "#9d4b4b"}
              transparent
              opacity={hovered ? 0.95 : 0.55}
              side={DoubleSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </group>
      )}

      {/* A real DOM iframe projected onto the panel via CSS3D. WebGL can't
          sample a live document into a texture, so the page is composited
          over the canvas and kept in perspective by the transform. */}
      {url && (
        <Html
          transform
          // Per-pixel depth occlusion, so the avatar walking in front hides
          // the page — and so it disappears when you orbit round the back.
          occlude="blending"
          position={[
            FACE_CENTER[0],
            FACE_CENTER[1],
            FACE_CENTER[2] + FACE_OFFSET,
          ]}
          scale={SCREEN_SCALE}
          // drei defaults these to ~16.7 million, which puts the panels on
          // top of every DOM overlay we have. Kept low so the Back button
          // and the tuning panel stay above them.
          zIndexRange={[100, 0]}
          style={{ pointerEvents: interactive ? "auto" : "none" }}
        >
          <iframe
            src={url}
            title="Billboard"
            style={{
              width: SCREEN_WIDTH_PX,
              height: SCREEN_HEIGHT_PX,
              // display:block kills the inline baseline gap that would
              // otherwise show as a hairline strip along the bottom.
              border: "none",
              display: "block",
              background: "#1c1c20",
              // Only swallow pointer events once the camera has flown in;
              // otherwise the boards would eat every orbit drag that
              // crossed them.
              pointerEvents: interactive ? "auto" : "none",
            }}
          />
        </Html>
      )}
    </group>
  );
}

useGLTF.preload("/models/Billboard.glb");
