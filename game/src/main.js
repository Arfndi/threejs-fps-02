// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. The sim owns the player, the bots, the rounds, the charge and the grenades;
// rendering only draws what the sim says. ?shot=start|play|site|end with &seed=N sets
// up a deterministic frame for a capture, renders it twice, then freezes it and sets
// window.__shotReady. ?demo=1 starts a round without pointer lock, for headless tests.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, SITES, SPAWNS, collidesAt } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, BUY_MENU } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const demo = params.get('demo') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const weapons = createWeapons(camera, scene);

// The player is one body with one set of numbers: health, armour, money and the weapons
// they own. Everything the HUD shows comes from here.
const playerState = {
  health: 100,
  armor: 0,
  alive: true,
  owned: new Set(['pistol']),
  spawnIndex: 0,
};
const player = createPlayer(world.colliders, SPAWNS.attack[0]);
const body = player.state;
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const _chargePos = new THREE.Vector3();
const match = { time: 0, phase: 'buy', targetSite: 'A', chargePlanted: false, chargePos: null };
const playerInfo = { alive: true, team: 'attack', position: null, crouching: false, moving: false };
const tracers = [];
const explosions = [];
const tracerMaterialBase = new THREE.Color(0xffd9a0);

let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let stepCount = 0;
let footstepTimer = 0;
let nextBeep = 0;
let chargeMesh = null;
let chargeLight = null;

// The charge: a small blinking box that appears on the site once planted.
{
  chargeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.35),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.2 }),
  );
  chargeMesh.position.y = 0.2;
  chargeMesh.visible = false;
  chargeMesh.castShadow = true;
  scene.add(chargeMesh);
  chargeLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 9);
  scene.add(chargeLight);
}

const rounds = createRounds(random, {
  onRoundStart(round, targetSite) {
    bots.reset(targetSite);
    respawnPlayer();
    hud.setRound(round);
    hud.setScore(rounds.state.scoreAttack, rounds.state.scoreDefend);
    hud.setObjective(`Plant the charge at Site ${targetSite} — ${SITES[targetSite].name}`);
    hud.banner(`Round ${round}`, `Site ${targetSite}: ${SITES[targetSite].name}`);
    hud.hideBuyMenu();
    updateHud();
  },
  onRoundEnd(winner, reason) {
    const won = winner === 'attack';
    hud.banner(won ? 'Round won' : 'Round lost', roundReasonText(reason, won));
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setScore(rounds.state.scoreAttack, rounds.state.scoreDefend);
    hud.setMoney(rounds.state.money);
    hud.hideBuyMenu();
  },
  onPlant(site) {
    const siteDef = SITES[site];
    chargeMesh.position.set(siteDef.x, 0.2, siteDef.z);
    chargeMesh.visible = true;
    chargeLight.position.set(siteDef.x, 1.2, siteDef.z);
    chargeLight.intensity = 8;
    hud.banner('Charge planted', `Site ${site} — ${CHARGE_SECONDS_TEXT}`);
    hud.setObjective(`Charge planted at Site ${site} — defend it`);
    audio.plant();
    nextBeep = elapsed + 1;
  },
  onDefuse() {
    chargeMesh.visible = false;
    chargeLight.intensity = 0;
    hud.setObjective('Charge defused');
    audio.defuse();
  },
  onDetonate() {
    chargeMesh.visible = false;
    chargeLight.intensity = 0;
    explodeAt(new THREE.Vector3(rounds.state.chargePos.x, 0.6, rounds.state.chargePos.z), null);
    hud.setObjective('Charge detonated');
  },
  onMatchEnd(winner) {
    const text = winner === 'attack' ? 'Ember takes the match'
      : winner === 'defend' ? 'Vigil takes the match' : 'A drawn match';
    hud.banner(text, `Ember ${rounds.state.scoreAttack} — ${rounds.state.scoreDefend} Vigil`);
    hud.showOverlay('end', { attack: rounds.state.scoreAttack, defend: rounds.state.scoreDefend });
    if (document.pointerLockElement) document.exitPointerLock();
  },
});
const CHARGE_SECONDS_TEXT = '35 seconds to detonation';

