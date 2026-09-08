import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAnimations, useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils";
import * as THREE from "three";
import { isBlocked } from "./billboards";

const WALK_SPEED = 1.6; // world units per second
const RUN_SPEED = 4.4;
// Anything further than this is worth breaking into a run for. Dropping back
// to a walk inside it also gives a natural deceleration on approach.
const RUN_DISTANCE = 3.5;
const TURN_SPEED = 10; // how fast the avatar swings around to face the target
const ARRIVAL_DISTANCE = 0.05;
// How long the avatar stands around before amusing itself.
const IDLE_DANCE_DELAY = 60;

// How fast a standing avatar slides onto a network correction.
const CORRECTION_RATE = 3;
// Past this the two ends have genuinely lost each other — a backgrounded tab
// catching up in one enormous frame, say. Cut rather than glide.
const CORRECTION_SNAP = 3;
// Close enough to stop correcting.
const CORRECTION_SETTLED = 0.02;

// A step that achieves less than this share of what it asked for has run into
// something it cannot slide along.
const STUCK_FRACTION = 0.1;

// Reused every frame so walking doesn't allocate.
const direction = new THREE.Vector3();

/**
 * The mutable object an Avatar is driven by. Deliberately not React state:
 * for the local player it changes on every click, and for remote players it
 * changes on every packet, none of which is worth a re-render of the scene.
 *
 * - `target`     where to walk, as [x, z], or null to stand still.
 * - `origin`     an exact position to be adopted whole, not eased onto: a
 *                spawn point, or the place a remote player was standing when
 *                they clicked. Consumed once, then cleared.
 * - `correction` a position reported over the network, which may be up to a
 *                second old. Eased onto, and only while standing still.
 */
export const createMotion = (origin = null) => ({
  target: null,
  origin,
  correction: null,
});

// Shortest-path angle interpolation, so turning from -170deg to +170deg
// goes the short way round instead of spinning most of a full circle.
function lerpAngle(current, target, t) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}

