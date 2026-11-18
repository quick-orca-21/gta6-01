// Juice: sparks when metal meets metal, smoke over wrecked engines, a muzzle flash, and the
// camera shake that sells a crash. Two pooled point clouds do all of it, so effects never
// allocate in the frame loop.
const THREE = window.THREE;

const MAX = 420;

function makePool(scene, { size, color, additive, opacity }) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  return {
    points,
    pos,
    vel: new Float32Array(MAX * 3),
    life: new Float32Array(MAX),
    maxLife: new Float32Array(MAX),
    head: 0,
  };
}

function spawn(pool, x, y, z, count, spread, up, life) {
  for (let n = 0; n < count; n += 1) {
    const i = pool.head;
    pool.head = (pool.head + 1) % MAX;
    pool.pos[i * 3] = x;
    pool.pos[i * 3 + 1] = y;
    pool.pos[i * 3 + 2] = z;
    pool.vel[i * 3] = (Math.random() - 0.5) * spread;
    pool.vel[i * 3 + 1] = Math.random() * up;
    pool.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
    pool.life[i] = pool.maxLife[i] = life * (0.6 + Math.random() * 0.7);
  }
}

function updatePool(pool, dt, gravity, drag) {
  for (let i = 0; i < MAX; i += 1) {
    if (pool.life[i] <= 0) {
      pool.pos[i * 3 + 1] = -100; // park the dead far underground
      continue;
    }
    pool.life[i] -= dt;
    pool.vel[i * 3 + 1] += gravity * dt;
    pool.vel[i * 3] *= drag;
    pool.vel[i * 3 + 2] *= drag;
    pool.pos[i * 3] += pool.vel[i * 3] * dt;
    pool.pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt;
    pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
    if (pool.pos[i * 3 + 1] < 0.1) pool.pos[i * 3 + 1] = 0.1;
  }
  pool.points.geometry.attributes.position.needsUpdate = true;
}

/** Create the effects rig. `glowTexture` softens the smoke. */
export function createEffects(scene, glowTexture) {
  const sparks = makePool(scene, { size: 0.34, color: 0xffc46b, additive: true, opacity: 0.95 });
  const smoke = makePool(scene, { size: 2.6, color: 0x555060, additive: false, opacity: 0.4 });
  smoke.points.material.map = glowTexture;
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xffe9a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.scale.set(2.6, 2.6, 1);
  scene.add(flashSprite);
  let flashT = 0;
  let shake = 0;

  return {
    sparks(x, y, z, n = 10) { spawn(sparks, x, y, z, n, 7, 4.5, 0.5); },
    smoke(x, y, z, n = 2) { spawn(smoke, x, y, z, n, 1.2, 2.2, 1.6); },
    flash(x, y, z) {
      flashSprite.position.set(x, y, z);
      flashT = 0.09;
    },
    addShake(n) { shake = Math.min(shake + n, 1.4); },
    /** The current camera shake offset; call once per frame. */
    shakeOffset() {
      shake *= 0.88;
      if (shake < 0.01) return { x: 0, y: 0 };
      return { x: (Math.random() - 0.5) * shake * 0.5, y: (Math.random() - 0.5) * shake * 0.4 };
    },
    update(dt) {
      updatePool(sparks, dt, -9, 0.96);
      updatePool(smoke, dt, 1.2, 0.985);
      flashT = Math.max(0, flashT - dt);
      flashSprite.material.opacity = flashT > 0 ? 0.9 : 0;
    },
  };
}
