// Palm City Heat — the game itself. This module builds the world from the other modules, owns
// the game state (cash, heat, health, story progress), runs the frame loop, and wires crime to
// consequence: what the police see, Rico pays for. It also owns the camera, the save in
// localStorage, and the ?shot= photo mode the screenshots are staged with.
import { HEAT, MARA_POS, START_POS } from './config.js';
import { buildCity } from './city.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { MissionRunner } from './missions.js';
import { animatePerson, createCrowd, knockDown, scareCrowd, updateCrowd } from './pedestrians.js';
import { flashLights, nearestPolice, updatePolice, updatePoliceFleet } from './police.js';
import { createPlayer, enterCar, exitCar, nearestEnterableCar, placePlayer, tryPunch, tryShoot, updatePlayerFoot } from './player.js';
import { createTraffic, recycleTraffic, updateTraffic } from './traffic.js';
import { collideCars, curbSpot, spawnParkedCars, stepCar } from './vehicles.js';
import { clamp, dist2d, seededRandom } from './rng.js';
import { stageShot } from './shots.js';

const THREE = window.THREE;
const SAVE_KEY = 'palmCityHeat.save.v1';

// ---------- Renderer, scene, camera ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(START_POS.x - 8, 4, START_POS.z + 10);
camera.lookAt(START_POS.x, 1.5, START_POS.z);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- World ----------
const world = buildCity(scene);
const rng = seededRandom(987654321);
const fx = createEffects(scene, world.glowTexture);
const audio = createAudio();
const hud = createHud();

const player = createPlayer(scene, rng);
placePlayer(player, START_POS.x, START_POS.z, -2.2);
const parkedCars = spawnParkedCars(scene, rng, 16);
const traffic = createTraffic(scene, 11);
const crowd = createCrowd(scene, rng, 26);
const police = [];

// ---------- Game state ----------
const G = {
  scene,
  player,
  traffic,
  police,
  crowd,
  runner: null,
  colliders: world.colliders,
  audio,
  cash: 40,
  heat: 0,
  time: 0,
  state: 'title', // title | playing | paused | ended
  endKind: null, // wasted | busted
  sightT: 0, // seconds since the police last had eyes on Rico
  bustT: 0,
  camYawOff: 0,
  camPitch: 0,
  shotMode: null,
  addCash(n) {
    G.cash = Math.max(0, G.cash + n);
  },
  setHeat(n) {
    G.heat = clamp(n, 0, HEAT.max);
  },
  addHeat(n) {
    G.setHeat(G.heat + n);
  },
  /** A crime only raises heat when the PD is close enough to know — or it is too loud to miss. */
  commitCrime(amount, loud = false) {
    const focus = focusPos();
    if (loud || nearestPolice(police, focus.x, focus.z) < 58) {
      G.addHeat(amount);
      return true;
    }
    return false;
  },
  toast(msg) { hud.toast(msg); },
  banner(big, sub) { hud.banner(big, sub); },
  randomCurbSpot() { return curbSpot(liveRng); },
  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: G.cash,
        missionIndex: G.runner ? G.runner.index : 0,
        hasPistol: player.hasPistol,
        x: player.x,
        z: player.z,
      }));
    } catch { /* storage may be unavailable; the game goes on */ }
  },
};
const liveRng = seededRandom((Math.random() * 1e9) | 0);
G.runner = new MissionRunner(scene, rng);

function focusPos() {
  if (player.mode === 'car' && player.car) return player.car.mesh.position;
  return player;
}

function allCars() {
  const cars = [...parkedCars];
  for (const t of traffic) if (!t.retired) cars.push(t.car);
  for (const u of police) cars.push(u.car);
  if (G.runner.targetCar && !cars.includes(G.runner.targetCar)) cars.push(G.runner.targetCar);
  return cars;
}

function stars() {
  return G.heat <= 0.01 ? 0 : Math.ceil(G.heat - 0.001);
}

