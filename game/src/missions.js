// The story of Palm City Heat: three jobs for Mara Sol of the Harborlight Garage, told as a
// chain of marked objectives — talk, steal, drive, deliver, escape — plus the repeatable Dash
// Delivery runs that keep the money coming after the story ends. This module owns the mission
// data, the glowing markers, Mara herself, the dialogue lines and the step-by-step progression;
// main.js owns the world it plays out in and passes its state in as `G`.
import { GARAGE_POS, MARA_POS, WATER_Z } from './config.js';
import { makePerson } from './pedestrians.js';
import { makeCar, placeCar } from './vehicles.js';
import { dist2d } from './rng.js';

const THREE = window.THREE;

// Story locations, all real places in the built city.
export const LOT_POS = { x: -84, z: 176 }; // boardwalk parking lot, where the Vireo GT waits
export const PIER_POS = { x: 84, z: WATER_Z - 4 }; // the pier root, Mara's pickup point
export const CLUB_POS = { x: -30, z: -30 }; // Club Nova's corner, downtown
export const MARINA_POS = { x: 148, z: 200 }; // the marina crates, east end of the beach

const MISSIONS = [
  {
    id: 'first-wheels',
    title: 'FIRST WHEELS',
    reward: 600,
    rewardNote: 'Mara hands you her spare pistol. Press G to use it.',
    intro: [
      { name: 'MARA', text: 'Rico Vega. Five years and you still owe me a car. Lucky for you, I have a way for you to pay it back.' },
      { name: 'MARA', text: 'There is a gold Vireo GT parked at the boardwalk lot, west end of the beach. Its owner is a cheat and a coward. Bring it to my garage.' },
      { name: 'RICO', text: 'Steal a car in broad sunset. You always did know how to welcome a man home.' },
    ],
    steps: [
      { type: 'talk', x: MARA_POS.x, z: MARA_POS.z, r: 4.5, text: 'Talk to Mara at the Harborlight Garage' },
      { type: 'steal', x: LOT_POS.x, z: LOT_POS.z, r: 6, text: 'Steal the gold Vireo GT at the boardwalk lot' },
      { type: 'drive', x: GARAGE_POS.x, z: GARAGE_POS.z, r: 8, text: 'Deliver the Vireo GT to the Harborlight Garage', needsTargetCar: true },
    ],
  },
  {
    id: 'night-run',
    title: 'NIGHT RUN',
    reward: 1000,
    rewardNote: '',
    intro: [
      { name: 'MARA', text: 'Good wheels, clean work. Now a paying job: a package is waiting at the pier, east end of the beach.' },
      { name: 'MARA', text: 'The moment you touch it, half the Palm City PD will want to meet you. Get it to Club Nova, downtown, before the clock eats you.' },
      { name: 'RICO', text: 'No pressure, then. Just the whole police force and a deadline.' },
    ],
    steps: [
      { type: 'talk', x: MARA_POS.x, z: MARA_POS.z, r: 4.5, text: 'Talk to Mara at the Harborlight Garage' },
      { type: 'pickup', x: PIER_POS.x, z: PIER_POS.z, r: 5.5, text: 'Pick up the package at the pier', setsHeat: 2 },
      { type: 'deliver', x: CLUB_POS.x, z: CLUB_POS.z, r: 8, text: 'Deliver the package to Club Nova', timeLimit: 150 },
    ],
  },
  {
    id: 'harbor-heat',
    title: 'HARBOR HEAT',
    reward: 1800,
    rewardNote: '',
    intro: [
      { name: 'MARA', text: 'Last job, Rico, and it is a fat one. A cash case is sitting with the crates at the marina, east beach.' },
      { name: 'MARA', text: 'Take it, and every badge in the city comes down on you. Lose them — all of them — then bring it home to me.' },
      { name: 'RICO', text: 'And after this, we are square?' },
      { name: 'MARA', text: 'After this, partner, we are just getting started.' },
    ],
    steps: [
      { type: 'talk', x: MARA_POS.x, z: MARA_POS.z, r: 4.5, text: 'Talk to Mara at the Harborlight Garage' },
      { type: 'pickup', x: MARINA_POS.x, z: MARINA_POS.z, r: 5.5, text: 'Grab the cash case at the marina crates', setsHeat: 3 },
      { type: 'escape', text: 'Lose the heat — get your wanted level to zero' },
      { type: 'drive', x: GARAGE_POS.x, z: GARAGE_POS.z, r: 8, text: 'Bring the case back to the Harborlight Garage' },
    ],
  },
];

/** A glowing objective marker: a beam of light, a pulsing ring and a bobbing chevron. */
function makeMarker(color) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.1, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 17;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.4, 0.22, 8, 28),
    new THREE.MeshBasicMaterial({ color }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.4;
  group.add(ring);
  const chevron = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 2.2, 4),
    new THREE.MeshBasicMaterial({ color }),
  );
  chevron.rotation.x = Math.PI;
  chevron.position.y = 6.4;
  group.add(chevron);
  return { group, ring, chevron };
}

