// People: one low-poly person factory (used for Rico and for every pedestrian) and the crowd
// itself — Palm City residents strolling the sidewalks block by block, who run from trouble and
// go down when a car finds them. A downed pedestrian fades and quietly respawns across town, so
// the streets never empty and never pile up.
import { BLOCK_HALF, GRID, ROAD_STEP } from './config.js';
import { groundHeight } from './city.js';
import { angleDelta, clamp, dist2d, turnToward } from './rng.js';

const THREE = window.THREE;

const SKIN = [0xf2c79b, 0xc68863, 0x8a5a3b, 0x6e4530, 0xffdbac];
const SHIRTS = [0xff5f6d, 0x37e0ff, 0xffd23e, 0x7dff8a, 0xe08aff, 0xff7847, 0xf2f2f2, 0x20c9a6, 0x3a6ff2];
const PANTS = [0x2b2b3d, 0x4a3a2a, 0x31456e, 0x555560, 0x1f2a24];

function limb(w, h, d, mat) {
  const pivot = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  box.position.y = -h / 2;
  box.castShadow = true;
  pivot.add(box);
  return pivot;
}

/** Build a person. Returns the group plus the swinging parts the walker animates. */
export function makePerson(rng, opts = {}) {
  const skin = new THREE.MeshLambertMaterial({ color: opts.skin ?? rng.pick(SKIN) });
  const shirt = new THREE.MeshLambertMaterial({ color: opts.shirt ?? rng.pick(SHIRTS) });
  const pants = new THREE.MeshLambertMaterial({ color: opts.pants ?? rng.pick(PANTS) });
  const group = new THREE.Group();
  const legL = limb(0.24, 0.8, 0.24, pants);
  legL.position.set(-0.17, 0.82, 0);
  group.add(legL);
  const legR = limb(0.24, 0.8, 0.24, pants);
  legR.position.set(0.17, 0.82, 0);
  group.add(legR);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.72, 0.34), shirt);
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);
  const armL = limb(0.17, 0.66, 0.17, shirt);
  armL.position.set(-0.42, 1.5, 0);
  group.add(armL);
  const armR = limb(0.17, 0.66, 0.17, shirt);
  armR.position.set(0.42, 1.5, 0);
  group.add(armR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.76;
  head.castShadow = true;
  group.add(head);
  return { group, legL, legR, armL, armR, phase: rng.range(0, 6) };
}

/** Swing the limbs for a walker moving at `speed`; ease to a standstill pose at speed 0. */
export function animatePerson(person, speed, dt) {
  person.phase += dt * (2.2 + speed * 1.55);
  const swing = clamp(speed / 3, 0, 1) * 0.6;
  const s = Math.sin(person.phase) * swing;
  person.legL.rotation.x = s;
  person.legR.rotation.x = -s;
  person.armL.rotation.x = -s * 0.8;
  person.armR.rotation.x = s * 0.8;
}

/** Lay a person flat on the ground (knocked down). */
export function layPersonDown(person) {
  person.group.rotation.x = -Math.PI / 2;
  person.group.position.y = 0.25;
  person.legL.rotation.x = 0.2;
  person.legR.rotation.x = -0.15;
  person.armL.rotation.x = 0.9;
  person.armR.rotation.x = -0.7;
}

/** Stand a person back up. */
export function standPersonUp(person) {
  person.group.rotation.x = 0;
}

const WALK_HALF = BLOCK_HALF - 2.5; // the pavement loop a pedestrian walks around their block

function blockCorner(bx, bz, corner) {
  const cx = bx * ROAD_STEP + ROAD_STEP / 2;
  const cz = bz * ROAD_STEP + ROAD_STEP / 2;
  const sx = corner === 0 || corner === 3 ? -WALK_HALF : WALK_HALF;
  const sz = corner < 2 ? -WALK_HALF : WALK_HALF;
  return { x: cx + sx, z: cz + sz };
}

