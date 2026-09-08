import { config } from "./config.js";

// Point 0 is the world origin, because that is where the single-player scene
// has always started and the whole arrival camera move is framed around it: a
// lone visitor must not be able to tell the server is there at all. Everyone
// after them is placed on a golden-angle spiral around it, which is the
// cheapest way to get points that never clump however many you take.
const SPAWN_CENTRE = [0, 0];
const SPAWN_MIN_RADIUS = 2;
const SPAWN_GROWTH = 0.9;
const GOLDEN_ANGLE = 2.399963229728653;

// How close another player has to be for a spawn point to count as taken.
const SPAWN_CLEARANCE = 1.5;

// The billboard row: panels at world x 0..15, z -2, floor markers at z -0.2.
// Nothing stops an avatar walking through a panel, but starting inside one
// reads as a bug, so spawn points that land in here are skipped.
const BILLBOARD_BAND = { minX: -2, maxX: 17, minZ: -3.5, maxZ: 0.5 };

function spawnPoint(index) {
  if (index === 0) return [...SPAWN_CENTRE];

  const angle = index * GOLDEN_ANGLE;
  const radius = SPAWN_MIN_RADIUS + SPAWN_GROWTH * Math.sqrt(index - 1);
  return [
    SPAWN_CENTRE[0] + Math.cos(angle) * radius,
    SPAWN_CENTRE[1] + Math.sin(angle) * radius,
  ];
}

const inBillboardRow = ([x, z]) =>
  x > BILLBOARD_BAND.minX &&
  x < BILLBOARD_BAND.maxX &&
  z > BILLBOARD_BAND.minZ &&
  z < BILLBOARD_BAND.maxZ;

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Everyone currently in the scene. Purely in memory: a player is their
 * connection, so there is nothing worth persisting past a restart.
 */
export class World {
  #players = new Map();

  get size() {
    return this.#players.size;
  }

  isFull() {
    return this.#players.size >= config.maxPlayers;
  }

  get(id) {
    return this.#players.get(id);
  }

  add(id) {
    const player = {
      id,
      // Assigned here, and only here. If clients rolled their own, two
      // viewers would disagree about what a player is wearing and a
      // reconnecting player would change clothes.
      appearance: Math.floor(Math.random() * config.appearanceCount),
      position: this.#freeSpawn(),
      // Null means "standing still", which is what the client's Avatar
      // already understands.
      target: null,
      // Whether this player has reported a position since the last sync
      // broadcast, so the batch only carries players who actually moved.
      dirty: false,
    };

    this.#players.set(id, player);
    return player;
  }

  remove(id) {
    return this.#players.delete(id);
  }

  /** Everyone except `exceptId`, in the shape the client expects. */
  snapshot(exceptId = null) {
    const players = [];
    for (const player of this.#players.values()) {
      if (player.id !== exceptId) players.push(serialize(player));
    }
    return players;
  }

  /** Players who have moved since the last call, and clears the flags. */
  takeMoved() {
    const moved = [];
    for (const player of this.#players.values()) {
      if (!player.dirty) continue;
      player.dirty = false;
      moved.push({ id: player.id, position: player.position });
    }
    return moved;
  }

  /**
   * The first spawn point clear of everyone already here. Past capacity of
   * the spiral it falls back to the last point, which cannot happen while
   * maxPlayers is sane but keeps this total.
   */
  #freeSpawn() {
    const taken = [...this.#players.values()].map((player) => player.position);

    // Twice the capacity of candidates, since points inside the billboard row
    // are skipped and a full world would otherwise run out of them.
    for (let index = 0; index < config.maxPlayers * 2; index++) {
      const point = spawnPoint(index);
      // The origin is the exception: the first visitor gets it even though it
      // sits in the billboard band, because that is the single-player start.
      if (index > 0 && inBillboardRow(point)) continue;

      const clear = taken.every(
        (other) => distance(point, other) > SPAWN_CLEARANCE
      );
      if (clear) return point;
    }

    return spawnPoint(config.maxPlayers * 2);
  }
}

export function serialize(player) {
  return {
    id: player.id,
    appearance: player.appearance,
    position: player.position,
    target: player.target,
  };
}