// ---------- Input ----------
const keys = new Set();
let mouseDown = false;
let lastMouse = { x: 0, y: 0 };
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  audio.init();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyM') {
    const muted = audio.toggleMute();
    hud.toast(muted ? 'Sound off' : 'Sound on');
  }
  if ((e.code === 'KeyP' || e.code === 'Escape') && (G.state === 'playing' || G.state === 'paused')) {
    togglePause();
  }
  if (e.code === 'Enter' && G.runner.dialogue) G.runner.nextDialogue(G);
  if (G.state === 'playing') {
    if (e.code === 'KeyE') toggleVehicle();
    if (e.code === 'KeyF') doPunch();
    if (e.code === 'KeyG') doShoot();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', (e) => {
  mouseDown = true;
  lastMouse = { x: e.clientX, y: e.clientY };
  audio.init();
  if (G.state === 'playing' && player.mode === 'foot') {
    if (e.button === 0) doPunch();
    if (e.button === 2) doShoot();
  }
});
window.addEventListener('mouseup', () => { mouseDown = false; });
window.addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  G.camYawOff -= (e.clientX - lastMouse.x) * 0.005;
  G.camPitch = clamp(G.camPitch + (e.clientY - lastMouse.y) * 0.003, -0.12, 0.5);
  lastMouse = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function keyAxis(neg, pos) {
  return (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
}

// ---------- Actions ----------
function toggleVehicle() {
  if (player.mode === 'car') {
    const car = player.car;
    exitCar(player, world.colliders);
    if (car) car.speed = 0;
    audio.setEngine(false, 0);
    return;
  }
  const car = nearestEnterableCar(player, allCars());
  if (!car) return;
  const wasParked = car.kind === 'parked';
  const trafficEntry = traffic.find((t) => t.car === car);
  if (trafficEntry) trafficEntry.retired = true; // a stolen traffic car leaves the fleet
  enterCar(player, car);
  if (wasParked || trafficEntry) {
    if (G.commitCrime(HEAT.steal)) hud.toast('The PD saw that — you are hot');
    else hud.toast(wasParked ? 'Wheels acquired. Nobody saw a thing' : 'Carjacked! Nobody saw a thing');
  }
  audio.click();
}

function doPunch() {
  if (player.mode !== 'foot') return;
  const hit = tryPunch(player, crowd, allCars());
  if (hit.kind === 'cooldown') return;
  if (hit.kind === 'ped') {
    audio.punch();
    scareCrowd(crowd, player.x, player.z, 14);
    if (G.commitCrime(HEAT.punchPed)) hud.toast('Assault — the PD is coming');
  } else if (hit.kind === 'car') {
    audio.crash(4);
    fx.sparks(player.x + Math.sin(player.heading), 1, player.z + Math.cos(player.heading), 6);
    G.commitCrime(HEAT.crash);
  } else {
    audio.dryFire();
  }
}

function doShoot() {
  if (player.mode !== 'foot') return;
  if (!player.hasPistol) {
    if (player.shootCd <= 0) {
      hud.toast('No gun yet — Mara arms you after the first job');
      player.shootCd = 0.5;
    }
    return;
  }
  const hit = tryShoot(player, crowd, allCars());
  if (hit.kind === 'cooldown') return;
  audio.shot();
  const gx = player.x + Math.sin(player.heading) * 0.9;
  const gz = player.z + Math.cos(player.heading) * 0.9;
  fx.flash(gx, 1.45, gz);
  scareCrowd(crowd, player.x, player.z, 30);
  if (hit.kind === 'ped') {
    G.commitCrime(HEAT.shootPed, true);
    hud.toast('Shots fired — the whole city heard that');
  } else if (hit.kind === 'car') {
    const p = hit.car.mesh.position;
    fx.sparks(p.x, 1, p.z, 12);
    hit.car.health -= 9;
    G.commitCrime(HEAT.shootCar, true);
  } else {
    G.commitCrime(HEAT.shootCar * 0.5, true);
  }
}

// ---------- Consequences ----------
function damageCar(car, amount, byPlayer) {
  if (car.dead || amount <= 0) return;
  car.health -= amount;
  if (car.health <= 0) {
    car.health = 0;
    car.dead = true;
    car.speed = 0;
    fx.smoke(car.mesh.position.x, 1.4, car.mesh.position.z, 14);
    if (car === player.car) {
      hud.toast('Your ride is wrecked');
      exitCar(player, world.colliders);
      audio.setEngine(false, 0);
    } else if (byPlayer) {
      hud.toast('Vehicle destroyed');
    }
  }
}

function onWallCrash(car, impact) {
  if (impact < 8) return;
  const p = car.mesh.position;
  fx.sparks(p.x, 0.9, p.z, Math.min(18, impact));
  damageCar(car, (impact - 7) * 0.85, car === player.car);
  if (car === player.car) {
    fx.addShake(impact / 26);
    audio.crash(impact);
    if (impact > 21) player.health -= (impact - 21) * 0.55;
  } else if (dist2d(p.x, p.z, player.x, player.z) < 30) {
    audio.crash(impact * 0.5);
  }
}

function onCarImpact(a, b, rel) {
  const dmg = (rel - 4) * 1.15;
  damageCar(a, dmg, b === player.car);
  damageCar(b, dmg, a === player.car);
  const p = a.mesh.position;
  fx.sparks(p.x, 0.9, p.z, Math.min(16, rel * 1.4));
  if (a === player.car || b === player.car) {
    fx.addShake(rel / 30);
    audio.crash(rel);
    if (a.police || b.police) G.commitCrime(HEAT.hitCop);
    if (rel > 19) player.health -= (rel - 19) * 0.5;
  }
}

/** Cars versus people: any car moving fast enough knocks down whoever it touches. */
function carPeopleCollisions() {
  const cars = allCars();
  for (const car of cars) {
    if (car.dead || Math.abs(car.speed) < 5) continue;
    const p = car.mesh.position;
    for (const ped of crowd) {
      if (ped.state === 'down') continue;
      if (dist2d(p.x, p.z, ped.x, ped.z) < 2.0) {
        if (knockDown(ped)) {
          fx.smoke(ped.x, 0.6, ped.z, 3);
          if (car.driver === 'player') {
            audio.crash(7);
            fx.addShake(0.3);
            if (G.commitCrime(HEAT.runOver)) hud.toast('You ran someone down — the PD is coming');
          }
        }
      }
    }
    // Rico himself, when he is on foot in the road.
    if (player.mode === 'foot' && car !== player.car && player.deadT <= 0) {
      if (dist2d(p.x, p.z, player.x, player.z) < 2.2) {
        player.health -= 20;
        player.deadT = 1.1;
        fx.addShake(0.7);
        audio.crash(10);
        hud.toast('You got clipped by a car');
      }
    }
  }
}

// ---------- Camera ----------
const camPos = new THREE.Vector3(START_POS.x - 8, 4, START_POS.z + 10);
function updateCamera(dt) {
  if (G.shotCamera) {
    camera.position.copy(G.shotCamera.pos);
    camera.lookAt(G.shotCamera.look);
    return;
  }
  const focus = focusPos();
  const inCar = player.mode === 'car';
  const heading = inCar ? player.car.heading : player.heading;
  if (!mouseDown) G.camYawOff *= Math.pow(0.4, dt); // drift back behind Rico
  const yaw = heading + G.camYawOff;
  const dist = (inCar ? 10.5 : 7) + G.camPitch * 5;
  const height = (inCar ? 3.9 : 2.9) + G.camPitch * 7;
  const tx = focus.x - Math.sin(yaw) * dist;
  const tz = focus.z - Math.cos(yaw) * dist;
  const k = 1 - Math.exp(-(inCar ? 7 : 10) * dt);
  camPos.x += (tx - camPos.x) * k;
  camPos.z += (tz - camPos.z) * k;
  camPos.y += (height + 0.4 - camPos.y) * k;
  const shake = fx.shakeOffset();
  camera.position.set(camPos.x + shake.x, camPos.y + shake.y, camPos.z);
  camera.lookAt(focus.x + Math.sin(yaw) * 5, 1.7, focus.z + Math.cos(yaw) * 5);
}

// ---------- End states ----------
function endGame(kind) {
  G.state = 'ended';
  G.endKind = kind;
  audio.setEngine(false, 0);
  audio.setSiren(false, 0);
  audio.sting();
  const title = document.getElementById('end-title');
  title.textContent = kind === 'wasted' ? 'WASTED' : 'BUSTED';
  title.className = kind === 'busted' ? 'busted' : '';
  document.getElementById('end-sub').textContent = kind === 'wasted'
    ? 'St. Brisa Hospital patches you up and sends the bill to your pride.'
    : 'The Palm City PD thanks you for your cooperation.';
  document.getElementById('end-screen').classList.remove('hidden');
  G.saveGame();
}

function respawn() {
  const fine = Math.min(G.cash, 120);
  G.cash -= fine;
  G.setHeat(0);
  player.health = 100;
  player.deadT = 0;
  if (player.mode === 'car') exitCar(player, world.colliders);
  for (let i = police.length - 1; i >= 0; i -= 1) scene.remove(police[i].car.mesh);
  police.length = 0;
  placePlayer(player, -140, -132, 0.8);
  document.getElementById('end-screen').classList.add('hidden');
  G.state = 'playing';
  hud.toast(fine > 0 ? `Released — $${fine} in fines and fees` : 'Released — they kept the change');
  G.saveGame();
}

// ---------- Pause & menus ----------
function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
    document.getElementById('pause-stats').textContent =
      `Cash $${G.cash} · ${G.runner.mission ? G.runner.mission.title : 'Story complete'} · ${stars()} wanted star${stars() === 1 ? '' : 's'}`;
    document.getElementById('pause-screen').classList.remove('hidden');
    audio.setEngine(false, 0);
    audio.setSiren(false, 0);
    G.saveGame();
  } else if (G.state === 'paused') {
    G.state = 'playing';
    document.getElementById('pause-screen').classList.add('hidden');
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function startGame(useSave) {
  audio.init();
  document.getElementById('start-screen').classList.add('hidden');
  hud.show();
  G.state = 'playing';
  if (useSave) {
    const save = loadSave();
    if (save) {
      G.cash = save.cash ?? 40;
      player.hasPistol = !!save.hasPistol;
      G.runner.restore(save.missionIndex ?? 0);
      placePlayer(player, save.x ?? START_POS.x, save.z ?? START_POS.z, -2.2);
      if (G.runner.storyDone) G.runner.startDash(G);
      hud.toast('Welcome back to Palm City');
      return;
    }
  }
  G.runner.startMission(G);
  hud.toast('Follow the gold marker — Mara is waiting');
}

document.getElementById('btn-new').addEventListener('click', () => { audio.click(); startGame(false); });
document.getElementById('btn-continue').addEventListener('click', () => { audio.click(); startGame(true); });
document.getElementById('btn-resume').addEventListener('click', () => togglePause());
document.getElementById('btn-quit').addEventListener('click', () => {
  document.getElementById('pause-screen').classList.add('hidden');
  document.getElementById('start-screen').classList.remove('hidden');
  hud.hide();
  G.state = 'title';
});
document.getElementById('btn-respawn').addEventListener('click', () => respawn());
if (loadSave()) document.getElementById('btn-continue').classList.remove('hidden');

// ---------- The frame step ----------
function readInput() {
  const camDir = { x: 0, z: 0 };
  const focus = focusPos();
  camDir.x = focus.x - camera.position.x;
  camDir.z = focus.z - camera.position.z;
  const len = Math.hypot(camDir.x, camDir.z) || 1;
  camDir.x /= len;
  camDir.z /= len;
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  return {
    move: {
      x: camDir.x * fwd + -camDir.z * strafe,
      z: camDir.z * fwd + camDir.x * strafe,
    },
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    throttle: fwd,
    steer: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0),
    handbrake: keys.has('Space'),
  };
}

