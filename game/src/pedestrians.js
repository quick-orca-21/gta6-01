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
const HAIR = [0x241a14, 0x0d0d0f, 0x4a2e1a, 0x8a5a2a, 0xc9a86a, 0x9a9aa2, 0xff5f6d, 0x37e0ff];
const SHOES = [0x23232c, 0xf0f0f0, 0x7a2a22, 0x274156];
const HATS = [0xff5f6d, 0xffd23e, 0x37e0ff, 0xf2f2f2, 0xff7847];

// One shared set of rounded primitives for every figure in the city: the crowd, Rico and Mara
// are all assembled from these same geometries, and materials are cached per colour, so a
// street full of people costs no more to build than a handful. Proportions are human — the
// head is about a seventh of the ~1.78 height, shoulders taper to the waist, and the limbs
// hang from real shoulder and hip pivots so the walker's swing reads as a stride.
const GEO = {
  head: new THREE.SphereGeometry(0.12, 14, 11),
  hairCap: new THREE.SphereGeometry(0.129, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.62),
  hairShort: new THREE.SphereGeometry(0.127, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.44),
  hairBack: new THREE.SphereGeometry(0.124, 10, 8),
  hatTop: new THREE.SphereGeometry(0.131, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52),
  hatBrim: new THREE.CylinderGeometry(0.2, 0.21, 0.018, 14),
  eye: new THREE.SphereGeometry(0.016, 6, 5),
  torso: new THREE.CylinderGeometry(0.235, 0.155, 0.6, 12),
  pelvis: new THREE.SphereGeometry(0.165, 12, 9),
  shoulder: new THREE.SphereGeometry(0.084, 9, 7),
  upperArm: new THREE.CylinderGeometry(0.056, 0.047, 0.34, 8),
  forearm: new THREE.CylinderGeometry(0.042, 0.037, 0.27, 8),
  hand: new THREE.SphereGeometry(0.05, 8, 6),
  leg: new THREE.CylinderGeometry(0.079, 0.052, 0.78, 9),
  shoe: new THREE.SphereGeometry(0.078, 9, 7),
  chain: new THREE.TorusGeometry(0.078, 0.013, 6, 14),
  belt: new THREE.CylinderGeometry(0.19, 0.195, 0.07, 12),
};

const matCache = new Map();
function mat(color) {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a1214 });
const goldMat = new THREE.MeshPhongMaterial({ color: 0xffc94d, shininess: 130, specular: 0xffe9a8 });
const beltMat = new THREE.MeshLambertMaterial({ color: 0x3a2417 });

function part(geo, material, x, y, z, shadow = true) {
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  return mesh;
}

/** An arm on a shoulder pivot: sleeved upper arm, a slightly bent forearm, a rounded hand. */
function makeArm(sleeve, skin) {
  const pivot = new THREE.Group();
  pivot.add(part(GEO.upperArm, sleeve, 0, -0.17, 0));
  const fore = new THREE.Group();
  fore.position.y = -0.34;
  fore.rotation.x = -0.16; // a relaxed elbow, not a soldier's arm
  fore.add(part(GEO.forearm, skin, 0, -0.13, 0));
  const hand = part(GEO.hand, skin, 0, -0.3, 0.01);
  hand.scale.set(0.85, 1.2, 0.9);
  fore.add(hand);
  pivot.add(fore);
  return pivot;
}

/** A leg on a hip pivot: tapered trouser leg with a rounded shoe at the foot. */
function makeLeg(pants, shoeColor) {
  const pivot = new THREE.Group();
  pivot.add(part(GEO.leg, pants, 0, -0.39, 0));
  const shoe = part(GEO.shoe, mat(shoeColor), 0, -0.8, 0.045);
  shoe.scale.set(0.92, 0.52, 1.85);
  pivot.add(shoe);
  return pivot;
}

