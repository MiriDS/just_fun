// Where the four boards stand, and the shape of what you cannot walk through.
// One source of truth: the scene renders from BILLBOARDS, the physics world
// builds its static colliders from BILLBOARD_COLLIDERS, and the character
// steers around isBlocked.

// The boards are modelled at 50x and mounted in a scaled group.
export const BILLBOARD_SCALE = 0.02;
// The floor, repeated from the scene: everything below is world-space.
const GROUND_Y = -0.5;

export const BILLBOARDS = [
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

// Measured out of Billboard.glb by clustering the frame's vertices below head
// height: each board stands on a single central pillar, 0.90 across and 0.94
// deep, rather than on legs at its corners. Nothing else down there is solid,
// so a collider spanning the board's full 4.4m width would be an invisible
// wall across open ground.
const PILLAR_HALF_X = 0.45;
const PILLAR_HALF_Z = 0.47;
const PILLAR_Z = -2.03;

// The pillar carries the panel from here up. There is deliberately no
// collider for the panel itself: it is a 4.4m-wide slab four metres up, and
// the only thing that could ever reach it is an object spawning inside it —
// which would need a keep-out circle wide enough to clear the debris away
// from the whole billboard row. Not worth it for a board nothing can touch.
const PILLAR_TOP = 2.33;

// The avatar is a capsule of this radius. Obstacles are grown by it so the
// character stops with its shoulder against a post instead of halfway into it.
const AVATAR_RADIUS = 0.3;

const centres = BILLBOARDS.map((board) => board.position[0] * BILLBOARD_SCALE);

const pillarHalfHeight = (PILLAR_TOP - GROUND_Y) / 2;

/** Static boxes for the physics world, as half-extents and a position. */
export const BILLBOARD_COLLIDERS = centres.map((x) => ({
  args: [PILLAR_HALF_X, pillarHalfHeight, PILLAR_HALF_Z],
  position: [x, GROUND_Y + pillarHalfHeight, PILLAR_Z],
}));

// The ground marker you click to read a board, measured off SPOT_Z in
// Billboard.jsx.
const MARKER_Z = -0.2;
const MARKER_RADIUS = 1.2;
// Comfortably clear of the pillar's corners with room for the largest thing
// Scatter drops, and wide enough to leave the walk up to a board uncluttered.
const STRUCTURE_RADIUS = 1.6;

// Circles the scattered debris is kept out of: the structure, and the ground
// marker you click to read the board.
export const BILLBOARD_KEEP_OUT = centres.flatMap((x) => [
  [x, PILLAR_Z, STRUCTURE_RADIUS],
  [x, MARKER_Z, MARKER_RADIUS],
]);

// Footprints on the floor plan, already grown by the avatar's radius, so the
// character can be treated as a point when steering around them.
const FOOTPRINTS = centres.map((x) => ({
  minX: x - PILLAR_HALF_X - AVATAR_RADIUS,
  maxX: x + PILLAR_HALF_X + AVATAR_RADIUS,
  minZ: PILLAR_Z - PILLAR_HALF_Z - AVATAR_RADIUS,
  maxZ: PILLAR_Z + PILLAR_HALF_Z + AVATAR_RADIUS,
}));

/** Would a character standing here be inside a billboard's pillar? */
export function isBlocked(x, z) {
  for (const box of FOOTPRINTS) {
    if (x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ) {
      return true;
    }
  }
  return false;
}
