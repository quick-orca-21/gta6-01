// Photo mode: the scenes behind ?shot=chase|onfoot|mission|city. Each one arranges the real
// game — Rico, the gold Vireo, the PD, the story state — and runs the real simulation forward
// for a few fixed steps, so the frame is the game itself, never a mock-up. The camera is then
// parked (main.js honours G.shotCamera) and the world freezes on the staged moment.
import { groundHeight } from './city.js';
import { CLUB_POS, LOT_POS } from './missions.js';
import { enterCar, placePlayer } from './player.js';
import { makeCar, placeCar } from './vehicles.js';
import { aimHeliLight, ensureHeli, placeHeli } from './police.js';

const THREE = window.THREE;
const IDLE = { move: { x: 0, z: 0 }, run: false, throttle: 0, steer: 0, handbrake: false };
const DRIVE = { move: { x: 0, z: 0 }, run: false, throttle: 0.62, steer: 0, handbrake: false };

function runSteps(ctx, seconds, input) {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i += 1) ctx.stepWorld(1 / 30, input);
}

function setCamera(G, camera, px, py, pz, lx, ly, lz) {
  G.shotCamera = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) };
  camera.position.copy(G.shotCamera.pos);
  camera.lookAt(G.shotCamera.look);
}

/** The cover: a three-star chase at sunset, mid-mission, every HUD element alive. */
function stageChase(ctx) {
  const { G, camera } = ctx;
  G.cash = 640;
  G.runner.index = 1;
  G.runner.stepIndex = 2; // NIGHT RUN, the delivery leg
  G.runner.state = 'active';
  G.runner.timeLeft = 87;
  const car = G.runner.ensureTargetCar(ctx.scene);
  placeCar(car, -46, 3.6, Math.PI / 2); // eastbound on the central avenue
  car.speed = 21;
  enterCar(G.player, car);
  G.player.x = -46;
  G.player.z = 3.6;
  // Two cruisers already on his tail; the fleet logic will call in the rest.
  for (const [gap, lane] of [[13, 2.2], [21, 5.2]]) {
    const cop = makeCar(ctx.scene, { police: true, kind: 'police' });
    placeCar(cop, -46 - gap, lane, Math.PI / 2);
    cop.speed = 23;
    G.police.push({ car: cop, stuckT: 0 });
  }
  G.setHeat(3);
  runSteps(ctx, 2.2, DRIVE);
  const p = car.mesh.position;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  // Pull the two nearest cruisers into the frame — one alongside Rico's door, one on his
  // rear quarter — so the cover shows the chase itself, not just its minimap blips.
  const rx = -fz; // the heading's right-hand side on the ground plane
  const rz = fx;
  const [lead, tail] = G.police;
  if (lead) {
    placeCar(lead.car, p.x - fx * 1.5 + rx * 3.6, p.z - fz * 1.5 + rz * 3.6, car.heading);
    lead.car.speed = car.speed;
  }
  if (tail) {
    // The second unit cuts in ahead of Rico, angled across his lane — a pincer, not a tail.
    placeCar(tail.car, p.x + fx * 19 - rx * 3.4, p.z + fz * 19 - rz * 3.4, car.heading - 0.38);
    tail.car.speed = car.speed;
  }
  setCamera(G, camera, p.x - fx * 12.5 - rx * 2.6, 4.6, p.z - fz * 12.5 - rz * 2.6, p.x + fx * 8, 1.6, p.z + fz * 8);
  // Freeze the light bars mid-strobe, one red, one blue.
  G.police.forEach((unit, i) => {
    if (!unit.car.lightbar) return;
    unit.car.lightbar.red.color.setHex(i % 2 ? 0x57101d : 0xff2038);
    unit.car.lightbar.blue.color.setHex(i % 2 ? 0x2a7fff : 0x12295c);
  });
  // At five stars the air unit is on him too: park the helicopter up the road and off his
  // left shoulder, inside the camera's upper frame, with its searchlight cone on the Vireo.
  const heli = ensureHeli(G, ctx.scene);
  const hx = p.x + fx * 13 - rx * 5.5;
  const hz = p.z + fz * 13 - rz * 5.5;
  placeHeli(heli, hx, 8.8, hz, Math.atan2(p.x - hx, p.z - hz));
  aimHeliLight(heli, p.x, p.z);
  heli.rotor.rotation.y = 0.7; // a pleasing blade angle for the still
  heli.beaconMat.color.setHex(0xff2222); // caught mid-blink
}

