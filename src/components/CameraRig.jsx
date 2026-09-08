import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { FACE_HEIGHT, FACE_WIDTH } from "./Billboard";

// How high above the character's feet the camera pivots. Aiming at the
// chest rather than the ground keeps them framed in the middle of the
// view instead of pinned to the bottom edge.
const PIVOT_HEIGHT = 1;

// Exponential smoothing rate. Higher = the camera sticks to the character
// more rigidly; lower = it drifts along behind them. At 4 the camera closes
// ~63% of the remaining gap every 250ms.
const FOLLOW_LAMBDA = 4;

// Seconds for the fly-in to, and back out of, a billboard.
const FOCUS_DURATION = 0.9;
// Seconds for the opening camera move, and for the shortcut when skipped.
const INTRO_DURATION = 6;
const INTRO_SKIP_DURATION = 0.6;

// Waypoints for the arrival sweep: starts low beside the last billboard,
// pulls out along the row, and lands exactly on the default camera pose so
// the hand-off to the follow rig is seamless.
const INTRO_PATH = [
  [21, 3.2, 6],
  [17, 4.5, 13],
  [10, 6, 15.5],
  [8.6, 7.4, 10.5],
  [8, 8, 8],
];
// Roughly the last billboard's panel — where the camera looks before it
// turns to find the character.
const INTRO_LOOK_START = [15, 3.2, -2];
// A little breathing room so the panel isn't flush against the viewport edge.
const FOCUS_MARGIN = 1.06;

const desired = new THREE.Vector3();
const shift = new THREE.Vector3();
const faceCenter = new THREE.Vector3();
const faceNormal = new THREE.Vector3();
const faceScale = new THREE.Vector3();
const faceQuaternion = new THREE.Quaternion();
const introLookStart = new THREE.Vector3(...INTRO_LOOK_START);
const ORIGIN = new THREE.Vector3();
const introCurve = new THREE.CatmullRomCurve3(
  INTRO_PATH.map((point) => new THREE.Vector3(...point))
);

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * Works out where the camera has to sit for a billboard panel to fill the
 * viewport without any of it spilling off the edges.
 */
function computeFocusPose(faceObject, camera, outPosition, outTarget) {
  faceObject.getWorldPosition(faceCenter);
  faceObject.getWorldScale(faceScale);
  faceObject.getWorldQuaternion(faceQuaternion);
  // The panel's front side is its local +Z.
  faceNormal.set(0, 0, 1).applyQuaternion(faceQuaternion).normalize();

  const width = FACE_WIDTH * faceScale.x;
  const height = FACE_HEIGHT * faceScale.y;
  const halfFov = THREE.MathUtils.degToRad(camera.fov) / 2;

  // fov is vertical, so the horizontal limit has to be divided through by
  // the aspect ratio. Whichever constraint needs more room wins, which is
  // what keeps the whole panel on screen at any window shape.
  const distanceForHeight = height / 2 / Math.tan(halfFov);
  const distanceForWidth = width / 2 / (Math.tan(halfFov) * camera.aspect);
  const distance = Math.max(distanceForHeight, distanceForWidth) * FOCUS_MARGIN;

  outPosition.copy(faceCenter).addScaledVector(faceNormal, distance);
  outTarget.copy(faceCenter);
}

/**
 * ARPG-style follow camera, with a focus mode that flies in to a billboard.
 *
 * In follow mode it nudges the OrbitControls pivot toward the character and
 * translates the camera by the identical amount, so the camera's offset from
 * the pivot is unchanged and the orbit angle and zoom the player chose
 * survive the follow.
 *
 * Focus mode animates the pivot and the camera to a computed pose instead.
 * OrbitControls stays enabled throughout — drei only calls `update()` (which
 * is what re-aims the camera at the pivot) while `enabled` is true — so
 * input is switched off with enableRotate/enableZoom rather than `enabled`,
 * and the lookAt comes for free with no quaternion maths.
 */
