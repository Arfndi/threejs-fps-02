// Ember Yard: a desert rail-yard at dusk, built from boxes. Every solid box is a collider
// for players and bots and a surface a bullet stops on. The yard is 40 x 32 m with three
// lanes: the west rail line, the open middle yard and the east container row. Site A is the
// north dock, Site B the south container yard; attackers spawn south, defenders north.
// Routes are fixed polylines through the gaps, so bots never need a pathfinder.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';

// Procedural grit: a small canvas texture of speckles and scratches, generated at
// runtime (no files, no network), so flat boxes read as worn concrete and painted
// steel instead of plain colour. Seeded, so every load looks the same.
function canvasTexture(base, fleck, repeat) {
  const random = mulberry32(0xE771);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = random() < 0.5 ? fleck : base;
    ctx.globalAlpha = 0.08 + random() * 0.16;
    const size = 1 + random() * 4;
    ctx.fillRect(random() * 256, random() * 256, size, size);
  }
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = fleck;
  for (let i = 0; i < 24; i += 1) {
    const x = random() * 256;
    const y = random() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() * 40 - 20), y + (random() * 6 - 3));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const SITES = {
  A: { name: 'North Dock', x: -12, z: -11, radius: 3.2 },
  B: { name: 'South Yard', x: 12, z: 11, radius: 3.2 },
};

export const SPAWNS = {
  attack: [[-2, 14], [0, 14.5], [2, 14], [4, 13.5]],
  // Teammate bots spawn clear of the player's own spawn, so the camera never
  // starts inside a teammate's visor.
  attackBots: [[-6, 14], [-4, 14.5], [6, 13.5]],
  defend: [[-14, -14], [-10, -14], [10, -14], [14, -14]],
};

