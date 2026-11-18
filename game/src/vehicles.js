// Cars: one low-poly factory builds every vehicle in Palm City (civilian, sports and the Palm
// City PD interceptor), plus the shared arcade physics every driver — player, traffic, police —
// moves by. A car is a plain object: its mesh, heading, speed, health and kind.
import { CAR, GRID, ROAD_HALF, ROAD_STEP, WATER_Z } from './config.js';
import { collideBuildings } from './city.js';
import { clamp } from './rng.js';

const THREE = window.THREE;

export const CAR_COLORS = [0xff5f6d, 0xffb03a, 0x37e0ff, 0x7dff8a, 0xe08aff, 0xf2f2f2, 0x3a6ff2, 0xff7847, 0x20c9a6, 0xc0c6d4];

const glassMat = new THREE.MeshPhongMaterial({ color: 0x101722, shininess: 120, specular: 0x88aaff });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x14121a });
const chromeMat = new THREE.MeshPhongMaterial({ color: 0xb9c2d4, shininess: 140 });

function wheel() {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.32, 12), tyreMat);
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  g.add(tyre);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 8), chromeMat);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

/**
 * Build a car mesh. Options: color, sports (lower, spoiler), police (PD livery + light bar).
 * The car's nose points along its local +z; the returned object carries everything physics needs.
 */
export function makeCar(scene, opts = {}) {
  const police = !!opts.police;
  const sports = !!opts.sports;
  const color = police ? 0xe9edf4 : (opts.color ?? 0xff5f6d);
  const paint = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x666677 });
  const mesh = new THREE.Group();

  const bodyH = sports ? 0.5 : 0.62;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, bodyH, 4.3), paint);
  body.position.y = 0.42 + bodyH / 2;
  body.castShadow = true;
  mesh.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.7), paint);
  nose.position.set(0, 0.62, 2.25);
  nose.castShadow = true;
  mesh.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.52, 2.0), glassMat);
  cabin.position.set(0, 0.42 + bodyH + 0.24, -0.25);
  cabin.castShadow = true;
  mesh.add(cabin);
  if (sports) {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.5), paint);
    spoiler.position.set(0, 1.12, -2.0);
    mesh.add(spoiler);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), tyreMat);
    strut.position.set(0, 0.95, -2.0);
    mesh.add(strut);
  }
  if (police) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.3, 2.6), new THREE.MeshLambertMaterial({ color: 0x14213d }));
    stripe.position.set(0, 0.72, -0.2);
    mesh.add(stripe);
  }

  // Lights: emissive lamps front and rear.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c4 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  for (const sx of [-0.62, 0.62]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), headMat);
    head.position.set(sx, 0.72, 2.62);
    mesh.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.08), tailMat);
    tail.position.set(sx, 0.78, -2.17);
    mesh.add(tail);
  }

  let lightbar = null;
  if (police) {
    const bar = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.44), tyreMat);
    bar.add(base);
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff2038 });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x2a7fff });
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.4), redMat);
    red.position.set(-0.38, 0.14, 0);
    bar.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.2, 0.4), blueMat);
    blue.position.set(0.38, 0.14, 0);
    bar.add(blue);
    bar.position.set(0, 0.42 + bodyH + 0.55, -0.25);
    mesh.add(bar);
    lightbar = { red: redMat, blue: blueMat };
  }

  const wheels = {};
  const wheelPos = { fl: [-0.98, 1.45], fr: [0.98, 1.45], rl: [-0.98, -1.45], rr: [0.98, -1.45] };
  for (const key of Object.keys(wheelPos)) {
    const w = wheel();
    w.position.set(wheelPos[key][0], 0.44, wheelPos[key][1]);
    mesh.add(w);
    wheels[key] = w;
  }

  scene.add(mesh);
  return {
    mesh,
    wheels,
    lightbar,
    heading: opts.heading ?? 0,
    speed: 0,
    health: CAR.maxHealth,
    kind: opts.kind ?? 'parked',
    sports,
    police,
    steerVis: 0,
    dead: false,
  };
}

/** Place a car in the world. */
export function placeCar(car, x, z, heading) {
  car.mesh.position.set(x, 0, z);
  car.heading = heading;
  car.mesh.rotation.y = heading;
}

/**
 * Advance one car by its driver's input {throttle, steer, handbrake}. Handles building collision
 * and the water's edge. Returns the impact speed if it struck a building this step, else 0.
 */
