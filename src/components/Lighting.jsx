import { useEffect, useRef } from "react";
import { ContactShadows, Environment } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { button, folder, useControls } from "leva";

const ENVIRONMENT_PRESETS = [
  "city",
  "sunset",
  "dawn",
  "night",
  "warehouse",
  "forest",
  "apartment",
  "studio",
  "park",
  "lobby",
];

/**
 * Every light and shadow in the scene, with a live leva panel over the top.
 *
 * Values are grouped into folders and the "Copy settings" button drops the
 * whole lot on the clipboard as JSON, so a look you like can be pasted
 * straight back and baked in as the new defaults.
 */
export function Lighting({ targetRef }) {
  const gl = useThree((state) => state.gl);
  const contactGroup = useRef();
  const latest = useRef({});

  const settings = useControls({
    Environment: folder({
      envPreset: {
        value: "city",
        options: ENVIRONMENT_PRESETS,
        label: "preset",
      },
      envAsBackground: { value: false, label: "as background" },
    }),
    "Ambient light": folder({
      ambientIntensity: {
        value: 0.5,
        min: 0,
        max: 3,
        step: 0.05,
        label: "intensity",
      },
      ambientColor: { value: "#ffffff", label: "color" },
    }),
    "Key light": folder({
      keyIntensity: {
        value: 1.5,
        min: 0,
        max: 6,
        step: 0.05,
        label: "intensity",
      },
      keyColor: { value: "#ffffff", label: "color" },
      keyPosition: { value: { x: 6, y: 9, z: 5 }, step: 0.5, label: "position" },
      keyCastShadow: { value: true, label: "cast shadow" },
      keyShadowBias: {
        value: -0.0005,
        min: -0.005,
        max: 0.001,
        step: 0.0001,
        label: "shadow bias",
      },
    }),
    "Fill light": folder({
      fillIntensity: {
        value: 0.35,
        min: 0,
        max: 3,
        step: 0.05,
        label: "intensity",
      },
      fillColor: { value: "#9db8ff", label: "color" },
      fillPosition: {
        value: { x: -7, y: 4, z: -5 },
        step: 0.5,
        label: "position",
      },
    }),
    Shadows: folder({
      groundShadowOpacity: {
        value: 0.32,
        min: 0,
        max: 1,
        step: 0.01,
        label: "ground opacity",
      },
      contactShadow: { value: true, label: "contact shadow" },
      contactOpacity: {
        value: 1,
        min: 0,
        max: 1,
        step: 0.05,
        label: "contact opacity",
      },
      contactBlur: { value: 1, min: 0, max: 5, step: 0.1, label: "contact blur" },
      contactScale: { value: 10, min: 2, max: 40, step: 1, label: "contact size" },
    }),
    Renderer: folder({
      exposure: { value: 1, min: 0, max: 3, step: 0.05 },
    }),
    "Copy settings": button(() => {
      const json = JSON.stringify(latest.current, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(json);
      // Logged too, in case the clipboard is blocked (it needs a secure origin).
      console.log(json);
    }),
  });

  latest.current = settings;

  useEffect(() => {
    gl.toneMappingExposure = settings.exposure;
  }, [gl, settings.exposure]);

  // The contact shadow only covers a small patch of ground, so it travels
  // with the avatar.
  useFrame(() => {
    if (!contactGroup.current || !targetRef.current) return;
    contactGroup.current.position.x = targetRef.current.x;
    contactGroup.current.position.z = targetRef.current.z;
  });

  return (
    <>
      <Environment
        preset={settings.envPreset}
        background={settings.envAsBackground}
      />

      <ambientLight
        intensity={settings.ambientIntensity}
        color={settings.ambientColor}
      />

      <directionalLight
        position={[
          settings.keyPosition.x,
          settings.keyPosition.y,
          settings.keyPosition.z,
        ]}
        intensity={settings.keyIntensity}
        color={settings.keyColor}
        castShadow={settings.keyCastShadow}
        shadow-bias={settings.keyShadowBias}
        shadow-mapSize={[2048, 2048]}
        // Default shadow frustum is only 10 units across, which would clip
        // the billboards straight out of the shadow map.
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
      />

      <directionalLight
        position={[
          settings.fillPosition.x,
          settings.fillPosition.y,
          settings.fillPosition.z,
        ]}
        intensity={settings.fillIntensity}
        color={settings.fillColor}
      />

      {/* Catches the real cast shadows. shadowMaterial draws nothing but the
          shadow itself, so the grid underneath stays visible. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.499} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <shadowMaterial transparent opacity={settings.groundShadowOpacity} />
      </mesh>

      {settings.contactShadow && (
        <group ref={contactGroup}>
          <ContactShadows
            position-y={-0.5}
            opacity={settings.contactOpacity}
            blur={settings.contactBlur}
            scale={settings.contactScale}
          />
        </group>
      )}
    </>
  );
}
