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

// ---------- The police helicopter ----------
// One air unit backs up the ground fleet when a chase gets serious. It is part of the police
// system, not a decoration: it launches at four stars, holds a slow orbit over the player with
// its searchlight pinned to them, and leaves the sky when the heat drops. Like everything else
// here it is built from three.js primitives in the house style — rounded hull, PD livery, a
// spinning rotor with a translucent disc so the spin reads at a glance.
import { groundHeight } from './city.js';

const THREE = window.THREE;

/** The star count that puts the helicopter in the air. */
export const HELI_MIN_STARS = 4;
const HELI_ALT = 21; // cruising height over open streets — above the streetlights, below the towers
const HELI_CLEAR_ALT = 70; // height it climbs to when its station is over a building footprint
const HELI_SPAWN_DIST = 130; // how far out it enters from

const heliGlassMat = new THREE.MeshPhongMaterial({ color: 0x101722, shininess: 120, specular: 0x88aaff });
const heliDarkMat = new THREE.MeshLambertMaterial({ color: 0x14213d });
const heliPaintMat = new THREE.MeshPhongMaterial({ color: 0xe9edf4, shininess: 90, specular: 0x666677 });

/**
 * Build the helicopter: mesh, spinning rotors, blinking beacon, and the searchlight rig (a
 * translucent cone, a pool of light for the ground, and a real spotlight). Everything is added
 * to the scene but parked invisible far below the city until placeHeli or the fleet logic
 * puts it in the air. The nose points along local +z, like the cars.
 */
export function createHeli(scene) {
  const mesh = new THREE.Group();
  mesh.rotation.order = 'YXZ';

  const hull = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 14), heliPaintMat);
  hull.scale.set(1.0, 0.92, 2.1);
  hull.castShadow = true;
  mesh.add(hull);
  // The PD's dark lower hull, the cruisers' navy carried into the sky.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1.06, 18, 12), heliDarkMat);
  belly.scale.set(1.0, 0.55, 2.12);
  belly.position.y = -0.22;
  mesh.add(belly);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.88, 16, 12), heliGlassMat);
  cockpit.scale.set(0.92, 0.8, 1.0);
  cockpit.position.set(0, 0.2, 1.12);
  mesh.add(cockpit);

  // Tail boom, fin and the little rotor that keeps the nose honest.
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.32, 3.6, 10), heliPaintMat);
  boom.geometry.rotateX(-Math.PI / 2); // thin end aft
  boom.position.set(0, 0.24, -3.1);
  boom.castShadow = true;
  mesh.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.62), heliDarkMat);
  fin.position.set(0, 0.6, -4.78);
  mesh.add(fin);
  const tailRotor = new THREE.Group();
  const trA = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.17), heliDarkMat);
  const trB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 1.15), heliDarkMat);
  tailRotor.add(trA, trB);
  tailRotor.position.set(0.14, 0.6, -4.78);
  mesh.add(tailRotor);

  // Main rotor: two blade bars over a translucent disc, so it reads as spinning even in a still.
  const rotor = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), heliDarkMat);
  mast.position.y = -0.18;
  rotor.add(mast);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x1a1626 });
  const bladeA = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.05, 0.44), bladeMat);
  const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 6.6), bladeMat);
  rotor.add(bladeA, bladeB);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(3.3, 28),
    new THREE.MeshBasicMaterial({ color: 0x0c0c12, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.geometry.rotateX(-Math.PI / 2);
  disc.position.y = -0.03;
  rotor.add(disc);
  rotor.position.y = 1.18;
  mesh.add(rotor);

  // Skids on struts, so it could land if it ever wanted to.
  const skidMat = new THREE.MeshLambertMaterial({ color: 0x2a2438 });
  for (const sx of [-0.85, 0.85]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.7, 8), skidMat);
    skid.geometry = skid.geometry.clone();
    skid.geometry.rotateX(Math.PI / 2);
    skid.position.set(sx, -1.08, 0.15);
    mesh.add(skid);
    for (const sz of [-0.75, 0.85]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.6, 0.09), skidMat);
      strut.position.set(sx * 0.82, -0.78, sz);
      mesh.add(strut);
    }
  }

  // The anti-collision beacon on the fin, blinked by the update.
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0x57101d });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), beaconMat);
  beacon.position.set(0, 1.14, -4.78);
  mesh.add(beacon);

  // The searchlight lamp under the nose; the mount is where the beam is measured from.
  const lampMount = new THREE.Object3D();
  lampMount.position.set(0, -0.88, 1.15);
  mesh.add(lampMount);
  const lampBox = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.36), heliDarkMat);
  lampBox.position.copy(lampMount.position);
  mesh.add(lampBox);
  const lampFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.17, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4 }),
  );
  lampFace.geometry.rotateX(Math.PI / 2); // face down
  lampFace.position.set(0, -1.0, 1.15);
  mesh.add(lampFace);

  // The beam itself: a cone stretched from the lamp to the ground, wide end down, plus the
  // bright pool where it lands and a real spotlight so the light actually falls on the car.
  const coneGeo = new THREE.CylinderGeometry(0.35, 3.6, 1, 20, 1, true);
  coneGeo.translate(0, -0.5, 0);
  coneGeo.rotateX(-Math.PI / 2); // now it runs from the origin out along +z, wide end far
  const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    color: 0xffedb5, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  cone.renderOrder = 6;
  cone.frustumCulled = false;
  scene.add(cone);
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe9b8, transparent: true, opacity: 0.32,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  pool.geometry.rotateX(-Math.PI / 2);
  pool.renderOrder = 5;
  scene.add(pool);
  const spot = new THREE.SpotLight(0xffe2a0, 1.35, 130, 0.36, 0.55, 0.5);
  scene.add(spot);
  scene.add(spot.target);

  mesh.position.set(0, -60, 0);
  mesh.visible = false;
  cone.visible = false;
  pool.visible = false;
  spot.visible = false;
  scene.add(mesh);

  return {
    mesh, rotor, tailRotor, beaconMat, cone, pool, spot, lampMount,
    heading: 0, alt: HELI_ALT, leaving: false, departX: 0, departZ: 0, lightOn: false,
  };
}

