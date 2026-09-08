import { useEffect, useMemo, useState } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  CylinderGeometry,
  DoubleSide,
  Object3D,
} from "three";
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

// The extruded section name, mounted on top of the panel like signage.
// The panel's top edge is at y=229.4, so this clears it with a small gap.
const LABEL_FONT = "/fonts/helvetiker_bold.typeface.json";
// Sized so the longest label ("experience") sits at roughly half the
// panel's 203-unit width, rather than crowding the neighbouring board.
const LABEL_SIZE = 18;
const LABEL_DEPTH = 3.5;
const LABEL_Y = 248;
const LABEL_Z = 15;

// The five projector housings, measured out of Billboard.glb by clustering
// the lamp mesh along x. They sit below and in front of the panel, so they
// throw light up and back across it.
const LAMP_X = [-70.55, -36.3, -2.3, 36.4, 70.35];
const LAMP_Y = 129.8;
const LAMP_Z = 37.45;
// Where each lamp is aimed: the panel face, directly above the fixture.
const LAMP_AIM_Y = 185.67;
const LAMP_AIM_Z = 9.37;

// The "stand here to read this" marker, on the ground in front of the panel.
const SPOT_Z = 90;
const SPOT_INNER_RADIUS = 26;
const SPOT_OUTER_RADIUS = 34;
// Lifted a hair off the floor so it doesn't z-fight with the grid.
const SPOT_LIFT = 1;

// The beam is drawn as geometry rather than as a real light. Twenty spot
// lights compiled NUM_SPOT_LIGHTS=20 into every lit material's shader, which
// overruns the uniform limit on some drivers: the program fails to link and
// every lit model disappears while unlit things carry on rendering. The cones
// are what you actually see anyway, since the panel is covered by the page.
const BEAM_LENGTH = 62;
const BEAM_TOP_RADIUS = 1.5;
const BEAM_BOTTOM_RADIUS = 24;

// Every lamp sits at the same height and depth and aims at the same height
// and depth, so all five share one geometry and one rotation.
function buildBeamGeometry() {
  const geometry = new CylinderGeometry(
    BEAM_TOP_RADIUS,
    BEAM_BOTTOM_RADIUS,
    BEAM_LENGTH,
    20,
    8,
    true
  );

  // Per-vertex alpha fades the beam out along its throw. three enables
  // USE_COLOR_ALPHA automatically when the colour attribute is a vec4.
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    const along = (position.getY(i) + BEAM_LENGTH / 2) / BEAM_LENGTH;
    colors[i * 4 + 0] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = Math.pow(along, 1.7);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 4));

  // Put the narrow end at the origin and point the cone down +Z.
  geometry.translate(0, -BEAM_LENGTH / 2, 0);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

const beamGeometry = buildBeamGeometry();
const beamRotation = (() => {
  const helper = new Object3D();
  helper.lookAt(0, LAMP_AIM_Y - LAMP_Y, LAMP_AIM_Z - LAMP_Z);
  return helper.rotation.clone();
})();

/** One projector: a visible beam and a glowing bulb. */
function Lamp({ x, settings }) {
  return (
    <>
      {settings.beams && (
        <mesh
          geometry={beamGeometry}
          position={[x, LAMP_Y, LAMP_Z]}
          rotation={beamRotation}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={settings.lampColor}
            vertexColors
            transparent
            opacity={settings.beamOpacity}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* The bulb itself. Unlit basic material so it always reads as "on". */}
      <mesh position={[x, LAMP_Y - 1.5, LAMP_Z - 1.5]}>
        <sphereGeometry args={[2.4, 12, 12]} />
        <meshBasicMaterial color={settings.lampColor} toneMapped={false} />
      </mesh>
    </>
  );
}

/** A single real spot light for the whole panel, off by default. */
function PanelLight({ settings }) {
  const aim = useMemo(() => new Object3D(), []);
  return (
    <>
      <primitive object={aim} position={[0, LAMP_AIM_Y, LAMP_AIM_Z]} />
      <spotLight
        position={[0, LAMP_Y, LAMP_Z]}
        target={aim}
        angle={settings.lampAngle}
        penumbra={settings.lampPenumbra}
        intensity={settings.lampIntensity}
        color={settings.lampColor}
        distance={0}
        decay={0}
      />
    </>
  );
}

export function Billboard({
  url,
  label,
  standColor = "#dd0000",
  signage,
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

      {signage.lamps &&
        LAMP_X.map((x, index) => (
          <Lamp key={index} x={x} settings={signage} />
        ))}

      {/* Optional real illumination: one light per board, not five, so the
          scene stays well inside the shader's light budget. */}
      {signage.castLight && <PanelLight settings={signage} />}

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
            {/* Emissive so the sign reads as lit from within, like an ad,
                rather than relying on the scene lights reaching up here. */}
            <meshStandardMaterial
              color={signage.labelColor}
              emissive={signage.labelEmissive}
              emissiveIntensity={signage.labelGlow}
              metalness={0.4}
              roughness={0.4}
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
