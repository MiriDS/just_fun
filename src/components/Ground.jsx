import { Grid, MeshReflectorMaterial } from "@react-three/drei";
import { folder, useControls } from "leva";

// Heights are stacked in 1cm steps so the three coplanar surfaces never
// z-fight: mirror at the bottom, grid lines painted over it, and the
// shadow catcher (in Lighting) above both.
const REFLECTOR_Y = -0.52;
const GRID_Y = -0.51;

const GRID_CONFIG = {
  gridSize: [10.5, 10.5],
  cellSize: 0.6,
  cellThickness: 1,
  cellColor: "#6f6f6f",
  sectionSize: 3.3,
  sectionThickness: 1.5,
  sectionColor: "#9d4b4b",
  fadeDistance: 25,
  fadeStrength: 1,
  followCamera: false,
  infiniteGrid: true,
};

/**
 * The floor: a blurred mirror with the original infinite grid painted on top,
 * so the billboards and the character sit in a reflection instead of on a
 * flat void.
 *
 * The mirror re-renders the scene into a texture every frame, so it is the
 * most expensive thing here — hence the toggle.
 */
export function Ground() {
  const { reflections, reflectionBlur, reflectionStrength, floorColor } =
    useControls({
      Ground: folder({
        reflections: { value: true, label: "reflections" },
        reflectionBlur: {
          value: 260,
          min: 0,
          max: 1000,
          step: 10,
          label: "blur",
        },
        reflectionStrength: {
          value: 5.5,
          min: 0,
          max: 15,
          step: 0.1,
          label: "strength",
        },
        floorColor: { value: "#0d0d11", label: "floor color" },
      }),
    });

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={REFLECTOR_Y}>
        <planeGeometry args={[120, 120]} />
        {reflections ? (
          <MeshReflectorMaterial
            resolution={1024}
            // Blurring the reflection vertically much less than horizontally
            // is what reads as a wet, slightly rough surface rather than a
            // polished mirror.
            blur={[reflectionBlur, reflectionBlur / 4]}
            mixBlur={1}
            mixStrength={reflectionStrength}
            roughness={0.85}
            depthScale={1.2}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.4}
            color={floorColor}
            metalness={0.85}
            mirror={0}
          />
        ) : (
          <meshStandardMaterial color={floorColor} />
        )}
      </mesh>

      <Grid
        position={[0, GRID_Y, 0]}
        args={GRID_CONFIG.gridSize}
        {...GRID_CONFIG}
      />
    </>
  );
}