export class MissionRunner {
  constructor(scene, rng) {
    this.index = 0; // which mission (MISSIONS.length = story done)
    this.stepIndex = 0;
    this.state = 'idle'; // idle | dialogue | active | done
    this.dialogue = null; // {name, text} currently on screen
    this.dialogueQueue = [];
    this.dialogueT = 0;
    this.timeLeft = null;
    this.targetCar = null;
    this.marker = makeMarker(0xffc93e);
    scene.add(this.marker.group);
    this.dashMarker = makeMarker(0x37e0ff);
    scene.add(this.dashMarker.group);
    // Mara herself, waiting by the garage doors.
    this.mara = makePerson(rng, {
      skin: 0x8a5a3b, shirt: 0x37e0ff, pants: 0x23232f,
      hair: 0x140f0d, hairStyle: 'long', accessory: 'belt',
    });
    this.mara.group.position.set(MARA_POS.x, 0.3, MARA_POS.z);
    this.mara.group.rotation.y = -2.2;
    scene.add(this.mara.group);
    // Dash Delivery state (the repeatable side activity).
    this.dash = { stage: 'off', x: 0, z: 0, pay: 0 }; // off | pickup | dropoff
  }

  get mission() {
    return this.index < MISSIONS.length ? MISSIONS[this.index] : null;
  }

  get step() {
    const m = this.mission;
    return m ? m.steps[this.stepIndex] : null;
  }

  get storyDone() {
    return this.index >= MISSIONS.length;
  }

  /** Begin the current mission: queue its intro for the talk step. */
  startMission(G) {
    const m = this.mission;
    if (!m) return;
    this.stepIndex = 0;
    this.state = 'active';
    G.toast(`${m.title} — follow the gold marker`);
  }

  /** Spawn the gold Vireo GT the first mission revolves around. */
  ensureTargetCar(scene) {
    if (this.targetCar && !this.targetCar.dead) return this.targetCar;
    const car = makeCar(scene, { color: 0xffc93e, sports: true, kind: 'parked' });
    placeCar(car, LOT_POS.x, LOT_POS.z, Math.PI / 2);
    this.targetCar = car;
    return car;
  }

  /** The world position the gold marker should stand on right now, or null. */
  markerTarget(G) {
    if (this.state === 'dialogue') return null;
    const s = this.step;
    if (!s) return null;
    if (s.type === 'escape') return null; // no marker: the objective is to disappear
    if (s.type === 'steal' && this.targetCar) {
      const p = this.targetCar.mesh.position;
      return { x: p.x, z: p.z };
    }
    return { x: s.x, z: s.z };
  }

  /** The objective line for the HUD: {title, text, dist} or null. */
  objective(G) {
    const m = this.mission;
    if (!m) {
      if (this.dash.stage !== 'off') return { title: 'DASH DELIVERY', text: this.dash.stage === 'pickup' ? 'Pick up the fare (drive to the blue marker)' : 'Drop off your passenger', dist: this.distanceTo(G, this.dash) };
      return { title: 'FREE ROAM', text: 'Palm City is yours. Grab a car, make some money, stay out of jail.', dist: null };
    }
    const s = this.step;
    let text = s.text;
    if (s.type === 'drive' && s.needsTargetCar && G.player.car !== this.targetCar) text = 'Get back in the gold Vireo GT';
    if (this.timeLeft !== null) text += ` — ${Math.ceil(this.timeLeft)}s left`;
    const target = this.markerTarget(G);
    return { title: `${m.title}`, text, dist: target ? this.distanceTo(G, target) : null };
  }

  distanceTo(G, target) {
    const p = G.player.mode === 'car' ? G.player.car.mesh.position : G.player;
    return Math.round(dist2d(p.x, p.z, target.x, target.z));
  }

  /** Start the repeatable delivery runs once the first job is done. */
  startDash(G) {
    if (this.dash.stage !== 'off') return;
    const spot = G.randomCurbSpot();
    this.dash = { stage: 'pickup', x: spot.x, z: spot.z, pay: 0 };
    G.toast('DASH DELIVERY: a fare is waiting at the blue marker');
  }

  updateDash(G, dt) {
    if (this.dash.stage === 'off') return;
    const d = this.distanceTo(G, this.dash);
    if (this.dash.stage === 'pickup' && d < 6 && G.player.mode === 'car') {
      const drop = G.randomCurbSpot();
      this.dash.stage = 'dropoff';
      this.dash.x = drop.x;
      this.dash.z = drop.z;
      this.dash.pay = Math.round(60 + dist2d(G.player.car.mesh.position.x, G.player.car.mesh.position.z, drop.x, drop.z) * 0.9);
      G.audio.pickup();
      G.toast(`Fare aboard — $${this.dash.pay} if you get them there`);
    } else if (this.dash.stage === 'dropoff' && d < 7) {
      G.addCash(this.dash.pay);
      G.audio.cash();
      G.toast(`Delivered: +$${this.dash.pay}`);
      const spot = G.randomCurbSpot();
      this.dash = { stage: 'pickup', x: spot.x, z: spot.z, pay: 0 };
    }
  }