// Routes attackers take to each site, and the loops defenders patrol. Every waypoint
// sits in open ground, clear of the containers and the rail car, so a bot walking
// one never has to push through a solid box to reach the next.
export const ROUTES = {
  toA: [[0, 14], [-6, 10], [-12, 6], [-12, 0], [-12, -6], [-12, -11]],
  toA2: [[4, 14], [4, 8], [1, 6], [1, 0], [-2, -4], [-8, -8], [-12, -11]],
  toB: [[0, 14], [6, 12], [10, 10], [12, 11]],
  toB2: [[4, 14], [8, 12], [10, 8], [10, 10], [12, 11]],
  defendA: [[-12, -11], [-8, -13], [-16, -13], [-16, 4], [-10, 2]],
  defendB: [[12, 11], [17, 11], [7, 12], [14, 6]],
  mid: [[-7, -4], [7, -4], [7, 6], [-7, 6]],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: name === 'hairline' ? 0.25 : 0.03,
    });
  }
  const containerBlue = new THREE.MeshStandardMaterial({ color: 0x2f5d6b, roughness: 0.8, metalness: 0.2, map: canvasTexture('#2f5d6b', '#1d3d46', 2) });
  const containerRust = new THREE.MeshStandardMaterial({ color: 0x8a4a28, roughness: 0.85, metalness: 0.15, map: canvasTexture('#8a4a28', '#5d3018', 2) });
  const containerSand = new THREE.MeshStandardMaterial({ color: 0xc9a25e, roughness: 0.85, metalness: 0.05, map: canvasTexture('#c9a25e', '#9c7a42', 2) });
  const groundMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.95, metalness: 0.02, map: canvasTexture('#4a3a28', '#2e241a', 10) });
  const siteMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), roughness: 0.5, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.55,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground: sun-baked concrete, plus painted lane strips and site pads (visual only).
  box(40.4, 0.4, 32.4, 0, -0.2, 0, groundMaterial);
  box(3.0, 0.02, 28, -14, 0.02, 0, materials.hairline, false); // west rail bed
  box(0.3, 0.06, 28, -14.7, 0.03, 0, materials.ink, false); // rail, left
  box(0.3, 0.06, 28, -13.3, 0.03, 0, materials.ink, false); // rail, right
  const padA = box(5.4, 0.05, 5.4, SITES.A.x, 0.03, SITES.A.z, siteMaterial, false);
  const padB = box(5.4, 0.05, 5.4, SITES.B.x, 0.03, SITES.B.z, siteMaterial, false);
  padA.userData.site = 'A';
  padB.userData.site = 'B';

  // Perimeter walls, 4 m high, open to the dusk sky.
  box(0.4, 4, 32.4, -20.2, 2, 0, materials.surface);
  box(0.4, 4, 32.4, 20.2, 2, 0, materials.surface);
  box(40.4, 4, 0.4, 0, 2, -16.2, materials.surface);
  box(40.4, 4, 0.4, 0, 2, 16.2, materials.surface);

  // Site A dock: a crane frame over the open pad, and a low wall at the north edge.
  // The pad itself stays flat ground, so bots and the player can stand on the site.
  box(7, 1.0, 0.4, -12, 1.0, -15.6, materials.hairline);
  box(0.5, 5.5, 0.5, -15.5, 2.75, -12, materials.hairline);
  box(0.5, 5.5, 0.5, -8.5, 2.75, -12, materials.hairline);
  box(7.5, 0.5, 0.5, -12, 5.5, -12, materials.hairline);

  // Site B yard: stacked containers and a low wall.
  box(6.1, 2.6, 2.6, 15, 1.3, 8, containerBlue);
  box(6.1, 2.6, 2.6, 15, 3.9, 8, containerRust);
  box(6.1, 2.6, 2.6, 15, 1.3, 13.5, containerSand);
  box(2.6, 2.6, 2.6, 8, 1.3, 14.5, containerBlue);

  // Middle yard: two containers crossed, the map's centrepiece.
  box(6.1, 2.6, 2.6, 0, 1.3, -1, containerRust);
  box(2.6, 2.6, 6.1, 3.5, 1.3, 2.5, containerBlue);
  box(6.1, 2.6, 2.6, 0, 3.9, -1, containerSand);

  // East container row: a long sightline down the east lane.
  box(6.1, 2.6, 2.6, 17, 1.3, -6, containerSand);
  box(6.1, 2.6, 2.6, 17, 1.3, -1, containerRust);

  // West rail car: a long boxcar parked on the rails.
  box(2.8, 3.0, 9, -14, 1.7, -4, containerBlue);
  box(2.9, 0.4, 9.2, -14, 3.3, -4, materials.hairline);

  // Crates: low cover to crouch behind, scattered on every lane.
  box(1.4, 1.1, 1.4, -7, 0.55, 4, materials.hairline);
  box(1.4, 1.1, 1.4, -5.4, 0.55, 4, materials.hairline);
  box(1.4, 1.1, 1.4, 7, 0.55, -6, materials.hairline);
  box(1.4, 1.1, 1.4, 8.6, 0.55, -6, materials.hairline);
  box(1.2, 0.9, 1.2, -2, 0.45, 8, materials.hairline);
  box(1.2, 0.9, 1.2, 10, 0.45, -10, materials.hairline);
  box(1.2, 0.9, 1.2, -17, 0.45, 8, materials.hairline);
  box(1.2, 0.9, 1.2, 17, 0.45, 12, materials.hairline);
  box(2.2, 1.1, 1.2, -9, 0.55, -2, materials.hairline);
  box(2.2, 1.1, 1.2, 9, 0.55, 4, materials.hairline);

  // Water tower: four legs and a tank, a landmark visible from everywhere.
  const legMaterial = materials.hairline;
  for (const [lx, lz] of [[-18, 12], [-16.4, 12], [-18, 13.6], [-16.4, 13.6]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 0.3), legMaterial);
    leg.position.set(lx, 3, lz);
    leg.castShadow = true;
    group.add(leg);
    colliders.push(new THREE.Box3().setFromObject(leg));
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 18), containerRust);
  tank.position.set(-17.2, 7.2, 12.8);
  tank.castShadow = true;
  tank.receiveShadow = true;
  group.add(tank);
  colliders.push(new THREE.Box3().setFromObject(tank));
  shootables.push(tank);

  // Light poles: a mast and a warm lamp, no collider on the lamp itself.
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffb45e, emissiveIntensity: 1.4,
  });
  for (const [lx, lz] of [[-8, -8], [8, 8], [0, -12], [0, 12]]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), materials.hairline);
    mast.position.set(lx, 2.6, lz);
    mast.castShadow = true;
    group.add(mast);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampMaterial);
    lamp.position.set(lx, 5.3, lz);
    group.add(lamp);
    const glow = new THREE.PointLight(0xffb45e, 6, 12, 1.6);
    glow.position.set(lx, 5.2, lz);
    scene.add(glow);
  }

  // Light: a low dusk sun from the west, a cool sky fill, and a warm hemisphere.
  const sky = new THREE.HemisphereLight(new THREE.Color('#7a6a8a'), new THREE.Color('#3a2a1c'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.6);
  sun.position.set(-18, 12, 6);
  sun.target.position.set(4, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#8a9ab8'), 0.5);
  fill.position.set(14, 10, -10);
  scene.add(fill);

  return { colliders, shootables, group };
}

// Shared AABB probe: does a standing body of radius r and height h at (x, y, z) hit
// anything? Bots and the player both resolve movement against this, one axis at a time.
const _probe = new THREE.Box3();
export function collidesAt(colliders, x, y, z, radius, height, lift = 0.02) {
  _probe.min.set(x - radius, y + lift, z - radius);
  _probe.max.set(x + radius, y + height - lift, z + radius);
  for (const collider of colliders) {
    if (_probe.intersectsBox(collider)) return collider;
  }
  return null;
}
