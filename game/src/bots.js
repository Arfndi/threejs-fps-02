// Bots: 4v4, teammates and enemies that walk routes, hold sites, see and hear, and
// shoot back. Each bot has one job per frame: look for an enemy, and either walk its
// route or fight. Vision is a range + field-of-view test plus a ray against the world;
// hearing is a radius around every gunshot. Bots fight each other as well as the player.
// Names are original: Ember squad attacks, Vigil squad defends.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { ROUTES, SITES, SPAWNS, collidesAt } from './world.js';

const ATTACK_NAMES = ['Cinder', 'Flint', 'Ash', 'Soot'];
const DEFEND_NAMES = ['Heron', 'Kestrel', 'Wren', 'Osprey'];
const HEALTH = 100;
const BOT_SPEED = 3.6;
const VISION_RANGE = 38;
const VISION_COS = 0.55; // ~57 degrees either side of facing
const HEAR_RADIUS = 22;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.75;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5.0;
const BURST_MIN = 3;
const BURST_MAX = 5;

const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _from = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _targetPos = new THREE.Vector3();

export function createBots(scene, world, rng, events) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = VISION_RANGE;
  const bodyGeometry = new THREE.BoxGeometry(0.55, 0.8, 0.32);
  const headGeometry = new THREE.SphereGeometry(0.16, 12, 10);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.7, 0.2);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);

  const bots = [];
  const hitMeshes = [];
  let now = 0;

  function makeBot(index, team) {
    const isAttack = team === 'attack';
    const name = isAttack ? ATTACK_NAMES[index] : DEFEND_NAMES[index];
    const teamColor = isAttack ? PALETTE.accent : PALETTE.teal;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7, metalness: 0.05 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
    const group = new THREE.Group();
    const torso = new THREE.Mesh(bodyGeometry, bodyMaterial);
    torso.position.y = 1.05;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, darkMaterial);
    head.position.y = 1.62;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), emissive: new THREE.Color(teamColor), emissiveIntensity: 0.8 }));
    visor.position.set(0, 1.62, -0.14);
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.14, 0.35, 0);
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.14, 0.35, 0);
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.2, 1.15, -0.35);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);

    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      group,
      torso,
      head,
      position: new THREE.Vector3(),
      yaw: 0,
      health: HEALTH,
      armor: 0,
      alive: true,
      weapon: isAttack ? 'rifle' : 'rifle',
      mag: 25,
      reserve: 75,
      cooldown: 0,
      reloadLeft: 0,
      route: [],
      routeIndex: 0,
      state: 'route',
      holdYaw: 0,
      holdTimer: 0,
      scanPhase: rng() * Math.PI * 2,
      target: null, // { kind: 'player' | 'bot', ref, pos }
      lastSeen: 0,
      lastKnown: new THREE.Vector3(),
      reactionAt: 0,
      burstLeft: 0,
      burstPause: 0,
      seeTimer: 0,
      actionProgress: 0,
      fall: 0,
      walkPhase: rng() * 6,
      strafeDir: 1,
      strafeTimer: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    return bot;
  }

  for (let i = 0; i < 3; i += 1) bots.push(makeBot(i, 'attack'));
  for (let i = 0; i < 4; i += 1) bots.push(makeBot(i, 'defend'));

  function spawnPoint(bot, index) {
    const list = bot.team === 'attack' ? SPAWNS.attackBots : SPAWNS.defend;
    const point = list[index % list.length];
    return point;
  }

  function reset(targetSite) {
    let attackIndex = 0;
    let defendIndex = 0;
    for (const bot of bots) {
      const index = bot.team === 'attack' ? attackIndex : defendIndex;
      const point = spawnPoint(bot, index);
      bot.position.set(point[0], 0, point[1]);
      bot.yaw = bot.team === 'attack' ? 0 : Math.PI;
      bot.health = HEALTH;
      bot.armor = 0;
      bot.alive = true;
      bot.mag = 25;
      bot.reserve = 75;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.state = 'route';
      bot.target = null;
      bot.actionProgress = 0;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.copy(bot.position);
      bot.group.visible = true;
      if (bot.team === 'attack') {
        attackIndex += 1;
        if (targetSite === 'A') bot.route = index === 2 ? ROUTES.toA2 : ROUTES.toA;
        else bot.route = index === 2 ? ROUTES.toB2 : ROUTES.toB;
      } else {
        defendIndex += 1;
        if (index === 0) bot.route = ROUTES.defendA;
        else if (index === 1) bot.route = ROUTES.defendB;
        else if (index === 2) bot.route = ROUTES.mid;
        else bot.route = ROUTES.defendA;
      }
      bot.routeIndex = 0;
    }
  }

  function hasLineOfSight(from, to) {
    _toTarget.copy(to).sub(from);
    const distance = _toTarget.length();
    if (distance > VISION_RANGE) return false;
    _toTarget.normalize();
    raycaster.set(from, _toTarget);
    raycaster.far = distance;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > distance - 0.4;
  }

  function eyePos(bot, out) {
    out.set(bot.position.x, bot.position.y + 1.5, bot.position.z);
    return out;
  }

  // Find the nearest visible enemy: the player (if on the other team and alive) or an
  // enemy bot. Returns { kind, ref, pos } or null.
  function findEnemy(bot, playerInfo) {
    let best = null;
    let bestDistance = Infinity;
    _from.copy(eyePos(bot, _from));
    // The player.
    if (playerInfo.alive && playerInfo.team !== bot.team) {
      _chest.set(playerInfo.position.x, playerInfo.position.y + (playerInfo.crouching ? 0.8 : 1.2), playerInfo.position.z);
      const distance = _from.distanceTo(_chest);
      if (distance < bestDistance && distance < VISION_RANGE) {
        _toTarget.copy(_chest).sub(_from).normalize();
        const facing = Math.sin(bot.yaw) * -_toTarget.x + Math.cos(bot.yaw) * -_toTarget.z;
        if (facing > VISION_COS || distance < 4) {
          if (hasLineOfSight(_from, _chest)) {
            best = { kind: 'player', ref: playerInfo, pos: _chest.clone() };
            bestDistance = distance;
          }
        }
      }
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      _chest.set(other.position.x, other.position.y + 1.2, other.position.z);
      const distance = _from.distanceTo(_chest);
      if (distance >= bestDistance || distance >= VISION_RANGE) continue;
      _toTarget.copy(_chest).sub(_from).normalize();
      const facing = Math.sin(bot.yaw) * -_toTarget.x + Math.cos(bot.yaw) * -_toTarget.z;
      if (facing > VISION_COS || distance < 4) {
        if (hasLineOfSight(_from, _chest)) {
          best = { kind: 'bot', ref: other, pos: _chest.clone() };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  function moveToward(bot, x, z, dt, speed) {
    const dx = x - bot.position.x;
    const dz = z - bot.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.05) return true;
    const stepX = (dx / length) * speed * dt;
    const stepZ = (dz / length) * speed * dt;
    const nextX = bot.position.x + stepX;
    if (!collidesAt(world.colliders, nextX, 0, bot.position.z, 0.34, 1.72, 0.04)) bot.position.x = nextX;
    const nextZ = bot.position.z + stepZ;
    if (!collidesAt(world.colliders, bot.position.x, 0, nextZ, 0.34, 1.72, 0.04)) bot.position.z = nextZ;
    bot.yaw = Math.atan2(-dx, -dz);
    bot.walkPhase += dt * 9;
    return Math.hypot(x - bot.position.x, z - bot.position.z) < 0.6;
  }

  function faceToward(bot, x, z, dt) {
    const targetYaw = Math.atan2(-(x - bot.position.x), -(z - bot.position.z));
    let diff = targetYaw - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  }

  function shootAt(bot, target, dt) {
    if (bot.reloadLeft > 0) {
      bot.reloadLeft -= dt;
      if (bot.reloadLeft <= 0) {
        const take = Math.min(25 - bot.mag, bot.reserve);
        bot.mag += take;
        bot.reserve -= take;
      }
      return;
    }
    if (bot.cooldown > 0) {
      bot.cooldown -= dt;
      return;
    }
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = BURST_MIN + Math.floor(rng() * (BURST_MAX - BURST_MIN + 1));
      bot.burstPause = 0.25 + rng() * 0.5;
    }
    if (bot.mag <= 0) {
      bot.reloadLeft = 2.0;
      return;
    }
    bot.mag -= 1;
    bot.cooldown = 0.11;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstPause = 0.5 + rng() * 0.7;

    // Aim with error that grows with distance and with the target moving.
    const distance = bot.position.distanceTo(target.pos);
    const error = 0.02 + distance * 0.0035 + (target.kind === 'player' && target.ref.moving ? 0.02 : 0);
    _from.set(bot.position.x + 0.2, bot.position.y + 1.45, bot.position.z - 0.3);
    const hitRoll = rng();
    const accuracy = Math.max(0.18, 0.62 - distance * 0.008 - error * 4);
    let end;
    if (hitRoll < accuracy) {
      end = target.pos.clone();
      const damage = 20 + Math.floor(rng() * 8);
      if (target.kind === 'player') events.onPlayerDamaged(damage, bot);
      else damageBot(target.ref, damage, 'torso', bot);
    } else {
      end = target.pos.clone();
      end.x += (rng() * 2 - 1) * (0.8 + distance * 0.04);
      end.y += (rng() * 2 - 1) * 0.6;
      end.z += (rng() * 2 - 1) * (0.8 + distance * 0.04);
    }
    events.onShot(bot, _from.clone(), end);
  }

  function damageBot(bot, amount, part, attacker) {
    if (!bot.alive) return false;
    let dealt = amount;
    if (part === 'head') dealt = Math.round(amount * 2.6);
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, Math.round(dealt * 0.5));
      bot.armor -= absorbed;
      dealt -= absorbed;
    }
    bot.health -= dealt;
    // Being shot at makes a bot turn toward the threat and fight back.
    if (attacker && attacker.position) {
      bot.lastKnown.copy(attacker.position);
      bot.lastSeen = now;
      if (bot.state !== 'engage') {
        bot.state = 'engage';
        bot.reactionAt = now + REACTION_MIN + rng() * 0.2;
      }
    }
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.fall = 0;
      events.onKill(bot, attacker);
      return true;
    }
    return false;
  }

  function step(dt, match, playerInfo) {
    now = match.time;
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.45);
          bot.group.rotation.x = -bot.fall * 1.5;
        }
        continue;
      }
      bot.group.position.copy(bot.position);
      bot.group.rotation.y = bot.yaw;

      // Objective behaviour first: plant when an attacker reaches its site, defuse
      // when a defender reaches a planted charge.
      if (match.phase === 'live' && !match.chargePlanted && bot.team === 'attack'
        && match.targetSite) {
        const site = SITES[match.targetSite];
        if (Math.hypot(bot.position.x - site.x, bot.position.z - site.z) < site.radius - 0.5
          && bot.state !== 'plant') {
          bot.state = 'plant';
          bot.actionProgress = 0;
        }
      }
      if (match.phase === 'live' && match.chargePlanted && bot.team === 'defend') {
        if (bot.position.distanceTo(match.chargePos) < 2.2 && bot.state !== 'defuse') {
          bot.state = 'defuse';
          bot.actionProgress = 0;
        }
      }

      if (bot.state === 'plant') {
        bot.actionProgress += dt;
        if (bot.actionProgress >= PLANT_TIME) {
          bot.state = 'route';
          bot.actionProgress = 0;
          events.onPlantComplete(match.targetSite, bot);
        }
        continue;
      }
      if (bot.state === 'defuse') {
        bot.actionProgress += dt;
        if (bot.actionProgress >= DEFUSE_TIME) {
          bot.state = 'route';
          bot.actionProgress = 0;
          events.onDefuseComplete(bot);
        }
        continue;
      }

      // Freeze time and round end: bots hold position and scan; they do not move
      // or fight until the round is live.
      if (match.phase !== 'live') {
        bot.yaw += Math.sin(now * 0.5 + bot.scanPhase) * dt * 0.5;
        continue;
      }

      // Look for an enemy every 0.15 s (staggered by bot id hash).
      bot.seeTimer -= dt;
      if (bot.seeTimer <= 0) {
        bot.seeTimer = 0.15;
        const enemy = findEnemy(bot, playerInfo);
        if (enemy) {
          if (bot.state !== 'engage') {
            bot.state = 'engage';
            bot.reactionAt = now + REACTION_MIN + rng() * (REACTION_MAX - REACTION_MIN);
            bot.burstLeft = 0;
          }
          bot.target = enemy;
          bot.lastSeen = now;
          bot.lastKnown.copy(enemy.pos);
        } else if (bot.state === 'engage' && now - bot.lastSeen > 2.0) {
          bot.state = 'route';
          bot.target = null;
        }
      }

      if (bot.state === 'engage' && bot.target) {
        const targetPos = bot.target.kind === 'player'
          ? _targetPos.set(bot.target.ref.position.x, bot.target.ref.position.y + 1.2, bot.target.ref.position.z)
          : _targetPos.set(bot.target.ref.position.x, bot.target.ref.position.y + 1.2, bot.target.ref.position.z);
        faceToward(bot, targetPos.x, targetPos.z, dt);
        if (now >= bot.reactionAt) {
          // Strafe a little while firing so the bot is not a statue.
          bot.strafeTimer -= dt;
          if (bot.strafeTimer <= 0) {
            bot.strafeTimer = 0.8 + rng() * 1.2;
            bot.strafeDir = rng() < 0.5 ? -1 : 1;
          }
          const sideX = Math.cos(bot.yaw) * bot.strafeDir * 0.9 * dt;
          const sideZ = -Math.sin(bot.yaw) * bot.strafeDir * 0.9 * dt;
          if (!collidesAt(world.colliders, bot.position.x + sideX, 0, bot.position.z + sideZ, 0.34, 1.72, 0.04)) {
            bot.position.x += sideX;
            bot.position.z += sideZ;
          }
          bot.target.pos.copy(targetPos);
          shootAt(bot, bot.target, dt);
        }
        continue;
      }

      // Walk the route; defenders hold at the last waypoint and scan instead.
      if (bot.state === 'hold') continue;
      const point = bot.route[bot.routeIndex % bot.route.length];
      if (!point) continue;
      const arrived = moveToward(bot, point[0], point[1], dt, BOT_SPEED);
      if (arrived) {
        bot.routeIndex += 1;
        if (bot.team === 'defend' && bot.routeIndex >= bot.route.length) {
          bot.routeIndex = 0;
          bot.holdTimer = 1.5 + rng() * 2;
          bot.state = 'hold';
        }
      }
    }

    // Hold state is handled above for movement; scan while holding.
    for (const bot of bots) {
      if (!bot.alive || bot.state !== 'hold') continue;
      bot.holdTimer -= dt;
      bot.yaw += Math.sin(now * 0.7 + bot.scanPhase) * dt * 0.9;
      if (bot.holdTimer <= 0) bot.state = 'route';
    }
  }

  // A gunshot is heard: bots in range turn toward the sound and remember it.
  function hearShot(position) {
    for (const bot of bots) {
      if (!bot.alive || bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse') continue;
      if (bot.position.distanceTo(position) < HEAR_RADIUS) {
        bot.lastKnown.copy(position);
        bot.lastSeen = now;
        bot.yaw = Math.atan2(-(position.x - bot.position.x), -(position.z - bot.position.z));
      }
    }
  }

  function damageAllInRadius(position, radius, damage, attacker) {
    const victims = [];
    for (const bot of bots) {
      if (!bot.alive) continue;
      const distance = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
      if (distance > radius) continue;
      const falloff = 1 - (distance / radius) * 0.6;
      if (damageBot(bot, Math.round(damage * falloff), 'torso', attacker)) victims.push(bot);
    }
    return victims;
  }

  return {
    bots,
    hitMeshes,
    reset,
    step,
    hearShot,
    damageBot,
    damageAllInRadius,
    aliveCount(team) {
      return bots.filter((bot) => bot.alive && bot.team === team).length;
    },
    plantSiteBot() {
      return bots.find((bot) => bot.alive && bot.team === 'attack' && bot.state === 'plant') ?? null;
    },
  };
}
