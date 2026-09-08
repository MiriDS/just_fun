import { useMemo, useRef, useState } from "react";
import {
  CapsuleCollider,
  CuboidCollider,
  Physics,
  RigidBody,
} from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { button, folder, useControls } from "leva";

const GROUND_Y = -0.5;

// The avatar is roughly 1.7 units tall. Half-height excludes the two
// hemisphere caps, so 0.55 + 0.3 + 0.3 comes back out at ~1.7.
const BODY_HALF_HEIGHT = 0.55;
const BODY_RADIUS = 0.3;
// Float the capsule a hair above the floor. Sitting flush, small objects get
// pinched between the moving capsule and the static ground and the solver
// ejects them at enormous speed.
const BODY_CLEARANCE = 0.08;

// A kinematic pusher can still impart silly impulses on a glancing hit, so
// cap what any object is allowed to do. A nudge should never launch anything.
const MAX_SPEED = 7;
const MAX_SPIN = 12;
// Anything that still manages to escape the world gets recycled.
const FELL_OUT_OF_WORLD = -10;

// Objects are scattered in a disc over the walkable area, then rejected if
// they land somewhere they would be in the way.
const SCATTER_CENTRE = [7, 2];
const SCATTER_RADIUS = 12;
const SCATTER_INNER = 2;

// Keep-out circles: [x, z, radius]. The billboard structures, the ground
// rings you click to focus, and the avatar's starting spot.
const KEEP_OUT = [
  [0, 0, 1.6],
  ...[0, 5, 10, 15].flatMap((x) => [
    [x, -2, 1.6],
    [x, -0.2, 1.2],
  ]),
];

const PALETTE = [
  "#9d4b4b",
  "#c9736f",
  "#d9d9de",
  "#5a5a68",
  "#3a3a44",
  "#8ea9d8",
  "#c9a86f",
];

// Deterministic RNG, so a given seed always lays the scene out the same way.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isClear(x, z) {
  return KEEP_OUT.every(
    ([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r
  );
}

function buildObjects(count, seed) {
  const random = mulberry32(seed);
  const objects = [];

  while (objects.length < count) {
    // Uniform over the disc: sqrt keeps them from bunching in the middle.
    const angle = random() * Math.PI * 2;
    const radius =
      SCATTER_INNER +
      Math.sqrt(random()) * (SCATTER_RADIUS - SCATTER_INNER);
    const x = SCATTER_CENTRE[0] + Math.cos(angle) * radius;
    const z = SCATTER_CENTRE[1] + Math.sin(angle) * radius;
    if (!isClear(x, z)) continue;

    const sphere = random() < 0.35;
    const size = 0.16 + random() * 0.26;

    objects.push({
      id: objects.length,
      sphere,
      position: [x, GROUND_Y + 1.5 + random() * 2.5, z],
      rotation: [random() * Math.PI, random() * Math.PI, random() * Math.PI],
      // Boxes get slightly uneven extents so the pile looks less uniform.
      args: sphere
        ? [size]
        : [size, size * (0.7 + random() * 0.7), size * (0.7 + random() * 0.7)],
      color: PALETTE[Math.floor(random() * PALETTE.length)],
    });
  }

  return objects;
}

/** Kinematic stand-in for the avatar, so walking shoves things around. */
function AvatarBody({ targetRef }) {
  const body = useRef();

  useFrame(() => {
    if (!body.current || !targetRef.current) return;
    // Kinematic bodies are driven, never pushed — the avatar barges through
    // the debris rather than being knocked off course by it.
    body.current.setNextKinematicTranslation({
      x: targetRef.current.x,
      y:
        targetRef.current.y +
        BODY_CLEARANCE +
        BODY_HALF_HEIGHT +
        BODY_RADIUS,
      z: targetRef.current.z,
    });
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false}>
      <CapsuleCollider args={[BODY_HALF_HEIGHT, BODY_RADIUS]} />
    </RigidBody>
  );
}

/**
 * Rigid-body clutter strewn across the floor, with the avatar as a moving
 * kinematic obstacle. Everything physical in the scene lives under here.
 */
export function Scatter({ targetRef }) {
  const [nonce, setNonce] = useState(0);

  const { count, seed, gravity, bounciness, showColliders } = useControls({
    Physics: folder({
      count: { value: 26, min: 0, max: 80, step: 1, label: "objects" },
      seed: { value: 7, min: 1, max: 999, step: 1, label: "seed" },
      gravity: { value: 9.81, min: 0, max: 30, step: 0.1, label: "gravity" },
      bounciness: {
        value: 0.28,
        min: 0,
        max: 1,
        step: 0.02,
        label: "bounciness",
      },
      showColliders: { value: false, label: "show colliders" },
      "Drop again": button(() => setNonce((n) => n + 1)),
    }),
  });

  const objects = useMemo(() => buildObjects(count, seed), [count, seed]);
  const bodies = useRef([]);

  useFrame(() => {
    for (let i = 0; i < bodies.current.length; i++) {
      const body = bodies.current[i];
      if (!body) continue;

      const position = body.translation();
      if (position.y < FELL_OUT_OF_WORLD) {
        // Drop it back in rather than letting it fall forever.
        const spawn = objects[i];
        if (spawn) {
          body.setTranslation(
            { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] },
            true
          );
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        continue;
      }

      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        body.setLinvel(
          {
            x: velocity.x * scale,
            y: velocity.y * scale,
            z: velocity.z * scale,
          },
          true
        );
      }

      const spinVector = body.angvel();
      const spin = Math.hypot(spinVector.x, spinVector.y, spinVector.z);
      if (spin > MAX_SPIN) {
        const scale = MAX_SPIN / spin;
        body.setAngvel(
          {
            x: spinVector.x * scale,
            y: spinVector.y * scale,
            z: spinVector.z * scale,
          },
          true
        );
      }
    }
  });

  return (
    <Physics gravity={[0, -gravity, 0]} debug={showColliders}>
      {/* Floor. Half-height 0.5 centred at -1 puts its surface exactly on
          the visual ground plane. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[60, 0.5, 60]} position={[0, GROUND_Y - 0.5, 0]} />
      </RigidBody>

      <AvatarBody targetRef={targetRef} />

      <group key={`${seed}-${count}-${nonce}`}>
        {objects.map((object) => (
          <RigidBody
            key={object.id}
            ref={(r) => (bodies.current[object.id] = r)}
            position={object.position}
            rotation={object.rotation}
            colliders={object.sphere ? "ball" : "cuboid"}
            restitution={bounciness}
            friction={0.85}
            // Without damping a knocked sphere keeps rolling indefinitely —
            // measured one travelling 32 units after a single nudge.
            linearDamping={0.45}
            angularDamping={0.65}
          >
            <mesh castShadow receiveShadow>
              {object.sphere ? (
                <sphereGeometry args={[object.args[0], 20, 20]} />
              ) : (
                <boxGeometry args={object.args.map((v) => v * 2)} />
              )}
              <meshStandardMaterial
                color={object.color}
                roughness={0.55}
                metalness={0.15}
              />
            </mesh>
          </RigidBody>
        ))}
      </group>
    </Physics>
  );
}