function roundReasonText(reason, won) {
  if (reason === 'eliminated') return won ? 'Vigil wiped out' : 'Ember wiped out';
  if (reason === 'detonated') return 'The charge blew Site ' + rounds.state.chargeSite;
  if (reason === 'defused') return 'Vigil defused the charge';
  if (reason === 'time') return 'Time ran out — no plant';
  return reason;
}

const bots = createBots(scene, world, random, {
  onShot(bot, from, to) {
    addTracer(from, to);
    audio.distantShot();
  },
  onPlayerDamaged(amount, bot) {
    damagePlayer(amount, bot.name);
  },
  onKill(victim, attacker) {
    const attackerName = attacker === playerState ? 'You'
      : attacker && attacker.name ? attacker.name : 'Unknown';
    if (victim.team === 'defend') {
      hud.killFeed(`${attackerName} ▸ ${victim.name}`);
    } else {
      hud.killFeed(`${attackerName} ▸ ${victim.name}`);
    }
    if (attacker && attacker === playerState) {
      rounds.addKill();
      hud.setMoney(rounds.state.money);
      audio.kill();
    }
  },
  onPlantComplete(site, bot) {
    rounds.botPlant(site);
    hud.killFeed(`${bot.name} planted the charge at Site ${site}`);
  },
  onDefuseComplete(bot) {
    rounds.botDefuse();
    hud.killFeed(`${bot.name} defused the charge`);
  },
});

function respawnPlayer() {
  const spawn = SPAWNS.attack[playerState.spawnIndex % SPAWNS.attack.length];
  playerState.spawnIndex += 1;
  player.respawn(spawn, 0);
  playerState.health = 100;
  playerState.armor = 0;
  playerState.alive = true;
  weapons.refill(weapons.state.current);
  updateHud();
}

function damagePlayer(amount, sourceName) {
  if (shot) return; // captures are staged: the player is invulnerable while shooting them
  if (!playerState.alive) return;
  let dealt = amount;
  if (playerState.armor > 0) {
    const absorbed = Math.min(playerState.armor, Math.round(dealt * 0.5));
    playerState.armor -= absorbed;
    dealt -= absorbed;
  }
  playerState.health -= dealt;
  hud.damageFlash();
  audio.hurt();
  updateHud();
  if (playerState.health <= 0) {
    playerState.health = 0;
    playerState.alive = false;
    rounds.addDeath();
    hud.killFeed(`${sourceName} ▸ You`);
    hud.banner('You were eliminated', 'Spectating Ember — the round plays on');
    if (document.pointerLockElement) document.exitPointerLock();
    updateHud();
  }
}

function addTracer(from, to) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: tracerMaterialBase, transparent: true, opacity: 0.85,
  });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  tracers.push({ line, life: 0.09 });
}

function explodeAt(position, attacker) {
  audio.explosion();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false }),
  );
  mesh.position.copy(position);
  scene.add(mesh);
  explosions.push({ mesh, life: 0.45 });
  const flash = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 18, 1.5);
  flash.position.copy(position).y += 1;
  scene.add(flash);
  explosions.push({ mesh: flash, life: 0.25, light: true });
  const radius = weapons.grenadeRadius();
  const damage = weapons.grenadeDamage();
  bots.damageAllInRadius(position, radius, damage, attacker);
  if (playerState.alive) {
    const distance = Math.hypot(body.position.x - position.x, body.position.z - position.z);
    if (distance < radius) {
      damagePlayer(Math.round(damage * (1 - (distance / radius) * 0.6)), 'Grenade');
    }
  }
}

