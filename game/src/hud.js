// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// round banner, buy menu and the one overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Values are only written
// when they change, so the DOM is not touched every frame.
const COPY = {
  start: {
    title: 'Ember Yard',
    copy: 'Ember attacks, Vigil defends. Plant the charge at Site A or Site B, or wipe the other team out. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Ember Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Range over',
    copy: 'The match is decided.',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammo = $('ammo');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const roundValue = $('round-value');
  const objectiveValue = $('objective-value');
  const weaponValue = $('weapon-value');
  const grenadeValue = $('grenade-value');
  const hitmarker = $('hitmarker');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  const plantWrap = $('plant-progress');
  const plantFill = $('plant-fill');
  const vignette = $('vignette');
  const crosshair = $('crosshair');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(element, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    element.textContent = value;
  }

  return {
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      setText(healthValue, 'health', String(Math.max(0, Math.ceil(health))));
      setText(armorValue, 'armor', armor > 0 ? `+${Math.ceil(armor)}` : '');
      healthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
      healthBar.classList.toggle('low', health <= 30);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
    },
    setTimer(seconds) {
      const clamped = Math.max(0, Math.ceil(seconds));
      const minutes = Math.floor(clamped / 60);
      const rest = String(clamped % 60).padStart(2, '0');
      setText(timerValue, 'timer', `${minutes}:${rest}`);
      timerValue.classList.toggle('urgent', clamped <= 10);
    },
    setScore(attack, defend) {
      setText(scoreValue, 'score', `${attack} — ${defend}`);
    },
    setRound(round) {
      setText(roundValue, 'round', `ROUND ${round}`);
    },
    setObjective(text) {
      setText(objectiveValue, 'objective', text);
    },
    setWeapon(name, grenades) {
      setText(weaponValue, 'weapon', name);
      setText(grenadeValue, 'grenades', grenades > 0 ? `◉ ${grenades}` : '◉ 0');
    },
    setCrosshairSpread(spreadPx) {
      const gap = Math.max(3, Math.min(26, Math.round(spreadPx)));
      crosshair.style.setProperty('--gap', `${gap}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    banner(heading, sub) {
      bannerTitle.textContent = heading;
      bannerSub.textContent = sub;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), 2600);
    },
    clearBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    showBuyMenu(items, money, onBuy) {
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = money < item.price;
        row.innerHTML = `<span>${item.label}</span><span>$${item.price}</span>`;
        row.addEventListener('click', () => onBuy(item.id));
        buyList.appendChild(row);
      }
      buyMenu.hidden = false;
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    setPlantProgress(progress) {
      if (progress <= 0) {
        plantWrap.hidden = true;
        return;
      }
      plantWrap.hidden = false;
      plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showOverlay(mode, score) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'end' ? `${text.copy} Ember ${score.attack} — ${score.defend} Vigil.` : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
