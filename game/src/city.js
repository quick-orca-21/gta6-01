// Palm City itself: the sunset sky, the road grid, the towers with lit windows and neon signs,
// palms, streetlights, the beach and the water. Everything visual that does not move lives here,
// built once from the fixed seed. It also owns the building colliders every mover tests against.
import { BEACH_Z, BLOCK_HALF, CITY_EDGE, COLORS, GRID, ROAD_HALF, ROAD_STEP, WATER_Z, WORLD_SEED } from './config.js';
import { clamp, seededRandom } from './rng.js';

const THREE = window.THREE;

/** Canvas texture of a soft radial glow, shared by streetlights, headlights and signs. */
export function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** The sunset sky: a big inward sphere painted with a vertical gradient, banded like dusk. */
function makeSky(scene) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0.0, '#160a38');
  grad.addColorStop(0.34, '#3d1663');
  grad.addColorStop(0.55, '#7a2a6e');
  grad.addColorStop(0.72, '#c94f6d');
  grad.addColorStop(0.86, '#ff8a52');
  grad.addColorStop(0.96, '#ffc46b');
  grad.addColorStop(1.0, '#ffdca8');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const tex = new THREE.CanvasTexture(c);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(880, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // The sun itself: a bright disc low over the water, plus its glow.
  const sunTex = makeGlowTexture();
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(46, 32),
    new THREE.MeshBasicMaterial({ color: 0xffe3ae, fog: false, transparent: true, opacity: 0.95 }),
  );
  sun.position.set(-330, 92, 700);
  sun.lookAt(0, 40, 0);
  scene.add(sun);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: 0xff9a52, transparent: true, opacity: 0.85, fog: false, depthWrite: false }));
  glow.scale.set(420, 420, 1);
  glow.position.copy(sun.position);
  scene.add(glow);
}

/** One facade texture pair (colour + emissive windows) for a tower. */
function makeFacade(rng, base, litRatio) {
  const w = 128;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const e = document.createElement('canvas');
  e.width = w;
  e.height = h;
  const ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, w, h);
  const cols = 6;
  const rows = 14;
  const cw = w / cols;
  const ch = h / rows;
  for (let x = 0; x < cols; x += 1) {
    for (let y = 0; y < rows; y += 1) {
      const lit = rng.next() < litRatio;
      const warm = rng.chance(0.72);
      const col = lit ? (warm ? '#ffd9a0' : '#bfe9ff') : 'rgba(20,16,34,0.9)';
      g.fillStyle = col;
      g.globalAlpha = lit ? 0.95 : 1;
      g.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
      if (lit) {
        ge.fillStyle = warm ? '#ffbe78' : '#9fdcff';
        ge.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
      }
    }
  }
  g.globalAlpha = 1;
  const map = new THREE.CanvasTexture(c);
  const emissiveMap = new THREE.CanvasTexture(e);
  return { map, emissiveMap };
}

const NEON_SIGNS = [
  { text: 'HOTEL SOL', color: '#ff5f8f' },
  { text: 'CLUB NOVA', color: '#37e0ff' },
  { text: 'PALM DINER', color: '#ffb066' },
  { text: 'CASINO AZUL', color: '#7dff8a' },
  { text: 'BAR TROPICO', color: '#ff7847' },
  { text: 'CINE MAR', color: '#e08aff' },
  { text: 'PIZZA LUNA', color: '#ffd23e' },
  { text: 'HOTEL BRISA', color: '#5ff2d0' },
];

/** A glowing neon sign texture with the given words. */
function makeSignTexture(sign) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(8,4,18,0.92)';
  g.fillRect(0, 0, 512, 96);
  g.font = '700 52px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = sign.color;
  g.shadowBlur = 22;
  g.fillStyle = sign.color;
  g.fillText(sign.text, 256, 52);
  g.shadowBlur = 6;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(sign.text, 256, 52);
  return new THREE.CanvasTexture(c);
}

/** A palm tree: tilted trunk and a crown of drooping fronds. */
function makePalm(rng, trunkMat, frondMat) {
  const palm = new THREE.Group();
  const height = rng.range(6.5, 9.5);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, height, 6), trunkMat);
  trunk.position.y = height / 2;
  trunk.rotation.z = rng.range(-0.09, 0.09);
  trunk.castShadow = true;
  palm.add(trunk);
  const fronds = 7;
  for (let i = 0; i < fronds; i += 1) {
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 3.6), frondMat);
    const a = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    frond.position.set(Math.sin(a) * 1.5, height + 0.25, Math.cos(a) * 1.5);
    frond.rotation.y = -a + Math.PI / 2;
    frond.rotation.z = 0.5;
    frond.castShadow = true;
    palm.add(frond);
  }
  return palm;
}