function updateHud() {
  hud.setHealth(playerState.health, playerState.armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.scoreAttack, rounds.state.scoreDefend);
  hud.setWeapon(weapons.def().name, weapons.state.grenades);
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const def = weapons.def();
  let end;
  if (hit) {
    end = hit.point.clone();
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part;
      const damage = Math.round(def.damage * (part === 'head' ? def.headMult : 1));
      const killed = bots.damageBot(bot, damage, part, playerState);
      hud.hitMarker(killed, shot ? 4000 : 90);
      if (killed) audio.kill();
      else audio.hit();
      if (killed) hud.killFeed(`You ▸ ${bot.name}`);
    }
  } else {
    end = camera.position.clone().addScaledVector(direction, def.range);
  }
  addTracer(camera.position.clone().addScaledVector(direction, 0.6), end);
  weapons.pullTrigger();
  player.recoil(0.011 + random() * 0.005, (random() * 2 - 1) * 0.005);
  audio.shot(def.kind);
  bots.hearShot(body.position);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve);
  return true;
}

function tryBuy(id) {
  const item = rounds.buy(id);
  if (!item) return;
  if (item.kind === 'weapon') {
    playerState.owned.add(item.id);
    weapons.equip(item.id);
    hud.killFeed(`Bought ${item.label} — $${item.price}`);
  } else if (item.kind === 'grenade') {
    weapons.state.grenades += 1;
    hud.killFeed(`Bought a frag grenade — $${item.price}`);
  } else if (item.kind === 'armor') {
    playerState.armor = 100;
    hud.killFeed(`Bought kevlar — $${item.price}`);
  }
  audio.beep();
  updateHud();
  if (rounds.state.phase === 'buy') hud.showBuyMenu(BUY_MENU, rounds.state.money, tryBuy);
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  stepCount += 1;
  // Reused across steps: the match snapshot the bots read, and the player's info.
  match.time = elapsed;
  match.phase = rounds.state.phase;
  match.targetSite = rounds.state.targetSite;
  match.chargePlanted = rounds.state.chargePlanted;
  match.chargePos = rounds.state.chargePos
    ? _chargePos.set(rounds.state.chargePos.x, 0.6, rounds.state.chargePos.z) : null;

  // Charge beeps speed up as detonation nears.
  if (rounds.state.chargePlanted && elapsed >= nextBeep) {
    audio.beep();
    const fraction = 1 - rounds.state.chargeTimer / 35;
    nextBeep = elapsed + 1 - fraction * 0.7;
    chargeMesh.material.emissiveIntensity = 1.2 + fraction * 2;
  }

  rounds.step(dt);
  if (rounds.state.phase === 'live' || rounds.state.phase === 'buy') {
    // Elimination checks (only while a round is running).
    const attackAlive = bots.aliveCount('attack') + (playerState.alive ? 1 : 0);
    const defendAlive = bots.aliveCount('defend');
    if (rounds.state.phase === 'live') {
      if (attackAlive === 0) rounds.endRound('defend', 'eliminated');
      else if (defendAlive === 0 && !rounds.state.chargePlanted) rounds.endRound('attack', 'eliminated');
    }
  }

  if (playerState.alive) {
    player.step(dt, input.state.keys);
    // Footsteps, paced by speed.
    const speed = player.groundSpeed();
    if (speed > 1 && player.onGround) {
      footstepTimer -= dt * speed;
      if (footstepTimer <= 0) {
        footstepTimer = 2.4;
        audio.step();
      }
    }
    // Planting: hold E inside the target site.
    const site = SITES[rounds.state.targetSite];
    const inSite = Math.hypot(body.position.x - site.x, body.position.z - site.z) < site.radius;
    const holdingE = input.state.keys.has('KeyE');
    const wasPlanting = rounds.state.planting;
    rounds.playerPlant(dt, inSite, holdingE);
    if (rounds.state.planting && !wasPlanting) audio.beep();
    hud.setPlantProgress(rounds.state.planting ? rounds.state.plantProgress / 3.5 : 0);
  }

  weapons.step(dt);
  playerInfo.alive = playerState.alive;
  playerInfo.position = body.position;
  playerInfo.crouching = body.crouching;
  playerInfo.moving = player.groundSpeed() > 1.5;
  bots.step(dt, match, playerInfo);

  // HUD numbers, refreshed from the sim.
  if (rounds.state.phase === 'live') hud.setTimer(rounds.state.timeLeft);
  else if (rounds.state.phase === 'buy') hud.setTimer(rounds.state.freezeLeft);
  else hud.setTimer(0);
  hud.setCrosshairSpread(4 + weapons.spread(player.groundSpeed(), body.crouching) * 900);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const pressed = input.drainPressed();
    for (const code of pressed) {
      if (code === 'KeyB' && rounds.state.phase === 'buy') {
        if (document.getElementById('buy-menu').hidden) hud.showBuyMenu(BUY_MENU, rounds.state.money, tryBuy);
        else hud.hideBuyMenu();
      }
      if (code === 'Digit1' && playerState.owned.has('pistol')) weapons.equip('pistol');
      if (code === 'Digit2' && playerState.owned.has('smg')) weapons.equip('smg');
      if (code === 'Digit3' && playerState.owned.has('rifle')) weapons.equip('rifle');
      if (code === 'KeyG' && playerState.alive && rounds.state.phase === 'live') {
        camera.getWorldDirection(direction);
        const origin = camera.position.clone().addScaledVector(direction, 0.5);
        if (weapons.throwGrenade(origin, direction, (pos) => explodeAt(pos, playerState))) {
          hud.killFeed('Frag out');
          updateHud();
        }
      }
      if (code === 'KeyR') weapons.reload();
    }
    if (started && playerState.alive && input.state.firing && weapons.ready()) {
      shoot(shot ? 0 : weapons.spread(player.groundSpeed(), body.crouching));
    }
    if (input.state.keys.has('KeyR') && !shot) weapons.reload();
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  // Tracers and explosions fade in render time, not sim time.
  for (let i = tracers.length - 1; i >= 0; i -= 1) {
    const tracer = tracers[i];
    tracer.life -= dt;
    if (tracer.life <= 0) {
      scene.remove(tracer.line);
      tracer.line.geometry.dispose();
      tracer.line.material.dispose();
      tracers.splice(i, 1);
    } else {
      tracer.line.material.opacity = (tracer.life / 0.09) * 0.85;
    }
  }
  for (let i = explosions.length - 1; i >= 0; i -= 1) {
    const effect = explosions[i];
    effect.life -= dt;
    if (effect.life <= 0) {
      scene.remove(effect.mesh);
      if (effect.mesh.geometry) effect.mesh.geometry.dispose();
      if (effect.mesh.material) effect.mesh.material.dispose();
      explosions.splice(i, 1);
    } else if (!effect.light) {
      const scale = 1 + (0.45 - effect.life) * 14;
      effect.mesh.scale.setScalar(scale);
      effect.mesh.material.opacity = (effect.life / 0.45) * 0.85;
    }
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function clearTracers() {
  for (const tracer of tracers) {
    scene.remove(tracer.line);
    tracer.line.geometry.dispose();
    tracer.line.material.dispose();
  }
  tracers.length = 0;
}

// Is there a clear line from the camera to this bot's chest? Used by the 'play'
// capture so the frame shows a defender in the open, not a wall.
const _shotTarget = new THREE.Vector3();
function hasClearShot(bot) {
  _shotTarget.set(bot.position.x, bot.position.y + 1.2, bot.position.z);
  const distance = camera.position.distanceTo(_shotTarget);
  direction.copy(_shotTarget).sub(camera.position).normalize();
  raycaster.set(camera.position, direction);
  raycaster.far = distance;
  const hit = raycaster.intersectObjects(world.shootables, false)[0];
  return !hit || hit.distance > distance - 0.4;
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  rounds.startMatch();
  if (name === 'start') {
    // Buy phase at the attacker spawn: the yard, the HUD and the buy menu in one frame.
    body.position.set(2.5, 0, 14);
    body.yaw = 0.05;
    body.pitch = -0.02;
    settle(30);
    hud.showBuyMenu(BUY_MENU, rounds.state.money, tryBuy);
  } else if (name === 'play') {
    // Mid-round: find a defender in the open, step to a spot with a clear line to
    // them, and fire at them.
    rounds.state.freezeLeft = 0;
    settle(10);
    settle(200);
    const offsets = [[0, 8], [8, 0], [-8, 0], [0, -8], [6, 6], [-6, 6], [6, -6], [-6, -6]];
    let defender = null;
    outer: for (const bot of bots.bots) {
      if (!bot.alive || bot.team !== 'defend') continue;
      for (const [ox, oz] of offsets) {
        const px = bot.position.x + ox;
        const pz = bot.position.z + oz;
        if (Math.abs(px) > 19 || Math.abs(pz) > 15) continue;
        if (collidesAt(world.colliders, px, 0, pz, 0.34, 1.72, 0.02)) continue;
        body.position.set(px, 0, pz);
        syncCamera();
        if (hasClearShot(bot)) {
          defender = bot;
          break outer;
        }
      }
    }
    clearTracers();
    if (defender) {
      for (let i = 0; i < 4; i += 1) {
        aimAt(new THREE.Vector3(defender.position.x, defender.position.y + 1.2, defender.position.z));
        shoot(0);
        settle(8);
      }
    }
    hud.clearBanner();
    settle(30);
  } else if (name === 'site') {
    // The charge is planted at Site A and beeping; the player holds the dock.
    rounds.state.freezeLeft = 0;
    settle(10);
    body.position.set(-6, 0, -4);
    settle(120);
    const site = SITES.A;
    rounds.state.targetSite = 'A';
    rounds.state.chargePlanted = true;
    rounds.state.chargeSite = 'A';
    rounds.state.chargePos = { x: site.x, z: site.z };
    rounds.state.chargeTimer = 24;
    chargeMesh.position.set(site.x, 0.2, site.z);
    chargeMesh.visible = true;
    chargeLight.position.set(site.x, 1.2, site.z);
    chargeLight.intensity = 8;
    hud.setObjective('Charge planted at Site A — defend it');
    hud.banner('Charge planted', 'Site A — 35 seconds to detonation');
    aimAt(new THREE.Vector3(site.x, 1.0, site.z));
    clearTracers();
    settle(60);
  } else {
    // Round end: the last defender falls and the banner goes up.
    rounds.state.freezeLeft = 0;
    settle(10);
    for (const bot of bots.bots) {
      if (bot.team === 'defend') bots.damageBot(bot, 999, 'torso', playerState);
    }
    clearTracers();
    settle(30);
    hud.banner('Round won', 'Vigil wiped out');
    settle(20);
  }
  updateHud();
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

hud.onPlay(() => {
  audio.unlock();
  if (rounds.state.phase === 'match') {
    rounds.startMatch();
    bots.reset(rounds.state.targetSite);
    respawnPlayer();
  }
  started = true;
  input.requestLock();
});

function onLockChange(locked) {
  if (shot || demo) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (rounds.state.phase !== 'match') {
    hud.showOverlay(started ? 'paused' : 'start', {
      attack: rounds.state.scoreAttack,
      defend: rounds.state.scoreDefend,
    });
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

rounds.startMatch();
syncCamera();
updateHud();
if (shot) runShot(shot);
else if (demo) {
  started = true;
  hud.hideOverlay();
  requestAnimationFrame(frame);
} else {
  requestAnimationFrame(frame);
}