/** Get the helicopter, building it on first need. Kept on G so photo mode can stage it too. */
export function ensureHeli(G, scene) {
  if (!G.heli) G.heli = createHeli(scene);
  return G.heli;
}

/** Put the helicopter at a spot in the sky, facing a heading, rotors turning, light ready. */
export function placeHeli(heli, x, y, z, heading) {
  heli.mesh.position.set(x, y, z);
  heli.alt = y;
  heli.heading = heading;
  heli.mesh.rotation.set(0, heading, 0);
  heli.leaving = false;
  heli.mesh.visible = true;
}

const _lampPos = new THREE.Vector3();

/** Aim the searchlight rig at a ground point: cone from the lamp, pool on the ground, spot on it. */
export function aimHeliLight(heli, tx, tz) {
  heli.mesh.updateMatrixWorld(true);
  heli.lampMount.getWorldPosition(_lampPos);
  const ty = groundHeight(tx, tz);
  heli.cone.position.copy(_lampPos);
  heli.cone.lookAt(tx, ty, tz);
  heli.cone.scale.set(1, 1, Math.max(1, _lampPos.distanceTo(new THREE.Vector3(tx, ty, tz))));
  heli.pool.position.set(tx, ty + 0.07, tz);
  heli.spot.position.copy(_lampPos);
  heli.spot.target.position.set(tx, 1, tz);
  heli.cone.visible = true;
  heli.pool.visible = true;
  heli.spot.visible = true;
  heli.lightOn = true;
}

function heliLightOff(heli) {
  heli.cone.visible = false;
  heli.pool.visible = false;
  heli.spot.visible = false;
  heli.lightOn = false;
}

function removeHeli(heli, scene) {
  scene.remove(heli.mesh);
  scene.remove(heli.cone);
  scene.remove(heli.pool);
  scene.remove(heli.spot);
  scene.remove(heli.spot.target);
}

/**
 * Fly the helicopter for one frame. It launches when the wanted level reaches HELI_MIN_STARS,
 * holds a slow orbit over the target with the searchlight on them, climbs over the downtown
 * rooftops when its station crosses a building footprint, and withdraws — light off, climbing
 * away — when the heat drops, despawning once it is far off. Returns the helicopter, or null
 * when there is none in the sky. `target` is the player's position {x, z}.
 */