let smokeT = 0;
let recycleT = 0;
let autosaveT = 0;

function stepWorld(dt, input) {
  G.time += dt;
  const focus = focusPos();

  // Rico, or Rico's car.
  if (player.mode === 'car' && player.car) {
    const impact = stepCar(player.car, input, dt, world.colliders);
    if (impact > 0) onWallCrash(player.car, impact);
    player.x = player.car.mesh.position.x;
    player.z = player.car.mesh.position.z;
  } else {
    if (player.deadT > 0) {
      player.deadT -= dt;
      animatePerson(player.body, 0, dt);
    } else {
      updatePlayerFoot(player, input.move, input.run, dt, world.colliders);
    }
  }

  updateTraffic(traffic, allCars(), dt, world.colliders, onWallCrash);
  const target = {
    x: focus.x,
    z: focus.z,
    vx: player.mode === 'car' ? Math.sin(player.car.heading) * player.car.speed : player.vx,
    vz: player.mode === 'car' ? Math.cos(player.car.heading) * player.car.speed : player.vz,
    onFoot: player.mode === 'foot',
  };
  updatePoliceFleet(police, scene, stars(), target);
  updatePolice(police, dt, world.colliders, target, onWallCrash);
  flashLights(police, G.time);
  updateCrowd(crowd, dt);
  collideCars(allCars(), onCarImpact);
  carPeopleCollisions();

  // Heat: decays once the PD has lost sight of Rico for a while.
  const pd = nearestPolice(police, focus.x, focus.z);
  if (pd > 55) G.sightT += dt;
  else G.sightT = 0;
  if (G.sightT > HEAT.decayDelay && G.heat > 0) G.setHeat(Math.max(0, G.heat - HEAT.decayPerSecond * dt));

  // Bust: a cruiser on top of a Rico on foot, or swarming a wrecked car.
  const bustRange = player.mode === 'foot' ? 3.8 : (player.car && player.car.dead ? 7 : 0);
  if (stars() > 0 && bustRange > 0 && pd < bustRange) {
    G.bustT += dt;
    hud.setVignette(G.bustT > 0.4);
    if (G.bustT > 2.2) {
      hud.setVignette(false);
      endGame('busted');
      return;
    }
  } else {
    G.bustT = Math.max(0, G.bustT - dt * 2);
    if (G.bustT <= 0.4) hud.setVignette(false);
  }

  if (player.health <= 0) {
    player.health = 0;
    endGame('wasted');
    return;
  }
  player.health = Math.min(100, player.health + dt * 0.7); // slow recovery between scrapes

  // The story and the side work.
  G.runner.update(G, dt, G.time);
  G.runner.updateDash(G, dt);

  // Smoke over dying engines.
  smokeT -= dt;
  if (smokeT <= 0) {
    smokeT = 0.12;
    for (const car of allCars()) {
      if (car.health < 45) fx.smoke(car.mesh.position.x, 1.3, car.mesh.position.z, car.dead ? 2 : 1);
    }
  }

  // Keep the traffic near the action.
  recycleT -= dt;
  if (recycleT <= 0) {
    recycleT = 4;
    for (const t of traffic) {
      if (t.retired) continue;
      const p = t.car.mesh.position;
      if (dist2d(p.x, p.z, focus.x, focus.z) > 300) recycleTraffic(t, focus.x, focus.z);
    }
  }

  // Sound follows the world.
  if (player.mode === 'car' && player.car) audio.setEngine(true, Math.abs(player.car.speed) / 44);
  else audio.setEngine(false, 0);
  audio.setSiren(stars() > 0 && pd < 85, pd < 85 ? clamp((85 - pd) / 85, 0, 1) * 0.055 + 0.012 : 0);

  autosaveT -= dt;
  if (autosaveT <= 0) {
    autosaveT = 15;
    G.saveGame();
  }

  fx.update(dt);
}

