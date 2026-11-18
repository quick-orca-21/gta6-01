// Photo mode: the scenes behind ?shot=chase|onfoot|mission|city. Each one arranges the real
// game — Rico, the gold Vireo, the PD, the story state — and runs the real simulation forward
// for a few fixed steps, so the frame is the game itself, never a mock-up. The camera is then
// parked (main.js honours G.shotCamera) and the world freezes on the staged moment.
import { CLUB_POS, LOT_POS } from './missions.js';
import { enterCar, placePlayer } from './player.js';
import { makeCar, placeCar } from './vehicles.js';

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
  setCamera(G, camera, p.x - fx * 11.5, 4.4, p.z - fz * 11.5, p.x + fx * 9, 1.6, p.z + fz * 9);
  // Freeze the light bars mid-strobe, one red, one blue.
  G.police.forEach((unit, i) => {
    if (!unit.car.lightbar) return;
    unit.car.lightbar.red.color.setHex(i % 2 ? 0x57101d : 0xff2038);
    unit.car.lightbar.blue.color.setHex(i % 2 ? 0x2a7fff : 0x12295c);
  });
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
  runSteps(ctx, 0.8, IDLE);
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
  setCamera(G, camera, 168, 118, 318, -10, 4, 30);
}

const SCENES = { chase: stageChase, onfoot: stageOnfoot, mission: stageMission, city: stageCity };

/** Stage the named scene (any unknown name stages the chase, the cover). */
export function stageShot(name, ctx) {
  const fn = SCENES[name] ?? stageChase;
  fn(ctx);
  ctx.G.runner.update(ctx.G, 0, 0); // settle markers and HUD state for the staged frame
}