/** Create the crowd and add everyone to the scene. */
export function createCrowd(scene, rng, count) {
  const peds = [];
  for (let i = 0; i < count; i += 1) {
    const body = makePerson(rng);
    scene.add(body.group);
    const ped = {
      body,
      bx: rng.int(-GRID, GRID - 1),
      bz: rng.int(-GRID, GRID - 1),
      corner: rng.int(0, 3),
      dir: rng.chance(0.5) ? 1 : -1,
      speed: rng.range(1.1, 1.9),
      state: 'walk', // walk | flee | down
      stateT: 0,
      fleeFrom: { x: 0, z: 0 },
      heading: rng.range(0, Math.PI * 2),
      x: 0,
      z: 0,
    };
    const start = blockCorner(ped.bx, ped.bz, ped.corner);
    ped.x = start.x + rng.range(-6, 6);
    ped.z = start.z + rng.range(-6, 6);
    peds.push(ped);
  }
  return peds;
}

function placePed(ped) {
  ped.body.group.position.set(ped.x, groundHeight(ped.x, ped.z), ped.z);
  ped.body.group.rotation.y = ped.heading;
}

/** Knock a pedestrian down. Returns false if they were already down. */
export function knockDown(ped) {
  if (ped.state === 'down') return false;
  ped.state = 'down';
  ped.stateT = 0;
  layPersonDown(ped.body);
  return true;
}

/** Everyone within `radius` of a scare runs from it. */
export function scareCrowd(peds, x, z, radius) {
  for (const ped of peds) {
    if (ped.state === 'walk' && dist2d(ped.x, ped.z, x, z) < radius) {
      ped.state = 'flee';
      ped.stateT = 0;
      ped.fleeFrom.x = x;
      ped.fleeFrom.z = z;
    }
  }
}

/** Advance the whole crowd. */
export function updateCrowd(peds, dt) {
  for (const ped of peds) {
    if (ped.state === 'down') {
      ped.stateT += dt;
      if (ped.stateT > 7) {
        // Quietly reappear across town, upright and unbothered.
        ped.bx = Math.floor(Math.random() * (GRID * 2)) - GRID;
        ped.bz = Math.floor(Math.random() * (GRID * 2)) - GRID;
        ped.corner = Math.floor(Math.random() * 4);
        const s = blockCorner(ped.bx, ped.bz, ped.corner);
        ped.x = s.x;
        ped.z = s.z;
        ped.state = 'walk';
        standPersonUp(ped.body);
      }
      placePed(ped);
      if (ped.state === 'down') ped.body.group.position.y = 0.25;
      continue;
    }
    let tx;
    let tz;
    let speed = ped.speed;
    if (ped.state === 'flee') {
      ped.stateT += dt;
      const away = Math.atan2(ped.x - ped.fleeFrom.x, ped.z - ped.fleeFrom.z);
      tx = ped.x + Math.sin(away) * 10;
      tz = ped.z + Math.cos(away) * 10;
      speed = 4.6;
      if (ped.stateT > 2.6) ped.state = 'walk';
    } else {
      const target = blockCorner(ped.bx, ped.bz, ped.corner);
      tx = target.x;
      tz = target.z;
      if (dist2d(ped.x, ped.z, tx, tz) < 1.2) {
        ped.corner = (ped.corner + ped.dir + 4) % 4;
        continue;
      }
    }
    const want = Math.atan2(tx - ped.x, tz - ped.z);
    ped.heading = turnToward(ped.heading, want, 6 * dt);
    ped.x += Math.sin(ped.heading) * speed * dt;
    ped.z += Math.cos(ped.heading) * speed * dt;
    animatePerson(ped.body, speed, dt);
    placePed(ped);
  }
}

/** The nearest standing pedestrian within `radius` of a point, or null. */
export function nearestPed(peds, x, z, radius) {
  let best = null;
  let bestD = radius;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = dist2d(ped.x, ped.z, x, z);
    if (d < bestD) {
      bestD = d;
      best = ped;
    }
  }
  return best;
}

/** The nearest standing pedestrian in front of (x, z, heading) within range and a half-radian arc. */
export function pedInFront(peds, x, z, heading, range) {
  let best = null;
  let bestD = range;
  for (const ped of peds) {
    if (ped.state === 'down') continue;
    const d = dist2d(ped.x, ped.z, x, z);
    if (d > bestD) continue;
    const ang = Math.atan2(ped.x - x, ped.z - z);
    if (Math.abs(angleDelta(heading, ang)) > 0.6) continue;
    bestD = d;
    best = ped;
  }
  return best;
}
