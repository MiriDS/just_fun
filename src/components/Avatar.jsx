import React, { useEffect, useRef, useState } from "react";
import { useAnimations, useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
// NOTE: present in the shipped bundle but never called — the animation picker
// this was wired to had already been removed when the build was made.
import { useControls } from "leva";

const WALK_SPEED = 1.6; // world units per second
const RUN_SPEED = 4.4;
// Anything further than this is worth breaking into a run for. Dropping back
// to a walk inside it also gives a natural deceleration on approach.
const RUN_DISTANCE = 3.5;
const TURN_SPEED = 10; // how fast the avatar swings around to face the target
const ARRIVAL_DISTANCE = 0.05;
// How long the avatar stands around before amusing itself.
const IDLE_DANCE_DELAY = 60;

// Reused every frame so walking doesn't allocate.
const direction = new THREE.Vector3();

// Shortest-path angle interpolation, so turning from -170deg to +170deg
// goes the short way round instead of spinning most of a full circle.
function lerpAngle(current, target, t) {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}

export function Avatar({ target, positionRef, ...props }) {
  const { nodes, materials, scene } = useGLTF("/models/Animated.glb");

  const { animations: idleAnimation } = useFBX("/models/Idle.fbx");
  const { animations: walkingAnimation } = useFBX("/models/Walking.fbx");
  const { animations: runningAnimation } = useFBX("/models/Running.fbx");
  const { animations: danceAnimation } = useFBX("/models/Dance.fbx");
  const { animations: crouchAnimation } = useFBX("/models/Crouch.fbx");

  idleAnimation[0].name = "Idle";
  walkingAnimation[0].name = "Walking";
  runningAnimation[0].name = "Running";
  danceAnimation[0].name = "Dance";
  crouchAnimation[0].name = "Crouch";

  const group = useRef();
  const { actions, mixer } = useAnimations(
    [
      idleAnimation[0],
      walkingAnimation[0],
      runningAnimation[0],
      danceAnimation[0],
      crouchAnimation[0],
    ],
    group
  );

  const [animation, setAnimation] = useState("Idle");
  const idleFor = useRef(0);

  useEffect(() => {
    actions[animation].reset().fadeIn(0.5).play();
    return () => actions[animation].fadeOut(0.5);
  }, [animation]);

  useFrame((_, delta) => {
    const avatar = group.current;
    if (!avatar) return;

    let moving = false;

    if (target) {
      direction.set(
        target[0] - avatar.position.x,
        0,
        target[1] - avatar.position.z
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
        avatar.position.x += direction.x * step;
        avatar.position.z += direction.z * step;

        avatar.rotation.y = lerpAngle(
          avatar.rotation.y,
          Math.atan2(direction.x, direction.z),
          Math.min(TURN_SPEED * delta, 1)
        );

        const gait = running ? "Running" : "Walking";
        if (animation !== gait) setAnimation(gait);
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
      <group name="Scene">
        <group name="Armature">
          <primitive object={nodes.Hips} />
        </group>
        <skinnedMesh
          castShadow
          name="avaturn_body"
          geometry={nodes.avaturn_body.geometry}
          material={materials.avaturn_body_material}
          skeleton={nodes.avaturn_body.skeleton}
        />
        <skinnedMesh
          castShadow
          name="avaturn_glasses_0"
          geometry={nodes.avaturn_glasses_0.geometry}
          material={materials.avaturn_glasses_0_material}
          skeleton={nodes.avaturn_glasses_0.skeleton}
        />
        <skinnedMesh
          castShadow
          name="avaturn_glasses_1"
          geometry={nodes.avaturn_glasses_1.geometry}
          material={materials.avaturn_glasses_1_material}
          skeleton={nodes.avaturn_glasses_1.skeleton}
        />
        <skinnedMesh
          castShadow
          name="avaturn_hair_0"
          geometry={nodes.avaturn_hair_0.geometry}
          material={materials.avaturn_hair_0_material}
          skeleton={nodes.avaturn_hair_0.skeleton}
        />
        <skinnedMesh
          castShadow
          name="avaturn_shoes_0"
          geometry={nodes.avaturn_shoes_0.geometry}
          material={materials.avaturn_shoes_0_material}
          skeleton={nodes.avaturn_shoes_0.skeleton}
        />
        <skinnedMesh
          castShadow
          name="avaturn_look_0"
          geometry={nodes.avaturn_look_0.geometry}
          material={materials.avaturn_look_0_material}
          skeleton={nodes.avaturn_look_0.skeleton}
        />
      </group>
    </group>
  );
}

useGLTF.preload("/models/Animated.glb");