export function stepCar(car, input, dt, colliders) {
  const accel = input.throttle * CAR.accel;
  car.speed += accel * dt;
  // Drag and rolling resistance; handbrake kills speed fast and loosens the turn.
  car.speed -= car.speed * CAR.drag * dt;
  if (input.handbrake) car.speed -= car.speed * 2.4 * dt;
  if (!input.throttle && Math.abs(car.speed) < 0.4) car.speed = 0;
  car.speed = clamp(car.speed, -CAR.reverseMax, car.sports ? 44 : 38);

  const speedFactor = clamp(Math.abs(car.speed) / 7, 0, 1);
  const turnRate = CAR.gripTurn * (input.handbrake ? 1.5 : 1);
  car.heading += input.steer * turnRate * speedFactor * dt * (car.speed < 0 ? -1 : 1);
  car.steerVis = input.steer;

  const p = car.mesh.position;
  p.x += Math.sin(car.heading) * car.speed * dt;
  p.z += Math.cos(car.heading) * car.speed * dt;

  let impact = 0;
  const before = Math.abs(car.speed);
  const fixed = collideBuildings(colliders, p.x, p.z, CAR.radius);
  if (fixed.x !== p.x || fixed.z !== p.z) {
    p.x = fixed.x;
    p.z = fixed.z;
    impact = before;
    car.speed = -car.speed * 0.28;
  }
  // The sea is a wall of its own; the avenues end at the sand.
  if (p.z > WATER_Z + 4) {
    p.z = WATER_Z + 4;
    impact = Math.max(impact, before);
    car.speed = -car.speed * 0.2;
  }
  p.x = clamp(p.x, -330, 330);
  p.z = Math.max(p.z, -300);

  car.mesh.rotation.y = car.heading;
  // Wheel spin and front-wheel steer for the eye.
  const spin = (car.speed * dt) / 0.44;
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    car.wheels[key].children[0].rotation.x += spin;
    car.wheels[key].children[1].rotation.x += spin;
  }
  car.wheels.fl.rotation.y = car.steerVis * 0.42;
  car.wheels.fr.rotation.y = car.steerVis * 0.42;
  return impact;
}

/**
 * Resolve overlaps between every pair of cars: push them apart, trade a little speed, and report
 * the hardest impact (with the other car) through the callback for damage and sound.
 */
export function collideCars(cars, onImpact) {
  for (let i = 0; i < cars.length; i += 1) {
    const a = cars[i];
    if (a.dead) continue;
    for (let j = i + 1; j < cars.length; j += 1) {
      const b = cars[j];
      if (b.dead) continue;
      const pa = a.mesh.position;
      const pb = b.mesh.position;
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const min = CAR.radius + CAR.radius - 0.7;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        pa.x -= nx * push;
        pa.z -= nz * push;
        pb.x += nx * push;
        pb.z += nz * push;
        const rel = Math.abs(a.speed - b.speed) + Math.min(Math.abs(a.speed), Math.abs(b.speed)) * 0.4;
        if (rel > 3) {
          const avg = (a.speed + b.speed) / 2;
          a.speed = avg + (a.speed - avg) * 0.4;
          b.speed = avg + (b.speed - avg) * 0.4;
          if (onImpact) onImpact(a, b, rel);
        }
      }
    }
  }
}

/** A point on a road near the curb, for parked cars: {x, z, heading} aligned with the street. */
export function curbSpot(rng) {
  const vertical = rng.chance(0.5);
  const road = rng.int(-GRID, GRID) * ROAD_STEP;
  const along = rng.range(-GRID * ROAD_STEP, GRID * ROAD_STEP);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (ROAD_HALF - 1.6) * side;
  if (vertical) return { x: road + off, z: along, heading: side > 0 ? 0 : Math.PI };
  return { x: along, z: road + off, heading: side > 0 ? Math.PI / 2 : -Math.PI / 2 };
}

/** Spawn the city's parked cars (stealable) and return them. */
export function spawnParkedCars(scene, rng, count) {
  const cars = [];
  for (let i = 0; i < count; i += 1) {
    const spot = curbSpot(rng);
    const car = makeCar(scene, { color: rng.pick(CAR_COLORS), sports: rng.chance(0.22), kind: 'parked' });
    placeCar(car, spot.x, spot.z, spot.heading);
    cars.push(car);
  }
  return cars;
}