/** Hair (or a cap) on the head: full cap, short crop, long back panel, snapback, or none. */
function addHair(group, style, color) {
  if (style === 'bald') return;
  if (style === 'hat') {
    const hat = mat(color);
    const top = part(GEO.hatTop, hat, 0, 1.656, -0.006);
    top.scale.set(0.97, 1.05, 1.0);
    group.add(top);
    const brim = part(GEO.hatBrim, hat, 0, 1.694, 0.045, false);
    brim.rotation.x = 0.1;
    brim.scale.set(0.92, 1, 1.05);
    group.add(brim);
    return;
  }
  const hair = mat(color);
  if (style === 'long') {
    const back = part(GEO.hairBack, hair, 0, 1.5, -0.078);
    back.scale.set(1.02, 1.65, 0.74);
    group.add(back);
  }
  const cap = part(style === 'short' ? GEO.hairShort : GEO.hairCap, hair, 0, 1.657, -0.013);
  cap.scale.set(0.97, 1.09, 1.0);
  cap.rotation.x = style === 'short' ? 0.22 : 0.3; // tipped forward: forehead shows, the back is covered
  group.add(cap);
}

/**
 * Build a person: rounded, jointed, unmistakably human. Returns the group plus the swinging
 * parts the walker animates. Options: skin, shirt, pants, hair (colour), hairStyle
 * ('hair' | 'short' | 'long' | 'hat' | 'bald'), shoe (colour), accessory ('chain' | 'belt').
 */
export function makePerson(rng, opts = {}) {
  const skin = mat(opts.skin ?? rng.pick(SKIN));
  const shirt = mat(opts.shirt ?? rng.pick(SHIRTS));
  const pants = mat(opts.pants ?? rng.pick(PANTS));
  const shoe = opts.shoe ?? rng.pick(SHOES);
  const group = new THREE.Group();

  const legL = makeLeg(pants, shoe);
  legL.position.set(-0.105, 0.86, 0);
  group.add(legL);
  const legR = makeLeg(pants, shoe);
  legR.position.set(0.105, 0.86, 0);
  group.add(legR);

  const pelvis = part(GEO.pelvis, pants, 0, 0.93, 0);
  pelvis.scale.set(1.08, 0.66, 0.74);
  group.add(pelvis);
  const torso = part(GEO.torso, shirt, 0, 1.21, 0);
  torso.scale.set(1.12, 1, 0.68); // broad shoulders, narrow waist, thinner than it is wide
  group.add(torso);
  group.add(part(GEO.shoulder, shirt, -0.27, 1.46, 0));
  group.add(part(GEO.shoulder, shirt, 0.27, 1.46, 0));

  const armL = makeArm(shirt, skin);
  armL.position.set(-0.3, 1.45, 0);
  group.add(armL);
  const armR = makeArm(shirt, skin);
  armR.position.set(0.3, 1.45, 0);
  group.add(armR);

  const head = part(GEO.head, skin, 0, 1.65, 0);
  head.scale.set(0.95, 1.08, 0.99);
  group.add(head);
  group.add(part(GEO.eye, eyeMat, -0.044, 1.665, 0.107, false));
  group.add(part(GEO.eye, eyeMat, 0.044, 1.665, 0.107, false));

  const style = opts.hairStyle ?? rng.pick(['hair', 'hair', 'short', 'short', 'hat', 'bald']);
  const hairColor = style === 'hat' ? (opts.hat ?? rng.pick(HATS)) : (opts.hair ?? rng.pick(HAIR));
  addHair(group, style, hairColor);

  if (opts.accessory === 'chain') {
    const chain = new THREE.Mesh(GEO.chain, goldMat);
    chain.position.set(0, 1.42, 0.125);
    chain.rotation.x = 0.55;
    group.add(chain);
  } else if (opts.accessory === 'belt') {
    const belt = part(GEO.belt, beltMat, 0, 0.99, 0, false);
    belt.scale.set(1.1, 1, 0.7);
    group.add(belt);
  }
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