/** Refresh every HUD element from the state. */
function refreshHud() {
  hud.setStars(stars());
  hud.setCash(G.cash);
  hud.setHealth(player.health / 100);
  if (player.mode === 'car' && player.car) {
    hud.setCarHealth(player.car.health / 100);
    hud.setSpeed(player.car.speed * 2.1);
  } else {
    hud.setCarHealth(null);
  }
  hud.setObjective(G.state === 'playing' || G.state === 'shot' ? G.runner.objective(G) : null);
  hud.setDialogue(G.runner.dialogue);
  let promptHtml = null;
  if (G.state === 'playing' && !G.runner.dialogue) {
    if (player.mode === 'foot') {
      const car = nearestEnterableCar(player, allCars());
      if (car) promptHtml = `<b>E</b> ${car.kind === 'parked' ? 'Steal vehicle' : 'Enter vehicle'}`;
      else if (dist2d(player.x, player.z, MARA_POS.x, MARA_POS.z) < 6 && G.runner.step && G.runner.step.type === 'talk') promptHtml = 'Talk to <b>Mara</b>';
    } else if (player.car && Math.abs(player.car.speed) < 2) {
      promptHtml = '<b>E</b> Exit vehicle';
    }
  }
  hud.setPrompt(promptHtml);
  hud.update(G, G.time);
}