/** On foot in the neon downtown, pedestrians and traffic all around. */
function stageOnfoot(ctx) {
  const { G, camera } = ctx;
  G.cash = 240;
  G.runner.index = 0;
  G.runner.stepIndex = 1; // FIRST WHEELS, the steal
  G.runner.state = 'active';
  G.runner.ensureTargetCar(ctx.scene);
  placePlayer(G.player, 12.5, 12, -2.35);
  // Route two civilian cars through the intersection beside Rico, on their proper
  // right-hand lanes, so the street reads as live traffic and not an empty set.
  const [carA, carB] = G.traffic;
  if (carA) { // eastbound along the z = 0 avenue
    carA.i = -1; carA.j = 0; carA.dir = { di: 1, dj: 0 };
    placeCar(carA.car, -34, 3.6, Math.PI / 2);
    carA.car.speed = 11;
  }
  if (carB) { // southbound down the x = 0 avenue
    carB.i = 0; carB.j = -1; carB.dir = { di: 0, dj: 1 };
    placeCar(carB.car, -3.6, -30, 0);
    carB.car.speed = 11;
  }
  runSteps(ctx, 2.4, IDLE);
  // The crowd wanders where it will, so walk three residents into the frame around Rico —
  // the shot has to show street life, not an empty pavement. The world freezes in shot
  // mode, so their meshes are placed directly.
  const spots = [[10.7, 14.9, 2.7], [15.9, 14.4, -1.8], [13.6, 18.1, 0.7]];
  let placed = 0;
  for (const ped of G.crowd) {
    if (placed >= spots.length) break;
    if (ped.state === 'down') continue;
    const [x, z, heading] = spots[placed];
    placed += 1;
    ped.x = x;
    ped.z = z;
    ped.heading = heading;
    ped.body.group.position.set(x, groundHeight(x, z), z);
    ped.body.group.rotation.y = heading;
  }
  setCamera(G, camera, 19.5, 2.7, 19, 11.4, 1.5, 11);
}

/** A mission moment: Rico talks with Mara outside the Harborlight Garage. */
function stageMission(ctx) {
  const { G, camera } = ctx;
  G.cash = 40;
  G.runner.index = 0;
  G.runner.stepIndex = 0;
  G.runner.state = 'active';
  placePlayer(G.player, 129.6, 129.8, 0.59); // facing Mara
  G.runner.dialogueQueue = [...G.runner.mission.intro];
  G.runner.state = 'dialogue';
  G.runner.nextDialogue(G);
  setCamera(G, camera, 123.6, 2.5, 123.2, 134, 1.7, 135);
}

/** The wide shot: the whole city, the beach and the skyline at dusk. */
function stageCity(ctx) {
  const { G, camera } = ctx;
  G.cash = 2450;
  G.runner.index = 3; // story complete: free roam
  G.runner.state = 'done';
  placePlayer(G.player, 40, 150, 2.6);
  runSteps(ctx, 1.2, IDLE);
  setCamera(G, camera, 150, 88, 272, -10, 4, 10);
}

const SCENES = { chase: stageChase, onfoot: stageOnfoot, mission: stageMission, city: stageCity };

/** Stage the named scene (any unknown name stages the chase, the cover). */
export function stageShot(name, ctx) {
  const fn = SCENES[name] ?? stageChase;
  fn(ctx);
  ctx.G.runner.update(ctx.G, 0, 0); // settle markers and HUD state for the staged frame
}