/** Road surface texture: asphalt with a dashed amber centre line, repeated along the strip. */
function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2c2337';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 260; i += 1) g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  g.fillStyle = '#e8b34b';
  g.fillRect(60, 8, 8, 52); // one dash per tile; the repeat makes the dashed line
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Build the whole city into `scene`. Returns the world data the movers need: building colliders,
 * the list of road centre coordinates and the shared glow texture.
 */
export function buildCity(scene) {
  const rng = seededRandom(WORLD_SEED);
  const colliders = [];
  const glowTexture = makeGlowTexture();

  scene.fog = new THREE.Fog(COLORS.fog, 130, 640);
  makeSky(scene);

  // Lights: a low warm sun and a violet sky bounce. The sun casts the long sunset shadows.
  const sun = new THREE.DirectionalLight(COLORS.sun, 1.25);
  sun.position.set(-190, 150, 260);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9a7bd8, 0x2e1a2e, 0.6));
  const downtownGlow = new THREE.PointLight(0xff7d5a, 0.7, 190);
  downtownGlow.position.set(0, 42, 0);
  scene.add(downtownGlow);

  // Base ground: dark violet earth under everything, then the sand and the sea to the south.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 1500),
    new THREE.MeshLambertMaterial({ color: COLORS.ground }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, 160);
  ground.receiveShadow = true;
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 120),
    new THREE.MeshLambertMaterial({ color: COLORS.sand }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.0, BEACH_Z + 44);
  sand.receiveShadow = true;
  scene.add(sand);

  const waterMat = new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 160, specular: 0xffc9a0 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1500, 700), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.4, WATER_Z + 340);
  scene.add(water);
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(1500, 3.2),
    new THREE.MeshBasicMaterial({ color: 0xfff3d8, transparent: true, opacity: 0.5 }),
  );
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.06, WATER_Z + 1);
  scene.add(foam);

  // Roads: one long strip per avenue and street, textured with the dashed centre line. The
  // geometry is pre-rotated flat: the north-south strips run the city's height, the east-west
  // strips run a little wider so the avenues reach the shore roads at both ends.
  const roadTex = makeRoadTexture();
  const spanNS = CITY_EDGE * 2;
  const spanEW = CITY_EDGE * 2 + 60;
  const geoNS = new THREE.PlaneGeometry(ROAD_HALF * 2, spanNS);
  geoNS.rotateX(-Math.PI / 2);
  const geoEW = new THREE.PlaneGeometry(ROAD_HALF * 2, spanEW);
  geoEW.rotateX(-Math.PI / 2);
  geoEW.rotateY(Math.PI / 2);
  for (let i = -GRID; i <= GRID; i += 1) {
    const at = i * ROAD_STEP;
    const texNS = roadTex.clone();
    texNS.needsUpdate = true;
    texNS.repeat.set(1, spanNS / 16);
    const stripNS = new THREE.Mesh(geoNS, new THREE.MeshLambertMaterial({ map: texNS }));
    stripNS.position.set(at, 0.02, 0);
    stripNS.receiveShadow = true;
    scene.add(stripNS);
    const texEW = roadTex.clone();
    texEW.needsUpdate = true;
    texEW.repeat.set(1, spanEW / 16);
    const stripEW = new THREE.Mesh(geoEW, new THREE.MeshLambertMaterial({ map: texEW }));
    stripEW.position.set(0, 0.021, at);
    stripEW.receiveShadow = true;
    scene.add(stripEW);
  }

  // Sidewalk slabs, one per block, slightly raised pale pavement.
  const walkMat = new THREE.MeshLambertMaterial({ color: COLORS.sidewalk });
  const walkGeo = new THREE.BoxGeometry(BLOCK_HALF * 2 + 0.6, 0.3, BLOCK_HALF * 2 + 0.6);
  for (let bx = -GRID; bx < GRID; bx += 1) {
    for (let bz = -GRID; bz < GRID; bz += 1) {
      const slab = new THREE.Mesh(walkGeo, walkMat);
      slab.position.set(bx * ROAD_STEP + ROAD_STEP / 2, 0.15, bz * ROAD_STEP + ROAD_STEP / 2);
      slab.receiveShadow = true;
      scene.add(slab);
    }
  }

  // Buildings: seeded per block. Downtown (the middle blocks) grows towers; the edges stay low.
  const facades = [
    makeFacade(rng, '#4b3550', 0.5),
    makeFacade(rng, '#3a3a55', 0.42),
    makeFacade(rng, '#5a4038', 0.55),
    makeFacade(rng, '#2f4450', 0.38),
  ];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x1d1428 });
  const signTextures = NEON_SIGNS.map(makeSignTexture);
  let signIndex = 0;
  for (let bx = -GRID; bx < GRID; bx += 1) {
    for (let bz = -GRID; bz < GRID; bz += 1) {
      const cx = bx * ROAD_STEP + ROAD_STEP / 2;
      const cz = bz * ROAD_STEP + ROAD_STEP / 2;
      const downtown = Math.abs(bx + 0.5) <= 1 && Math.abs(bz + 0.5) <= 1;
      const lots = downtown ? rng.int(1, 2) : rng.int(2, 3);
      for (let lot = 0; lot < lots; lot += 1) {
        const w = lots === 1 ? rng.range(26, 34) : rng.range(13, 19);
        const d = lots === 1 ? rng.range(26, 34) : rng.range(13, 19);
        const h = downtown ? rng.range(30, 62) : rng.range(10, 30);
        const ox = lots === 1 ? 0 : (lot % 2 === 0 ? -10 : 10) + rng.range(-2, 2);
        const oz = lots === 1 ? 0 : (lot < 2 ? -10 : 10) + rng.range(-2, 2);
        const facade = facades[rng.int(0, facades.length - 1)];
        const sideMat = new THREE.MeshLambertMaterial({
          map: facade.map,
          emissiveMap: facade.emissiveMap,
          emissive: 0xffffff,
          emissiveIntensity: 0.85,
        });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]);
        tower.position.set(cx + ox, h / 2 + 0.3, cz + oz);
        tower.castShadow = true;
        tower.receiveShadow = true;
        scene.add(tower);
        colliders.push({ minX: cx + ox - w / 2, maxX: cx + ox + w / 2, minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2 });
        // A rooftop cap and, downtown, a neon sign on the street face.
        const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 2.2, d * 0.4), roofMat);
        cap.position.set(cx + ox, h + 1.3, cz + oz);
        scene.add(cap);
        if (downtown && signIndex < signTextures.length && rng.chance(0.85)) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(15, 2.9),
            new THREE.MeshBasicMaterial({ map: signTextures[signIndex], transparent: true }),
          );
          signIndex += 1;
          sign.position.set(cx + ox, h * 0.62, cz + oz + d / 2 + 0.15);
          scene.add(sign);
          const back = sign.clone();
          back.rotation.y = Math.PI;
          back.position.z = cz + oz - d / 2 - 0.15;
          scene.add(back);
        }
      }
    }
  }

  // Palms along the shore and scattered on sidewalks; streetlights along every road.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
  for (let x = -210; x <= 210; x += 15) {
    if (rng.chance(0.25)) continue;
    const palm = makePalm(rng, trunkMat, frondMat);
    palm.position.set(x + rng.range(-3, 3), 0, BEACH_Z + rng.range(2, 16));
    palm.rotation.y = rng.range(0, Math.PI * 2);
    scene.add(palm);
  }
  for (let i = 0; i < 26; i += 1) {
    const palm = makePalm(rng, trunkMat, frondMat);
    const bx = rng.int(-GRID, GRID - 1) * ROAD_STEP + ROAD_STEP / 2;
    const bz = rng.int(-GRID, GRID - 1) * ROAD_STEP + ROAD_STEP / 2;
    palm.position.set(bx + (rng.chance(0.5) ? -1 : 1) * (BLOCK_HALF + 1.5), 0.3, bz + rng.range(-BLOCK_HALF, BLOCK_HALF));
    scene.add(palm);
  }

  const poleMat = new THREE.MeshLambertMaterial({ color: 0x22202c });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 7.2, 5);
  const lampGeo = new THREE.SphereGeometry(0.42, 8, 6);
  for (let i = -GRID; i <= GRID; i += 1) {
    for (let j = -GRID; j <= GRID; j += 1) {
      const x = i * ROAD_STEP + (j % 2 === 0 ? ROAD_HALF + 1.2 : -ROAD_HALF - 1.2);
      const z = j * ROAD_STEP + (i % 2 === 0 ? -ROAD_HALF - 1.2 : ROAD_HALF + 1.2);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.6, z);
      scene.add(pole);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(x, 7.3, z);
      scene.add(lamp);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: 0xffbe78, transparent: true, opacity: 0.5, depthWrite: false }));
      glow.scale.set(6.5, 6.5, 1);
      glow.position.set(x, 7.3, z);
      scene.add(glow);
    }
  }

  // The pier: a wooden jetty reaching into the water south of the marina, with crates at its root.
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x6e4f30 });
  const pier = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 64), woodMat);
  pier.position.set(84, 0.6, WATER_Z + 30);
  pier.castShadow = true;
  scene.add(pier);
  colliders.push({ minX: 79, maxX: 89, minZ: WATER_Z - 2, maxZ: WATER_Z + 62 });
  const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
  for (let i = 0; i < 7; i += 1) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), crateMat);
    crate.position.set(72 + rng.range(-4, 4), 1.2, WATER_Z - 8 + rng.range(-5, 5));
    crate.rotation.y = rng.range(0, 1.5);
    crate.castShadow = true;
    scene.add(crate);
  }

  // Mara's garage: a low wide building with a glowing sign at the south-east corner block.
  const garage = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 20), new THREE.MeshLambertMaterial({ color: 0x54455e }));
  garage.position.set(140, 4.3, 152);
  garage.castShadow = true;
  scene.add(garage);
  colliders.push({ minX: 127, maxX: 153, minZ: 142, maxZ: 162 });
  const garageSign = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 3.2),
    new THREE.MeshBasicMaterial({ map: makeSignTexture({ text: 'HARBORLIGHT GARAGE', color: '#ffb066' }), transparent: true }),
  );
  garageSign.position.set(140, 6.4, 141.8);
  garageSign.rotation.y = Math.PI;
  scene.add(garageSign);

  return { colliders, glowTexture, waterMat };
}

