// Traffic: civilian cars that actually drive the road network — along the right-hand lane from
// intersection to intersection, turning at corners, braking for the car in front. They are the
// cars the player steals and the chaos the police chase weaves through.
import { GRID, ROAD_STEP } from './config.js';
import { CAR_COLORS, makeCar, placeCar, stepCar } from './vehicles.js';
import { angleDelta, clamp, dist2d } from './rng.js';

const LANE = 3.6; // offset from the road centre line, on the driver's right
const DIRS = [
  { di: 1, dj: 0 },
  { di: -1, dj: 0 },
  { di: 0, dj: 1 },
  { di: 0, dj: -1 },
];

/** The lane point at intersection (i, j) for a car travelling in direction `dir`. */
function lanePoint(i, j, dir) {
  const cx = i * ROAD_STEP;
  const cz = j * ROAD_STEP;
  // Forward (di, dj) has right-hand vector (-dj, di) on the ground plane.
  return { x: cx + -dir.dj * LANE, z: cz + dir.di * LANE };
}

function randomDir() {
  return DIRS[Math.floor(Math.random() * DIRS.length)];
}

/** Create the traffic fleet, scattered over the grid away from the player's start. */
export function createTraffic(scene, count) {
  const fleet = [];
  for (let n = 0; n < count; n += 1) {
    const car = makeCar(scene, { color: CAR_COLORS[n % CAR_COLORS.length], sports: Math.random() < 0.18, kind: 'traffic' });
    const i = Math.floor(Math.random() * (GRID * 2 + 1)) - GRID;
    const j = Math.floor(Math.random() * (GRID * 2 + 1)) - GRID;
    const dir = randomDir();
    const start = lanePoint(i, j, dir);
    placeCar(car, start.x, start.z, Math.atan2(dir.di, dir.dj));
    fleet.push({ car, i, j, dir, cruise: 10 + Math.random() * 4 });
  }
  return fleet;
}

/** Choose the next direction at an intersection: mostly straight, never a U-turn, never off-grid. */
function nextDir(t) {
  const options = [];
  for (const d of DIRS) {
    if (d.di === -t.dir.di && d.dj === -t.dir.dj) continue; // no U-turns
    const ni = t.i + d.di;
    const nj = t.j + d.dj;
    if (ni < -GRID || ni > GRID || nj < -GRID || nj > GRID) continue;
    options.push(d);
  }
  if (options.length === 0) return { di: -t.dir.di, dj: -t.dir.dj };
  const straight = options.find((d) => d.di === t.dir.di && d.dj === t.dir.dj);
  if (straight && Math.random() < 0.55) return straight;
  return options[Math.floor(Math.random() * options.length)];
}

/** Is there a vehicle close ahead of this car? Returns the gap in units or Infinity. */
function gapAhead(car, others) {
  const p = car.mesh.position;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let gap = Infinity;
  for (const other of others) {
    if (other === car || other.dead) continue;
    const q = other.mesh.position;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 1 || ahead > 13) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side < 2.6) gap = Math.min(gap, ahead);
  }
  return gap;
}

/**
 * Drive the fleet for one step. `others` is every car in the world (for braking). Impacts hard
 * enough to matter are reported through onCrash(car, impact).
 */
export function updateTraffic(fleet, others, dt, colliders, onCrash) {
  for (const t of fleet) {
    const car = t.car;
    if (car.dead) continue;
    const target = lanePoint(t.i + t.dir.di, t.j + t.dir.dj, t.dir);
    const p = car.mesh.position;
    if (dist2d(p.x, p.z, target.x, target.z) < 5) {
      t.i += t.dir.di;
      t.j += t.dir.dj;
      t.dir = nextDir(t);
      continue;
    }
    const desired = Math.atan2(target.x - p.x, target.z - p.z);
    const steer = clamp(angleDelta(car.heading, desired) * 1.7, -1, 1);
    let speedTarget = Math.abs(steer) > 0.45 ? 7 : t.cruise;
    const gap = gapAhead(car, others);
    if (gap < 7) speedTarget = 0;
    else if (gap < 12) speedTarget = Math.min(speedTarget, 5);
    const throttle = car.speed < speedTarget ? 0.75 : -0.7;
    const impact = stepCar(car, { throttle, steer, handbrake: false }, dt, colliders);
    if (impact > 9 && onCrash) onCrash(car, impact);
  }
}

/** Move one traffic car somewhere near (but not on top of) the player; keeps density up. */
export function recycleTraffic(t, x, z) {
  const i = clamp(Math.round(x / ROAD_STEP) + (Math.random() < 0.5 ? -2 : 2), -GRID, GRID);
  const j = clamp(Math.round(z / ROAD_STEP) + (Math.random() < 0.5 ? -2 : 2), -GRID, GRID);
  t.i = i;
  t.j = j;
  t.dir = randomDir();
  const start = lanePoint(i, j, t.dir);
  placeCar(t.car, start.x, start.z, Math.atan2(t.dir.di, t.dir.dj));
  t.car.speed = 0;
  t.car.health = 100;
  t.car.dead = false;
  t.car.mesh.visible = true;
}
