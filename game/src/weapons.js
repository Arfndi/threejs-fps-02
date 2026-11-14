// Weapons: three guns and one grenade, each with its own numbers, price and view model.
// The module owns the magazine, the reload, the muzzle flash and the grenade flight; the
// sim (main.js) owns the ray and the damage. Spread grows with movement and with fire, so
// stopping to aim pays; crouching tightens it further.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Sidewinder', kind: 'pistol', price: 0, auto: false,
    damage: 26, headMult: 3.2, fireGap: 0.16, magSize: 12, reserve: 36,
    reloadTime: 1.4, spreadStill: 0.003, spreadMoving: 0.02, range: 60,
  },
  smg: {
    id: 'smg', name: 'Hornet', kind: 'smg', price: 1500, auto: true,
    damage: 19, headMult: 2.6, fireGap: 0.075, magSize: 28, reserve: 112,
    reloadTime: 1.7, spreadStill: 0.005, spreadMoving: 0.034, range: 45,
  },
  rifle: {
    id: 'rifle', name: 'Longhorn', kind: 'rifle', price: 2700, auto: true,
    damage: 34, headMult: 3.0, fireGap: 0.105, magSize: 25, reserve: 75,
    reloadTime: 2.1, spreadStill: 0.002, spreadMoving: 0.03, range: 80,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;
const GRENADE_FUSE = 1.7;
const GRENADE_RADIUS = 6.5;
const GRENADE_DAMAGE = 110;

function buildViewModel(kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a3a22'), roughness: 0.8, metalness: 0.05 });
  const model = new THREE.Group();
  function part(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (kind === 'rifle') {
    part(new THREE.BoxGeometry(0.09, 0.11, 0.46), steel, 0, 0, 0);
    part(new THREE.BoxGeometry(0.045, 0.045, 0.42), dark, 0, 0.03, -0.4);
    part(new THREE.BoxGeometry(0.075, 0.09, 0.24), grip, 0, -0.03, 0.3);
    part(new THREE.BoxGeometry(0.05, 0.12, 0.08), grip, 0, -0.09, 0.08);
    part(new THREE.BoxGeometry(0.03, 0.05, 0.1), dark, 0, 0.08, -0.1);
  } else if (kind === 'smg') {
    part(new THREE.BoxGeometry(0.08, 0.09, 0.34), steel, 0, 0, 0);
    part(new THREE.BoxGeometry(0.04, 0.04, 0.3), dark, 0, 0.02, -0.3);
    part(new THREE.BoxGeometry(0.06, 0.08, 0.18), grip, 0, -0.03, 0.22);
    part(new THREE.BoxGeometry(0.045, 0.16, 0.06), dark, 0, -0.1, -0.02);
  } else {
    part(new THREE.BoxGeometry(0.07, 0.09, 0.22), steel, 0, 0, 0);
    part(new THREE.BoxGeometry(0.05, 0.11, 0.07), grip, 0, -0.08, 0.08);
    part(new THREE.BoxGeometry(0.03, 0.03, 0.2), dark, 0, 0.03, -0.18);
  }
  model.position.set(0.24, -0.21, -0.44);
  return model;
}

export function createWeapons(camera, scene) {
  const models = {};
  for (const key of Object.keys(WEAPONS)) {
    const model = buildViewModel(WEAPONS[key].kind);
    model.visible = false;
    camera.add(model);
    models[key] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.19, -0.98);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6, metalness: 0.4 });
  const grenades = [];

  const state = {
    current: 'pistol',
    mag: WEAPONS.pistol.magSize,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: 0,
  };

  function currentDef() {
    return WEAPONS[state.current];
  }

  function showModel() {
    for (const key of Object.keys(models)) models[key].visible = key === state.current;
  }
  showModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    const model = models[state.current];
    model.position.z = -0.44 + state.kick;
    model.rotation.x = state.kick * 2.4;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 28;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = currentDef();
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    // Grenade flight: gravity, bounce once, then the fuse ends it.
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.velocity.y -= 14 * dt;
      grenade.position.addScaledVector(grenade.velocity, dt);
      if (grenade.position.y < 0.09) {
        grenade.position.y = 0.09;
        grenade.velocity.y *= -0.35;
        grenade.velocity.x *= 0.6;
        grenade.velocity.z *= 0.6;
      }
      grenade.fuse -= dt;
      grenade.mesh.position.copy(grenade.position);
      if (grenade.fuse <= 0) {
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
        grenade.onExplode(grenade.position);
      }
    }
  }

  return {
    state,
    def() {
      return currentDef();
    },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = currentDef().fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + 0.008);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed, crouching) {
      const def = currentDef();
      const move = Math.min(1, speed / 5.0);
      let value = def.spreadStill + move * def.spreadMoving + state.bloom;
      if (crouching) value *= 0.7;
      return value;
    },
    equip(id) {
      if (!WEAPONS[id] || state.current === id) return false;
      state.current = id;
      state.mag = WEAPONS[id].magSize;
      state.reserve = WEAPONS[id].reserve;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      showModel();
      return true;
    },
    refill(id) {
      state.current = id;
      state.mag = WEAPONS[id].magSize;
      state.reserve = WEAPONS[id].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      showModel();
    },
    throwGrenade(origin, direction, onExplode) {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
      mesh.position.copy(origin);
      scene.add(mesh);
      grenades.push({
        mesh,
        position: origin.clone(),
        velocity: direction.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
        fuse: GRENADE_FUSE,
        onExplode,
      });
      return true;
    },
    grenadeRadius() {
      return GRENADE_RADIUS;
    },
    grenadeDamage() {
      return GRENADE_DAMAGE;
    },
  };
}