/** Push a circle (x, z, radius) out of every building collider; returns the corrected position. */
export function collideBuildings(colliders, x, z, radius) {
  for (let i = 0; i < colliders.length; i += 1) {
    const b = colliders[i];
    const nx = clamp(x, b.minX, b.maxX);
    const nz = clamp(z, b.minZ, b.maxZ);
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * radius;
        z = nz + (dz / d) * radius;
      } else {
        // Centre inside the box: leave by the nearest face.
        const left = x - b.minX;
        const right = b.maxX - x;
        const top = z - b.minZ;
        const bottom = b.maxZ - z;
        const m = Math.min(left, right, top, bottom);
        if (m === left) x = b.minX - radius;
        else if (m === right) x = b.maxX + radius;
        else if (m === top) z = b.minZ - radius;
        else z = b.maxZ + radius;
      }
    }
  }
  return { x, z };
}

/**
 * The height of the ground at a point: the raised sidewalk slabs (0.3) inside the blocks, the
 * pier deck (0.95) over the water, and street level (0) everywhere else. Feet use it; wheels
 * stay at street level and never notice the kerb.
 */
export function groundHeight(x, z) {
  if (x > 79 && x < 89 && z > WATER_Z - 2 && z < WATER_Z + 62) return 0.95;
  const mx = ((x % ROAD_STEP) + ROAD_STEP) % ROAD_STEP;
  const mz = ((z % ROAD_STEP) + ROAD_STEP) % ROAD_STEP;
  const inBlockX = mx > ROAD_HALF + 0.3 && mx < ROAD_STEP - ROAD_HALF - 0.3;
  const inBlockZ = mz > ROAD_HALF + 0.3 && mz < ROAD_STEP - ROAD_HALF - 0.3;
  return inBlockX && inBlockZ ? 0.3 : 0;
}

/** True when the point sits on a road strip (either orientation), used for spawning and AI. */
export function isOnRoad(x, z) {
  const fx = Math.abs(((x % ROAD_STEP) + ROAD_STEP * 1.5) % ROAD_STEP - ROAD_STEP / 2);
  const fz = Math.abs(((z % ROAD_STEP) + ROAD_STEP * 1.5) % ROAD_STEP - ROAD_STEP / 2);
  return fx < ROAD_HALF + 1 || fz < ROAD_HALF + 1;
}
