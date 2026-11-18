// The HUD: wanted stars, cash, health, the objective card, prompts, dialogue, banners — and the
// live minimap, a little canvas map of Palm City with the player, the police and the objective
// on it. Everything is DOM over the 3D view; this module owns the elements index.html declares.
import { BEACH_Z, GRID, ROAD_HALF, ROAD_STEP, WATER_Z } from './config.js';
import { clamp } from './rng.js';

function el(id) {
  return document.getElementById(id);
}

export function createHud() {
  const hud = el('hud');
  const stars = el('stars');
  const cash = el('cash');
  const health = el('health');
  const carWrap = el('carhealth-wrap');
  const carHealth = el('carhealth');
  const objective = el('objective');
  const objTitle = el('obj-title');
  const objText = el('obj-text');
  const objDist = el('obj-dist');
  const prompt = el('prompt');
  const toastEl = el('toast');
  const dialogue = el('dialogue');
  const dlgName = el('dlg-name');
  const dlgText = el('dlg-text');
  const banner = el('banner');
  const bannerBig = el('banner-big');
  const bannerSub = el('banner-sub');
  const speed = el('speed');
  const speedNum = el('speed-num');
  const vignette = el('vignette');
  const map = el('minimap').getContext('2d');

  let toastUntil = 0;
  let bannerUntil = 0;
  let lastStars = -1;
  let lastCash = null;

  // The minimap covers the city and the shore: x in [-250, 250], z in [-250, 310].
  const MAP = { x0: -250, z0: -250, w: 500, h: 560, size: 196 };
  function mapPoint(x, z) {
    return [
      ((x - MAP.x0) / MAP.w) * MAP.size,
      ((z - MAP.z0) / MAP.h) * MAP.size,
    ];
  }

  function drawMinimap(G, time) {
    const s = MAP.size;
    map.fillStyle = '#17102a';
    map.fillRect(0, 0, s, s);
    // Sand and sea.
    let [bx, bz] = mapPoint(-250, BEACH_Z);
    map.fillStyle = '#8a6f45';
    map.fillRect(0, bz, s, s - bz);
    [, bz] = mapPoint(-250, WATER_Z);
    map.fillStyle = '#0d4a61';
    map.fillRect(0, bz, s, s - bz);
    // Roads.
    map.strokeStyle = '#3d3352';
    map.lineWidth = Math.max(2, ((ROAD_HALF * 2) / MAP.w) * s);
    for (let i = -GRID; i <= GRID; i += 1) {
      const [vx] = mapPoint(i * ROAD_STEP, 0);
      map.beginPath();
      map.moveTo(vx, 0);
      map.lineTo(vx, s);
      map.stroke();
      const [, hz] = mapPoint(0, i * ROAD_STEP);
      map.beginPath();
      map.moveTo(0, hz);
      map.lineTo(s, hz);
      map.stroke();
    }
    // The dash fare and the story objective.
    function blip(x, z, color, r) {
      const [px, py] = mapPoint(clamp(x, MAP.x0, MAP.x0 + MAP.w), clamp(z, MAP.z0, MAP.z0 + MAP.h));
      map.fillStyle = color;
      map.beginPath();
      map.arc(px, py, r, 0, Math.PI * 2);
      map.fill();
    }
    if (G.runner.dash.stage !== 'off') blip(G.runner.dash.x, G.runner.dash.z, '#37e0ff', 3.5);
    const target = G.runner.markerTarget(G);
    if (target) blip(target.x, target.z, '#ffc93e', 4);
    // Police: red dots with a flashing blue ring.
    for (const unit of G.police) {
      const p = unit.car.mesh.position;
      const [px, py] = mapPoint(p.x, p.z);
      map.fillStyle = '#ff3b4e';
      map.beginPath();
      map.arc(px, py, 3, 0, Math.PI * 2);
      map.fill();
      if (Math.floor(time * 4) % 2 === 0) {
        map.strokeStyle = '#2a7fff';
        map.lineWidth = 1.4;
        map.beginPath();
        map.arc(px, py, 5, 0, Math.PI * 2);
        map.stroke();
      }
    }
    // The player: a white arrow pointing the way they face.
    const focus = G.player.mode === 'car' ? G.player.car.mesh.position : G.player;
    const heading = G.player.mode === 'car' ? G.player.car.heading : G.player.heading;
    const [px, py] = mapPoint(focus.x, focus.z);
    const fx = Math.sin(heading);
    const fy = Math.cos(heading);
    map.fillStyle = '#ffffff';
    map.beginPath();
    map.moveTo(px + fx * 7, py + fy * 7);
    map.lineTo(px - fy * 4.4 - fx * 3.4, py + fx * 4.4 - fy * 3.4);
    map.lineTo(px + fy * 4.4 - fx * 3.4, py - fx * 4.4 - fy * 3.4);
    map.closePath();
    map.fill();
    // Traffic, faint, so the streets feel alive on the map too.
    map.fillStyle = 'rgba(200,200,220,0.5)';
    for (const t of G.traffic) {
      const p = t.car.mesh.position;
      const [tx, ty] = mapPoint(p.x, p.z);
      map.fillRect(tx - 1.2, ty - 1.2, 2.4, 2.4);
    }
  }

  return {
    show() { hud.classList.remove('hidden'); },
    hide() { hud.classList.add('hidden'); },
    setStars(n) {
      if (n === lastStars) return;
      lastStars = n;
      let html = '';
      for (let i = 0; i < 5; i += 1) html += i < n ? '★' : '<span class="off">★</span>';
      stars.innerHTML = html;
    },
    setCash(n) {
      if (n === lastCash) return;
      lastCash = n;
      cash.innerHTML = `<small>$</small> ${n.toLocaleString('en-US')}`;
    },
    setHealth(frac) {
      health.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
    },
    setCarHealth(frac) {
      if (frac === null) {
        carWrap.classList.add('hidden');
        speed.classList.add('hidden');
        return;
      }
      carWrap.classList.remove('hidden');
      carHealth.style.width = `${Math.round(clamp(frac, 0, 1) * 100)}%`;
      speed.classList.remove('hidden');
    },
    setSpeed(mph) {
      speedNum.textContent = String(Math.round(Math.abs(mph)));
    },
    setObjective(obj) {
      if (!obj) {
        objective.classList.add('hidden');
        return;
      }
      objective.classList.remove('hidden');
      objTitle.textContent = obj.title;
      objText.textContent = obj.text;
      objDist.textContent = obj.dist !== null && obj.dist !== undefined ? `${obj.dist} m` : '';
    },
    setPrompt(html) {
      if (!html) {
        prompt.classList.add('hidden');
        return;
      }
      prompt.classList.remove('hidden');
      prompt.innerHTML = html;
    },
    toast(msg, seconds = 3.6) {
      toastEl.textContent = msg;
      toastEl.classList.remove('hidden');
      toastUntil = performance.now() + seconds * 1000;
    },
    banner(big, sub, seconds = 4.2) {
      bannerBig.textContent = big;
      bannerSub.textContent = sub ?? '';
      banner.classList.remove('hidden');
      bannerUntil = performance.now() + seconds * 1000;
    },
    setDialogue(line) {
      if (!line) {
        dialogue.classList.add('hidden');
        return;
      }
      dialogue.classList.remove('hidden');
      dlgName.textContent = line.name;
      dlgText.textContent = line.text;
    },
    setVignette(on) {
      vignette.style.opacity = on ? '1' : '0';
    },
    /** Per-frame: expire toasts and banners, redraw the minimap. */
    update(G, time) {
      const now = performance.now();
      if (toastUntil && now > toastUntil) {
        toastEl.classList.add('hidden');
        toastUntil = 0;
      }
      if (bannerUntil && now > bannerUntil) {
        banner.classList.add('hidden');
        bannerUntil = 0;
      }
      drawMinimap(G, time);
    },
  };
}
