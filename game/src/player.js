// Rico, on foot: third-person movement relative to the camera, fists and (once Mara arms him)
// a pistol, and the getting-in-and-out of other people's cars. Combat consequences — heat,
// money, sirens — belong to the game state in main.js; this module reports what was hit.
import { PLAYER, WATER_Z } from './config.js';
import { collideBuildings, groundHeight } from './city.js';
import { animatePerson, knockDown, makePerson, pedInFront } from './pedestrians.js';
import { angleDelta, clamp, dist2d, turnToward } from './rng.js';

const THREE = window.THREE;

/** Create Rico: one recognisable figure — coral shirt, dark trousers, a pistol in his hand once armed. */
export function createPlayer(scene, rng) {
  const body = makePerson(rng, { skin: 0xc68863, shirt: 0xff7847, pants: 0x23232f });
  scene.add(body.group);
  const pistol = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.16, 0.42),
    new THREE.MeshLambertMaterial({ color: 0x191922 }),
  );
  pistol.position.set(0, -0.62, 0.16);
  pistol.visible = false;
  body.armR.add(pistol);
  return {
    body,
    pistol,
    x: 0,
    z: 0,
    heading: Math.PI, // facing the street (toward -z is 0; PI faces +z, the garage behind)
    vx: 0,
    vz: 0,
    health: PLAYER.maxHealth,
    mode: 'foot', // foot | car
    car: null,
    hasPistol: false,
    punchCd: 0,
    shootCd: 0,
    bustT: 0,
    deadT: 0,
  };
}

/** Put Rico somewhere, standing, facing `heading`. */
export function placePlayer(player, x, z, heading) {
  player.x = x;
  player.z = z;
  player.heading = heading;
  syncPlayerMesh(player);
}

/** Push Rico's mesh to his logical position. */
export function syncPlayerMesh(player) {
  player.body.group.position.set(player.x, groundHeight(player.x, player.z), player.z);
  player.body.group.rotation.y = player.heading;
}

/**
 * Move Rico for one step. `move` is the camera-relative wish direction {x, z} (already
 * normalised, or zero), `run` the sprint key. Buildings push him out; the sea stops him
 * waist-deep.
 */
export function updatePlayerFoot(player, move, run, dt, colliders) {
  const speed = run ? PLAYER.runSpeed : PLAYER.walkSpeed;
  const moving = Math.abs(move.x) > 0.01 || Math.abs(move.z) > 0.01;
  if (moving) {
    const want = Math.atan2(move.x, move.z);
    player.heading = turnToward(player.heading, want, 11 * dt);
    player.vx = Math.sin(player.heading) * speed;
    player.vz = Math.cos(player.heading) * speed;
    player.x += player.vx * dt;
    player.z += player.vz * dt;
    const fixed = collideBuildings(colliders, player.x, player.z, PLAYER.radius);
    player.x = fixed.x;
    player.z = fixed.z;
    player.x = clamp(player.x, -330, 330);
    player.z = clamp(player.z, -300, WATER_Z + 18);
  } else {
    player.vx = 0;
    player.vz = 0;
  }
  animatePerson(player.body, moving ? speed : 0, dt);
  syncPlayerMesh(player);
  player.punchCd = Math.max(0, player.punchCd - dt);
  player.shootCd = Math.max(0, player.shootCd - dt);
}

/**
 * Swing a fist. Returns what connected: {kind:'ped', ped} | {kind:'car', car} | {kind:'air'}.
 * A hit pedestrian goes down here; what it costs Rico is main.js's business.
 */
export function tryPunch(player, peds, cars) {
  if (player.punchCd > 0) return { kind: 'cooldown' };
  player.punchCd = 0.38;
  player.body.armR.rotation.x = -1.9; // the swing; the walker eases it back
  const ped = pedInFront(peds, player.x, player.z, player.heading, PLAYER.punchRange);
  if (ped) {
    knockDown(ped);
    return { kind: 'ped', ped };
  }
  for (const car of cars) {
    if (car.dead) continue;
    const p = car.mesh.position;
    if (dist2d(player.x, player.z, p.x, p.z) < PLAYER.punchRange + 1.6) return { kind: 'car', car };
  }
  return { kind: 'air' };
}

/**
 * Fire the pistol along Rico's facing. Hitscan: the nearest pedestrian or car inside a narrow
 * cone up to 55 units away. Returns {kind:'ped'|'car'|'none', ...}.
 */
export function tryShoot(player, peds, cars) {
  if (player.shootCd > 0 || !player.hasPistol) return { kind: 'cooldown' };
  player.shootCd = 0.26;
  player.body.armR.rotation.x = -1.45; // arm up, level with the shot
  let best = null;
  let bestD = 55;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = dist2d(player.x, player.z, ped.x, ped.z);
    if (d > bestD) continue;
    const ang = Math.atan2(ped.x - player.x, ped.z - player.z);
    if (Math.abs(angleDelta(player.heading, ang)) > 0.14) continue;
    bestD = d;
    best = { kind: 'ped', ped };
  }
  for (const car of cars) {
    if (car.dead) continue;
    const p = car.mesh.position;
    const d = dist2d(player.x, player.z, p.x, p.z);
    if (d > bestD + 2) continue;
    const ang = Math.atan2(p.x - player.x, p.z - player.z);
    if (Math.abs(angleDelta(player.heading, ang)) > 0.2) continue;
    bestD = d;
    best = { kind: 'car', car };
  }
  if (best && best.kind === 'ped') knockDown(best.ped);
  return best ?? { kind: 'none' };
}

/** The nearest car Rico could get into (parked or crawling traffic), or null. */
export function nearestEnterableCar(player, cars) {
  let best = null;
  let bestD = 3.6;
  for (const car of cars) {
    if (car.dead || car.kind === 'police') continue;
    const p = car.mesh.position;
    const d = dist2d(player.x, player.z, p.x, p.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** Climb in: Rico vanishes into the car; the car becomes the player's. */
export function enterCar(player, car) {
  player.mode = 'car';
  player.car = car;
  player.body.group.visible = false;
  car.driver = 'player';
}

/** Climb out beside the car, on whichever side is not inside a wall if we can help it. */
export function exitCar(player, colliders) {
  const car = player.car;
  if (!car) return;
  const p = car.mesh.position;
  const side = 2.6;
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  let x = p.x - rx * side;
  let z = p.z - rz * side;
  const fixed = collideBuildings(colliders, x, z, PLAYER.radius);
  x = fixed.x;
  z = fixed.z;
  placePlayer(player, x, z, car.heading);
  player.mode = 'foot';
  player.car = null;
  player.body.group.visible = true;
  car.driver = null;
}
