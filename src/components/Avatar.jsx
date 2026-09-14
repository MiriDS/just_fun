import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAnimations, useFBX, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils";
import * as THREE from "three";
import {
  LOCAL_APPEARANCE,
  RUNNING,
  WALKING,
  decodeAppearance,
} from "./appearance";
import { isBlocked } from "./billboards";

const WALK_SPEED = 1.6; // world units per second
// Used when the click that set the target was a double-click — see
// `motion.run`.
const RUN_SPEED = 4.4;
const TURN_SPEED = 10; // how fast the avatar swings around to face the target
const ARRIVAL_DISTANCE = 0.05;
// Seconds standing still before the avatar amuses itself with a dance.
const IDLE_DANCE_DELAY = 60;
// How many times the dance plays through before the avatar goes back to Idle
// and the wait above starts over.
const DANCE_LOOPS = 2;
// Seconds to cross-fade from one clip to the next.
const FADE = 0.5;

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
 * - `run`        whether to run there rather than walk. Set together with
 *                `target`, true when the click was a double-click.
 * - `origin`     an exact position to be adopted whole, not eased onto: a
 *                spawn point, or the place a remote player was standing when
 *                they clicked. Consumed once, then cleared.
 * - `correction` a position reported over the network, which may be up to a
 *                second old. Eased onto, and only while standing still.
 */
export const createMotion = (origin = null) => ({
  target: null,
  run: false,
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

/**
 * What you see of a player: their skin, and the clips it plays. Split out of
 * Avatar so that a skin still downloading suspends only this — the avatar it
 * belongs to keeps walking, keeps its chat bubble and keeps the camera's
 * attention, and the character simply appears once its model is in.
 */
function Body({ appearance, animation, onDanceFinished }) {
  const { skin, idle, dance } = useMemo(
    () => decodeAppearance(appearance),
    [appearance]
  );
  const { scene } = useGLTF(skin);

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

  const { animations: idleAnimation } = useFBX(idle);
  const { animations: walkingAnimation } = useFBX(WALKING);
  const { animations: runningAnimation } = useFBX(RUNNING);
  const { animations: danceAnimation } = useFBX(dance);

  // Memoised because useAnimations uncaches and rebuilds every action
  // whenever this array's identity changes — which, as a bare literal, was
  // once per render of every avatar on screen.
  const clips = useMemo(() => {
    // Named by role, on the clip drei caches and every avatar shares. Safe
    // because a file only ever plays one role: an idle is never somebody
    // else's dance.
    idleAnimation[0].name = "Idle";
    walkingAnimation[0].name = "Walking";
    runningAnimation[0].name = "Running";
    danceAnimation[0].name = "Dance";

    const clips = [
      idleAnimation[0],
      walkingAnimation[0],
      runningAnimation[0],
      danceAnimation[0],
    ];

    // Mixamo exports one track per clip for the armature root — named
    // "Armature_1" — and our characters' armature is called "Armature", so it
    // binds to nothing and three warns about it. The rest are bones and bind
    // fine; dropping the odd one out is the difference between a clean
    // console and one warning per clip per avatar in the room.
    //
    // Every skin has the same skeleton, so filtering the shared clips against
    // whichever skin gets here first is right for all of them, and a no-op
    // for everyone after.
    const nodes = new Set();
    model.traverse((child) => nodes.add(child.name));
    for (const clip of clips) {
      clip.tracks = clip.tracks.filter((track) =>
        nodes.has(track.name.split(".")[0])
      );
    }

    return clips;
  }, [model, idleAnimation, walkingAnimation, runningAnimation, danceAnimation]);

  const root = useRef();
  const { actions, mixer } = useAnimations(clips, root);
  const started = useRef(false);

  useEffect(() => {
    const action = actions[animation];
    if (!action) return;

    action.reset();

    // The dance is a turn with an end, not a state to sit in: it plays
    // DANCE_LOOPS times and then tells Avatar, which goes back to Idle and
    // starts the wait over. Held on its last frame once done, so the fade
    // into Idle blends out of the final pose rather than out of a T-pose.
    const dancing = animation === "Dance";
    const handleFinished = (event) => {
      if (event.action === action) onDanceFinished();
    };
    if (dancing) {
      action.setLoop(THREE.LoopRepeat, DANCE_LOOPS);
      action.clampWhenFinished = true;
      mixer.addEventListener("finished", handleFinished);
    }

    // The first clip snaps straight on. Fading in from the bind pose would
    // hold a T-pose on screen for half a second every time someone appears.
    if (started.current) action.fadeIn(FADE);
    action.play();
    started.current = true;

    // Held in a variable rather than looked up a second time. drei's action
    // getter returns undefined once the group ref is detached, and React
    // detaches it before this cleanup runs on unmount — so the lookup that
    // used to be here threw, and one player leaving took every other
    // player's canvas down with it.
    return () => {
      if (dancing) mixer.removeEventListener("finished", handleFinished);
      action.fadeOut(FADE);
    };
  }, [animation, actions, mixer, onDanceFinished]);

  return (
    <group ref={root} dispose={null}>
      <primitive object={model} />
    </group>
  );
}

export function Avatar({ motion, positionRef, appearance, children, ...props }) {
  const group = useRef();
  const [animation, setAnimation] = useState("Idle");
  const idleFor = useRef(0);

  // The dance has played its loops: back to Idle, and the minute's wait for
  // the next one starts from zero.
  const handleDanceFinished = useCallback(() => {
    idleFor.current = 0;
    setAnimation("Idle");
  }, []);

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

      // Arrived: the walk is over, so let the target go. Kept, it would turn
      // any later nudge — a network correction easing a remote player a few
      // centimetres off the spot — into a fresh walk back onto it, then another
      // nudge, then another walk: the avatar flickering between Idle and
      // Walking every couple of frames.
      if (!moving) motion.target = null;

      if (moving) {
        const running = motion.run === true;
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
      // Past the wait this keeps asking for Dance, and keeps getting it, until
      // the dance finishes its loops and handleDanceFinished zeroes the wait.
      idleFor.current += delta;
      const resting = idleFor.current > IDLE_DANCE_DELAY ? "Dance" : "Idle";
      if (animation !== resting) setAnimation(resting);
    }

    // Published for the camera rig and the contact shadow to follow.
    if (positionRef) positionRef.current.copy(avatar.position);
  });

  return (
    <group ref={group} {...props} dispose={null}>
      {/* Keyed by appearance, so a different look is a different character
          with its own skeleton and mixer, never the old one's actions
          pointed at new bones. */}
      <Suspense fallback={null}>
        <Body
          key={appearance}
          appearance={appearance}
          animation={animation}
          onDanceFinished={handleDanceFinished}
        />
      </Suspense>
      {/* Anything mounted here rides with the avatar — a chat bubble sits on
          the group's own axis, so turning to walk never swings it around. */}
      {children}
    </group>
  );
}

// Everything this visitor's own avatar needs, fetched with the rest of the
// scene so it is standing there when the loading screen lifts. Other people's
// skins and moves load as they arrive.
const own = decodeAppearance(LOCAL_APPEARANCE);
useGLTF.preload(own.skin);
for (const url of [own.idle, own.dance, WALKING, RUNNING]) useFBX.preload(url);
