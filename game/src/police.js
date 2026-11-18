// The Palm City PD: interceptors that spawn at the edge of the action when the heat is on, hunt
// the player through the same streets the traffic uses, and ram what they catch. Their light
// bars strobe red and blue; when the heat dies they give up and leave.
import { GRID, HEAT, ROAD_STEP } from './config.js';
import { makeCar, placeCar, stepCar } from './vehicles.js';
import { angleDelta, clamp, dist2d } from './rng.js';

/** How many interceptors the current star count sends out. */
export function desiredPolice(stars) {
  if (stars <= 0) return 0;
  return Math.min(2 + stars, 6);
}

function spawnPointNear(x, z) {
  // A road intersection on a ring around the target, so cruisers arrive from real streets.
  const angle = Math.random() * Math.PI * 2;
  const dist = 78 + Math.random() * 26;
  const i = clamp(Math.round((x + Math.sin(angle) * dist) / ROAD_STEP), -GRID, GRID);
  const j = clamp(Math.round((z + Math.cos(angle) * dist) / ROAD_STEP), -GRID, GRID);
  return { x: i * ROAD_STEP, z: j * ROAD_STEP };
}

/**
 * Keep the police fleet matched to the heat: spawn up to the wanted count, retire cruisers that
 * fall far behind once the heat is gone. `target` is the player's position {x, z}.
 */
export function updatePoliceFleet(fleet, scene, stars, target) {
  const want = desiredPolice(stars);
  while (fleet.length < want) {
    const car = makeCar(scene, { police: true, kind: 'police' });
    const s = spawnPointNear(target.x, target.z);
    placeCar(car, s.x, s.z, Math.random() * Math.PI * 2);
    fleet.push({ car, stuckT: 0 });
  }
  for (let i = fleet.length - 1; i >= 0; i -= 1) {
    const p = fleet[i].car.mesh.position;
    if (stars === 0 && dist2d(p.x, p.z, target.x, target.z) > 120) {
      scene.remove(fleet[i].car.mesh);
      fleet.splice(i, 1);
    }
  }
}

/** Strobe the light bars: red and blue trade places four times a second. */
export function flashLights(fleet, time) {
  const phase = Math.floor(time * 4) % 2 === 0;
  for (const unit of fleet) {
    const bar = unit.car.lightbar;
    if (!bar) continue;
    bar.red.color.setHex(phase ? 0xff2038 : 0x57101d);
    bar.blue.color.setHex(phase ? 0x12295c : 0x2a7fff);
  }
}

/**
 * Drive every cruiser at the player. They aim where the player is heading, brake when they are
 * on top of a player on foot (they want a bust, not a body), and back up when they wedge
 * themselves on a wall. Hard wall strikes are reported through onCrash.
 */
export function updatePolice(fleet, dt, colliders, target, onCrash) {
  for (const unit of fleet) {
    const car = unit.car;
    if (car.dead) continue;
    const p = car.mesh.position;
    const dist = dist2d(p.x, p.z, target.x, target.z);
    // Lead the target a little so chases cut corners instead of trailing forever.
    const lead = clamp(dist / 26, 0, 1.4);
    const tx = target.x + (target.vx ?? 0) * lead;
    const tz = target.z + (target.vz ?? 0) * lead;
    const desired = Math.atan2(tx - p.x, tz - p.z);
    let steer = clamp(angleDelta(car.heading, desired) * 1.9, -1, 1);
    let throttle = 1;
    if (target.onFoot && dist < 6) {
      // Pull up alongside a runner instead of ploughing through them.
      throttle = dist < 3.4 ? -0.4 : 0.25;
      steer = clamp(angleDelta(car.heading, desired) * 1.2, -1, 1);
    }
    if (Math.abs(car.speed) < 0.5) unit.stuckT += dt;
    else unit.stuckT = 0;
    if (unit.stuckT > 1.1) {
      // Wedged: reverse and swing the wheel the other way.
      throttle = -1;
      steer = -steer || 0.8;
      if (unit.stuckT > 2.2) unit.stuckT = 0;
    }
    const impact = stepCar(car, { throttle, steer, handbrake: false }, dt, colliders);
    if (impact > 9 && onCrash) onCrash(car, impact);
  }
}

/** The closest cruiser's distance to a point, for sirens and bust checks. */
export function nearestPolice(fleet, x, z) {
  let best = Infinity;
  for (const unit of fleet) {
    const p = unit.car.mesh.position;
    best = Math.min(best, dist2d(p.x, p.z, x, z));
  }
  return best;
}

export { HEAT };