// ---------- Boot ----------
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
let readySet = false;

if (shotName) {
  G.state = 'shot';
  G.shotMode = shotName;
  document.getElementById('start-screen').classList.add('hidden');
  hud.show();
  stageShot(shotName, { G, camera, stepWorld, readInput, scene });
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (frame.last ?? now)) / 1000);
  frame.last = now;
  if (G.state === 'playing') {
    stepWorld(dt, readInput());
    updateCamera(dt);
    refreshHud();
  } else if (G.state === 'shot') {
    updateCamera(0.016);
    refreshHud();
    fx.update(0.016);
  } else {
    // Title, pause and end screens: a slow orbit over the city so the menu lives somewhere.
    if (G.state === 'title') {
      const t = now / 1000;
      camera.position.set(Math.sin(t * 0.05) * 150, 52, 120 + Math.cos(t * 0.05) * 60);
      camera.lookAt(0, 8, 20);
      G.time += dt;
      updateCrowd(crowd, dt);
      updateTraffic(traffic, allCars(), dt, world.colliders, null);
      flashLights(police, G.time);
    }
  }
  renderer.render(scene, camera);
  if (!readySet) {
    readySet = true;
    window.__gameReady = true;
    document.body.dataset.ready = '1';
    document.getElementById('status').textContent = 'READY — Palm City Heat is running';
  }
}
requestAnimationFrame(frame);
