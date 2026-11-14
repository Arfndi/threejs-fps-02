// Rounds and the economy: freeze time with a buy menu, a 100-second live round, and
// the charge. Ember attacks, Vigil defends; a round ends by elimination, by the charge
// detonating, by a defuse, or by the clock. Money is earned per round and per kill and
// spent between rounds. First to 7 rounds takes the match.
import { SITES } from './world.js';
import { GRENADE_PRICE, ARMOR_PRICE, WEAPONS } from './weapons.js';

const FREEZE_SECONDS = 12;
const ROUND_SECONDS = 100;
const CHARGE_SECONDS = 35;
const END_SECONDS = 4;
const WIN_ROUNDS = 7;
const MAX_ROUNDS = 13;
const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const KILL_MONEY = 300;
const PLANT_MONEY = 300;
const START_MONEY = 800;
const PLANT_TIME = 3.5;

export const BUY_MENU = [
  { id: 'rifle', label: 'Longhorn rifle', price: WEAPONS.rifle.price, kind: 'weapon' },
  { id: 'smg', label: 'Hornet SMG', price: WEAPONS.smg.price, kind: 'weapon' },
  { id: 'grenade', label: 'Frag grenade', price: GRENADE_PRICE, kind: 'grenade' },
  { id: 'armor', label: 'Kevlar vest', price: ARMOR_PRICE, kind: 'armor' },
];

export function createRounds(rng, events) {
  const state = {
    phase: 'buy', // 'buy' | 'live' | 'end' | 'match'
    round: 0,
    scoreAttack: 0,
    scoreDefend: 0,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    targetSite: 'A',
    chargePlanted: false,
    chargeSite: null,
    chargePos: null,
    chargeTimer: 0,
    timeLeft: ROUND_SECONDS,
    freezeLeft: FREEZE_SECONDS,
    endTimer: 0,
    endReason: '',
    endWinner: null,
    matchWinner: null,
    plantProgress: 0,
    planting: false,
  };

  function startRound() {
    state.round += 1;
    state.targetSite = rng() < 0.5 ? 'A' : 'B';
    state.chargePlanted = false;
    state.chargeSite = null;
    state.chargePos = null;
    state.chargeTimer = 0;
    state.timeLeft = ROUND_SECONDS;
    state.freezeLeft = FREEZE_SECONDS;
    state.endTimer = 0;
    state.endReason = '';
    state.endWinner = null;
    state.plantProgress = 0;
    state.planting = false;
    state.phase = 'buy';
    events.onRoundStart(state.round, state.targetSite);
  }

  function startMatch() {
    state.round = 0;
    state.scoreAttack = 0;
    state.scoreDefend = 0;
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    state.matchWinner = null;
    startRound();
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'match') return;
    state.phase = 'end';
    state.endWinner = winner;
    state.endReason = reason;
    state.endTimer = END_SECONDS;
    if (winner === 'attack') {
      state.scoreAttack += 1;
      state.money += WIN_MONEY;
    } else {
      state.scoreDefend += 1;
      state.money += LOSS_MONEY;
    }
    events.onRoundEnd(winner, reason);
  }

  function step(dt) {
    if (state.phase === 'buy') {
      state.freezeLeft -= dt;
      if (state.freezeLeft <= 0) {
        state.phase = 'live';
        state.timeLeft = ROUND_SECONDS;
      }
      return;
    }
    if (state.phase === 'live') {
      state.timeLeft -= dt;
      if (state.chargePlanted) {
        state.chargeTimer -= dt;
        if (state.chargeTimer <= 0) {
          events.onDetonate();
          endRound('attack', 'detonated');
          return;
        }
      } else if (state.timeLeft <= 0) {
        endRound('defend', 'time');
        return;
      }
      return;
    }
    if (state.phase === 'end') {
      state.endTimer -= dt;
      if (state.endTimer <= 0) {
        if (state.scoreAttack >= WIN_ROUNDS || state.scoreDefend >= WIN_ROUNDS
          || state.round >= MAX_ROUNDS) {
          state.phase = 'match';
          state.matchWinner = state.scoreAttack > state.scoreDefend ? 'attack'
            : state.scoreDefend > state.scoreAttack ? 'defend' : 'draw';
          events.onMatchEnd(state.matchWinner);
        } else {
          startRound();
        }
      }
    }
  }

  // The player plants by holding E inside the target site. Moving or taking damage
  // interrupts it; the progress bar is the HUD's to show.
  function playerPlant(dt, inSite, holding) {
    if (state.phase !== 'live' || state.chargePlanted) {
      state.plantProgress = 0;
      state.planting = false;
      return;
    }
    if (inSite && holding) {
      state.planting = true;
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) {
        state.plantProgress = 0;
        state.planting = false;
        state.chargePlanted = true;
        state.chargeSite = state.targetSite;
        const site = SITES[state.targetSite];
        state.chargePos = { x: site.x, z: site.z };
        state.chargeTimer = CHARGE_SECONDS;
        state.money += PLANT_MONEY;
        events.onPlant(state.targetSite);
      }
    } else {
      state.planting = false;
      state.plantProgress = 0;
    }
  }

  function botPlant(site) {
    if (state.phase !== 'live' || state.chargePlanted) return;
    state.chargePlanted = true;
    state.chargeSite = site;
    const siteDef = SITES[site];
    state.chargePos = { x: siteDef.x, z: siteDef.z };
    state.chargeTimer = CHARGE_SECONDS;
    events.onPlant(site);
  }

  function botDefuse() {
    if (!state.chargePlanted) return;
    state.chargePlanted = false;
    state.chargeSite = null;
    state.chargePos = null;
    events.onDefuse();
    endRound('defend', 'defused');
  }

  function addKill() {
    state.kills += 1;
    state.money += KILL_MONEY;
  }

  function addDeath() {
    state.deaths += 1;
  }

  function buy(id) {
    const item = BUY_MENU.find((entry) => entry.id === id);
    if (!item || state.phase !== 'buy' || state.money < item.price) return null;
    state.money -= item.price;
    return item;
  }

  return {
    state,
    startMatch,
    startRound,
    endRound,
    step,
    playerPlant,
    botPlant,
    botDefuse,
    addKill,
    addDeath,
    buy,
  };
}