export function CameraRig({ targetRef, focusObject, onIntroDone }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls);

  const transition = useRef(null);
  const savedPose = useRef(null);
  const savedLimits = useRef(null);
  const intro = useRef({ elapsed: 0, running: true });

  // Everything in the scene suspends while it loads, so this component only
  // mounts once the models, fonts and pages are ready — which makes mount
  // the right moment to start the arrival shot.
  useEffect(() => {
    if (!controls) return;
    // Guarded: if this effect ever re-runs after the sweep has finished it
    // must not take the camera away from the user again.
    if (intro.current.running) {
      controls.enableRotate = false;
      controls.enableZoom = false;
    }

    const restingTarget = () => {
      desired.copy(targetRef.current || ORIGIN);
      desired.y += PIVOT_HEIGHT;
      return desired.clone();
    };

    const skip = () => {
      if (!intro.current.running) return;
      intro.current.running = false;
      onIntroDone && onIntroDone();
      // Ease to the final pose rather than cutting, so a skip still lands
      // softly on the same spot the full sweep would have.
      transition.current = {
        elapsed: 0,
        duration: INTRO_SKIP_DURATION,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition: introCurve.getPointAt(1, new THREE.Vector3()),
        toTarget: restingTarget(),
      };
    };

    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [controls, camera, targetRef, onIntroDone]);

  useEffect(() => {
    if (!controls) return;

    if (focusObject) {
      // Remember where we came from so Back returns there exactly.
      savedPose.current = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };

      const toPosition = new THREE.Vector3();
      const toTarget = new THREE.Vector3();
      computeFocusPose(focusObject, camera, toPosition, toTarget);

      transition.current = {
        elapsed: 0,
        duration: FOCUS_DURATION,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition,
        toTarget,
      };

      // OrbitControls clamps the pivot distance, and the focus pose is
      // usually nearer than minDistance — without lifting the clamp the
      // fly-in stops short and the panel is framed differently depending
      // on the window's aspect ratio.
      savedLimits.current = {
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
      };
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
      controls.enableRotate = false;
      controls.enableZoom = false;
    } else if (savedPose.current) {
      transition.current = {
        elapsed: 0,
        duration: FOCUS_DURATION,
        fromPosition: camera.position.clone(),
        fromTarget: controls.target.clone(),
        toPosition: savedPose.current.position.clone(),
        toTarget: savedPose.current.target.clone(),
      };
      savedPose.current = null;
    }
  }, [focusObject, controls, camera]);

  useFrame((_, delta) => {
    if (!controls) return;

    if (intro.current.running) {
      intro.current.elapsed += delta;
      const t = Math.min(intro.current.elapsed / INTRO_DURATION, 1);

      // getPointAt is arc-length parameterised, so the camera holds a steady
      // speed along the curve instead of surging through the tight corners.
      introCurve.getPointAt(easeInOutCubic(t), camera.position);

      desired.copy(targetRef.current || ORIGIN);
      desired.y += PIVOT_HEIGHT;
      // The look-target catches up faster than the camera travels, so the
      // shot finds the character before the move finishes.
      controls.target.lerpVectors(
        introLookStart,
        desired,
        easeInOutCubic(Math.min(t * 1.5, 1))
      );

      if (t >= 1) {
        intro.current.running = false;
        controls.enableRotate = true;
        controls.enableZoom = true;
        onIntroDone && onIntroDone();
      }
      return;
    }

    if (transition.current) {
      const move = transition.current;
      move.elapsed += delta;
      const progress = easeInOutCubic(Math.min(move.elapsed / move.duration, 1));

      camera.position.lerpVectors(move.fromPosition, move.toPosition, progress);
      controls.target.lerpVectors(move.fromTarget, move.toTarget, progress);

      if (move.elapsed >= move.duration) {
        transition.current = null;
        // Only hand the camera back to the player once we're home again.
        if (!focusObject) {
          controls.enableRotate = true;
          controls.enableZoom = true;
          if (savedLimits.current) {
            controls.minDistance = savedLimits.current.minDistance;
            controls.maxDistance = savedLimits.current.maxDistance;
            savedLimits.current = null;
          }
        }
      }
      return;
    }

    // Parked on a billboard: leave the camera exactly where it is.
    if (focusObject) return;

    if (!targetRef.current) return;

    desired.copy(targetRef.current);
    desired.y += PIVOT_HEIGHT;

    // Frame-rate independent smoothing: a plain lerp factor would make the
    // camera chase faster on high-refresh displays.
    const alpha = 1 - Math.exp(-FOLLOW_LAMBDA * delta);
    shift.copy(desired).sub(controls.target).multiplyScalar(alpha);

    controls.target.add(shift);
    camera.position.add(shift);
    // Priority -2 so the camera is placed before OrbitControls.update() (-1)
    // and before drei's <Html> reads it (0). Without this the billboard
    // pages were positioned from the previous frame's camera and visibly
    // led the panels during the fly-in.
  }, -2);

  // OrbitControls re-aims the camera at -1, after the block above, so the
  // matrix has to be refreshed between that and <Html> at 0. Fractional
  // priorities sort fine, and only priority > 0 would disable auto-render.
  useFrame(() => camera.updateMatrixWorld(), -0.5);

  return null;
}