  /** Advance the story by one frame. `G` is the game state from main.js. */
  update(G, dt, time) {
    // Mara idles: a slow weight shift, nothing more.
    this.mara.group.rotation.y = -2.2 + Math.sin(time * 0.6) * 0.14;

    // Dialogue playback.
    if (this.dialogue) {
      this.dialogueT += dt;
      if (this.dialogueT > 4.2) this.nextDialogue(G);
    }

    // Marker animation and placement.
    const target = this.markerTarget(G);
    this.marker.group.visible = !!target && this.state !== 'dialogue';
    if (target) {
      this.marker.group.position.set(target.x, 0, target.z);
      this.marker.chevron.position.y = 6.4 + Math.sin(time * 2.4) * 0.7;
      const pulse = 1 + Math.sin(time * 3.2) * 0.12;
      this.marker.ring.scale.set(pulse, pulse, 1);
    }
    this.dashMarker.group.visible = this.dash.stage !== 'off';
    if (this.dash.stage !== 'off') {
      this.dashMarker.group.position.set(this.dash.x, 0, this.dash.z);
      this.dashMarker.chevron.position.y = 6.4 + Math.sin(time * 2.4 + 1) * 0.7;
    }

    if (this.state !== 'active') return;
    const s = this.step;
    if (!s) return;

    // Timed steps.
    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = null;
        G.audio.denied();
        G.toast('Out of time — the job resets');
        if (s.setsHeat) G.setHeat(0);
        this.stepIndex = Math.max(0, this.stepIndex - 1);
        return;
      }
    }

    const p = G.player.mode === 'car' ? G.player.car.mesh.position : G.player;
    const near = s.x !== undefined && dist2d(p.x, p.z, s.x, s.z) < s.r;

    switch (s.type) {
      case 'talk':
        if (near && this.dialogueQueue.length === 0 && !this.dialogue) {
          this.dialogueQueue = [...this.mission.intro];
          this.state = 'dialogue';
          this.nextDialogue(G);
        }
        break;
      case 'steal':
        this.ensureTargetCar(G.scene);
        if (G.player.car === this.targetCar) this.completeStep(G);
        break;
      case 'pickup':
        if (near) {
          if (s.setsHeat) {
            G.setHeat(s.setsHeat);
            G.toast('Heat incoming — the PD is rolling');
          }
          G.audio.pickup();
          this.completeStep(G);
        }
        break;
      case 'deliver':
        if (near) this.completeStep(G);
        break;
      case 'drive':
        if (near && (!s.needsTargetCar || G.player.car === this.targetCar)) this.completeStep(G);
        break;
      case 'escape':
        if (G.heat <= 0.01) this.completeStep(G);
        break;
      default:
        break;
    }

    // The first mission's car can be wrecked: fail it back to the steal step with a fresh car.
    if (this.mission && this.mission.id === 'first-wheels' && this.targetCar && this.targetCar.dead && this.stepIndex === 2) {
      G.toast('The Vireo is wrecked — a replacement just turned up at the lot');
      this.targetCar = null;
      this.stepIndex = 1;
    }
  }

  nextDialogue(G) {
    const line = this.dialogueQueue.shift();
    this.dialogue = line ?? null;
    this.dialogueT = 0;
    if (!line && this.state === 'dialogue') {
      this.state = 'active';
      this.completeStep(G); // the talk step ends when the talking does
    }
  }

  completeStep(G) {
    const m = this.mission;
    const s = this.step;
    if (s && s.timeLimit) this.timeLeft = null;
    this.stepIndex += 1;
    if (this.stepIndex >= m.steps.length) {
      // Mission complete.
      G.addCash(m.reward);
      if (m.id === 'first-wheels') G.player.hasPistol = true;
      G.audio.complete();
      G.banner('MISSION COMPLETE', `${m.title} — +$${m.reward}${m.rewardNote ? ` · ${m.rewardNote}` : ''}`);
      this.index += 1;
      this.stepIndex = 0;
      this.state = this.mission ? 'active' : 'done';
      if (this.mission) G.toast(`Next: ${this.mission.title} — talk to Mara`);
      else {
        G.banner('STORY COMPLETE', 'Rico and Mara run the Harborlight now. Palm City is yours.');
        this.startDash(G);
      }
      if (m.id === 'first-wheels') this.startDash(G);
      G.saveGame();
      return;
    }
    const next = this.step;
    if (next && next.timeLimit) this.timeLeft = next.timeLimit;
    if (next && next.type === 'steal') this.ensureTargetCar(G.scene);
    G.audio.pickup();
  }

  /** Restore story progress from a save: index of the mission to resume. */
  restore(index) {
    this.index = Math.min(index, MISSIONS.length);
    this.stepIndex = 0;
    this.state = this.mission ? 'active' : 'done';
    if (this.storyDone) this.dash.stage = 'off';
  }
}