export function Avatar({ motion, positionRef, children, ...props }) {
  const { scene } = useGLTF("/models/Animated.glb");

  // A skeleton cannot be in two places at once: mounting the loader's own
  // `nodes.Hips` in a second Avatar re-parents the bones out of the first and
  // one of the two characters collapses. Every instance gets its own copy —
  // geometry and textures are still shared, so this costs a skeleton, not a
  // download.
  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    copy.traverse((child) => {
      if (child.isSkinnedMesh) child.castShadow = true;
    });
    return copy;
  }, [scene]);

  const { animations: idleAnimation } = useFBX("/models/Idle.fbx");
  const { animations: walkingAnimation } = useFBX("/models/Walking.fbx");
  const { animations: runningAnimation } = useFBX("/models/Running.fbx");
  const { animations: danceAnimation } = useFBX("/models/Dance.fbx");
  const { animations: crouchAnimation } = useFBX("/models/Crouch.fbx");

  // Memoised because useAnimations uncaches and rebuilds every action
  // whenever this array's identity changes — which, as a bare literal, was
  // once per render of every avatar on screen.
  const clips = useMemo(() => {
    idleAnimation[0].name = "Idle";
    walkingAnimation[0].name = "Walking";
    runningAnimation[0].name = "Running";
    danceAnimation[0].name = "Dance";
    crouchAnimation[0].name = "Crouch";

    return [
      idleAnimation[0],
      walkingAnimation[0],
      runningAnimation[0],
      danceAnimation[0],
      crouchAnimation[0],
    ];
  }, [
    idleAnimation,
    walkingAnimation,
    runningAnimation,
    danceAnimation,
    crouchAnimation,
  ]);

  const group = useRef();
  const { actions } = useAnimations(clips, group);

  const [animation, setAnimation] = useState("Idle");
  const idleFor = useRef(0);

  useEffect(() => {
    actions[animation].reset().fadeIn(0.5).play();
    return () => actions[animation].fadeOut(0.5);
  }, [animation, actions]);

  // Before the first paint, so a remote player never shows up at the origin
  // for a frame on their way to their spawn point.
  useLayoutEffect(() => {
    const avatar = group.current;
    if (!avatar || !motion.origin) return;
    avatar.position.x = motion.origin[0];
    avatar.position.z = motion.origin[1];
    motion.origin = null;
  }, [motion]);

  useFrame((_, delta) => {
    const avatar = group.current;
    if (!avatar) return;

    // An exact position, handed over rather than estimated: adopt it whole.
    if (motion.origin) {
      avatar.position.x = motion.origin[0];
      avatar.position.z = motion.origin[1];
      motion.origin = null;
    }

    let moving = false;

    if (motion.target) {
      direction.set(
        motion.target[0] - avatar.position.x,
        0,
        motion.target[1] - avatar.position.z
      );
      const distance = direction.length();
      moving = distance >= ARRIVAL_DISTANCE;

      if (moving) {
        const running = distance > RUN_DISTANCE;
        const speed = running ? RUN_SPEED : WALK_SPEED;

        direction.normalize();
        // Clamped to the remaining distance so we settle on the target
        // instead of overshooting and jittering around it.
        const step = Math.min(speed * delta, distance);
        const nextX = avatar.position.x + direction.x * step;
        const nextZ = avatar.position.z + direction.z * step;

        // Billboards are solid. Blocked diagonally, the step is retried one
        // axis at a time so the character slides along the post rather than
        // sticking to it; blocked both ways, it stays put and keeps playing
        // its walk, which is what walking into something looks like.
        //
        // Remote avatars run this same code from the same obstacle list, so
        // the walk stays reproducible from the click alone.
        const fromX = avatar.position.x;
        const fromZ = avatar.position.z;

        if (!isBlocked(nextX, nextZ)) {
          avatar.position.x = nextX;
          avatar.position.z = nextZ;
        } else if (!isBlocked(nextX, avatar.position.z)) {
          avatar.position.x = nextX;
        } else if (!isBlocked(avatar.position.x, nextZ)) {
          avatar.position.z = nextZ;
        }

        // Wedged: the step was refused, or so nearly refused that we are
        // grinding against a post. Give the target up rather than walking on
        // the spot forever — a click on the base of a board can ask for a
        // place there is no standing in.
        const travelled = Math.hypot(
          avatar.position.x - fromX,
          avatar.position.z - fromZ
        );
        if (travelled < step * STUCK_FRACTION) {
          motion.target = null;
          moving = false;
        }

        avatar.rotation.y = lerpAngle(
          avatar.rotation.y,
          Math.atan2(direction.x, direction.z),
          Math.min(TURN_SPEED * delta, 1)
        );

        const gait = running ? "Running" : "Walking";
        if (animation !== gait) setAnimation(gait);
      }
    }

    // A correction is up to a second old, so leaning on one mid-walk would
    // drag the avatar back to where its owner was a second ago. Both ends run
    // the same walk from the same origin and agree anyway; a disagreement is
    // only real once the walking has stopped.
    if (motion.correction) {
      const gapX = motion.correction[0] - avatar.position.x;
      const gapZ = motion.correction[1] - avatar.position.z;
      const gap = Math.hypot(gapX, gapZ);

      if (gap > CORRECTION_SNAP) {
        avatar.position.x = motion.correction[0];
        avatar.position.z = motion.correction[1];
        motion.correction = null;
      } else if (!moving) {
        if (gap < CORRECTION_SETTLED) {
          motion.correction = null;
        } else {
          const ease = Math.min(CORRECTION_RATE * delta, 1);
          avatar.position.x += gapX * ease;
          avatar.position.z += gapZ * ease;
        }
      }
    }

    if (moving) {
      idleFor.current = 0;
    } else {
      idleFor.current += delta;
      const resting = idleFor.current > IDLE_DANCE_DELAY ? "Dance" : "Idle";
      if (animation !== resting) setAnimation(resting);
    }

    // Published for the camera rig and the contact shadow to follow.
    if (positionRef) positionRef.current.copy(avatar.position);
  });

  return (
    <group ref={group} {...props} dispose={null}>
      <primitive object={model} />
      {/* Anything mounted here rides with the avatar — a chat bubble sits on
          the group's own axis, so turning to walk never swings it around. */}
      {children}
    </group>
  );
}

useGLTF.preload("/models/Animated.glb");