export function updateHeli(heli, scene, dt, stars, target, colliders, time) {
  if (!heli) {
    if (stars < HELI_MIN_STARS) return null;
    heli = createHeli(scene);
    // Enter from low over the water side of the sky, nose already on the chase.
    const away = Math.atan2(target.x, target.z + 0.001);
    placeHeli(
      heli,
      target.x + Math.sin(away) * HELI_SPAWN_DIST,
      34,
      target.z + Math.cos(away) * HELI_SPAWN_DIST,
      Math.atan2(-Math.sin(away), -Math.cos(away)),
    );
  }

  const p = heli.mesh.position;
  if (stars >= HELI_MIN_STARS) heli.leaving = false;
  else if (!heli.leaving) {
    // Heat's gone: kill the light, climb, and head out the way is clearest — away from the target.
    heli.leaving = true;
    heliLightOff(heli);
    const dx = p.x - target.x;
    const dz = p.z - target.z;
    const len = Math.hypot(dx, dz) || 1;
    heli.departX = target.x + (dx / len) * 320;
    heli.departZ = target.z + (dz / len) * 320;
  }

  // Where it wants to be this frame.
  let ax;
  let az;
  let altWant;
  if (heli.leaving) {
    ax = heli.departX;
    az = heli.departZ;
    altWant = 58;
  } else {
    const ang = time * 0.22; // a slow patrol orbit around the player
    ax = target.x + Math.sin(ang) * 11;
    az = target.z + Math.cos(ang) * 11;
    altWant = HELI_ALT;
    for (const c of colliders) {
      if (ax > c.minX - 3 && ax < c.maxX + 3 && az > c.minZ - 3 && az < c.maxZ + 3) {
        altWant = HELI_CLEAR_ALT; // over a rooftop: climb above the tallest tower instead of through it
        break;
      }
    }
  }

  // Move: an exponential approach with a speed cap, so it settles onto its station without
  // overshoot yet crosses the sky at a believable pace instead of teleporting to it.
  const k = 1 - Math.exp(-2.1 * dt);
  let mx = (ax - p.x) * k;
  let mz = (az - p.z) * k;
  const maxStep = (heli.leaving ? 55 : 40) * dt;
  const stepLen = Math.hypot(mx, mz);
  if (stepLen > maxStep) {
    mx *= maxStep / stepLen;
    mz *= maxStep / stepLen;
  }
  const vx = mx / Math.max(dt, 0.001);
  const vz = mz / Math.max(dt, 0.001);
  p.x += mx;
  p.z += mz;
  heli.alt += (altWant - heli.alt) * (1 - Math.exp(-1.1 * dt));
  p.y = heli.alt + Math.sin(time * 1.7) * 0.35;

  // Face the travel direction; when it is holding still, face the player. Bank into sideways
  // drift and dip the nose under forward speed, the way the real thing leans into a chase.
  const speed = Math.hypot(vx, vz);
  const fx = Math.sin(heli.heading);
  const fz = Math.cos(heli.heading);
  const fwdVel = vx * fx + vz * fz;
  const latVel = vx * -fz + vz * fx;
  const wantHeading = speed > 3
    ? Math.atan2(vx, vz)
    : Math.atan2(target.x - p.x, target.z - p.z);
  heli.heading += clamp(angleDelta(heli.heading, wantHeading), -1.7 * dt, 1.7 * dt);
  heli.mesh.rotation.y = heli.heading;
  heli.mesh.rotation.x = clamp(fwdVel * 0.013, -0.3, 0.34);
  heli.mesh.rotation.z = clamp(-latVel * 0.028, -0.48, 0.48);

  heli.rotor.rotation.y -= dt * 26;
  heli.tailRotor.rotation.x += dt * 31;
  heli.beaconMat.color.setHex(time % 0.9 < 0.14 ? 0xff2222 : 0x57101d);

  if (!heli.leaving) aimHeliLight(heli, target.x, target.z);

  if (heli.leaving && dist2d(p.x, p.z, target.x, target.z) > 175) {
    removeHeli(heli, scene);
    return null;
  }
  return heli;
}
