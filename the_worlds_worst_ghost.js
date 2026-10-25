'use strict';
// cv = canvas, ctx = 2d. i keep meaning to rename these but it works.
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const sndBtn = document.getElementById('snd');
const pzBtn = document.getElementById('pz');
const ov = document.getElementById('ov');
const noteEl = document.getElementById('note');

let W, H, dpr = 1, keys = {};

const st = {
  mode: 'title', level: 1, xp: 0, souls: 0, trauma: 0, clock: 0, mute: false,
  dashCd: 0, dashT: 0, inv: 0, stealCd: 0, sinceEat: 0, chain: 0, chainT: 0,
  respawnCd: 0, endT: 0, freeze: 0
};

const g = {
  x: 170, y: 470, r: 8.5, vx: 0, vy: 0, wob: 0, squash: 0,
  chomp: 0, spin: 0, look: 0, lx: 1, ly: 0, tr: 8.5
};

let rats = [], scraps = [], pops = [], trail = [], AC = null;

const SOULS = {
  wisp: { r: 5, xp: 2 },
  soul: { r: 8.5, xp: 6 },
  great: { r: 12.5, xp: 14 }
};

const RAT = { steal: 8, cd: 6, speed: 45 };
const GATE = { x0: 900, y0: 447, hp: 12, cd: 0, hitT: 0 };

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist(a, b, c, d) { return Math.hypot(a - c, b - d); }
function rnd() { return Math.random(); }
function needXP(l) { return Math.round(20 * Math.pow(1.5, l - 1)); }
function spawnSoul(t, x, y) {
  scraps.push({ t, x, y, r: SOULS[t].r, live: true, s: rnd() * 999, l: (rnd() - .5) * .2 });
}
function spawnRats(n) {
  for (let i = 0; i < n; i++) {
    rats.push({ x: rnd() * W, y: rnd() * H, ph: rnd() * 6.28, m: 'wander', f: 0, cd: 0 });
  }
}
function ensureAC() {
  if (!AC) {
    AC = new(window.AudioContext || window.webkitAudioContext);
    if (AC.state === 'suspended') AC.resume();
  }
}
function beep(f0, f1, d, tp, v) {
  if (st.mute || !AC) return;
  const tt = AC.currentTime;
  const o = AC.createOscillator();
  const e = AC.createGain();
  o.type = tp || 'sine';
  o.frequency.setValueAtTime(f0, tt);
  o.frequency.exponentialRampToValueAtTime(f1 || f0, tt + d);
  e.gain.setValueAtTime(v || .1, tt);
  e.gain.exponentialRampToValueAtTime(.001, tt + d);
  o.connect(e);
  e.connect(AC.destination);
  o.start(tt);
  o.stop(tt + d);
}
function pop(x, y, txt, c) { pops.push({ x, y, txt, c, t: 0 }); }
function eatSoul(s) {
  s.live = false;
  st.souls++;
  st.sinceEat = 0;
  g.chomp = 1;
  g.squash = 1;
  st.chain = st.chainT > 0 ? st.chain + 1 : 1;
  st.chainT = 2.4;
  const xp = Math.round(SOULS[s.t].xp * (1 + Math.min(4, st.chain - 1) * .08));
  st.xp += xp;
  pop(s.x, s.y, (st.chain >= 3 ? 'x' + st.chain : '') + '+' + xp, '#00ff88');
  beep(430 + st.level * 24 + Math.min(6, st.chain) * 26, 190, .09, 'triangle', .045);
  levelUps();
}
function ratSteal(rt) {
  const lost = Math.min(st.xp, RAT.steal);
  st.xp -= lost;
  rt.cd = RAT.cd;
  rt.f = 4;
  rt.m = 'flee';
  st.stealCd = 4;
  pop(rt.x, rt.y - 18, '-' + lost + ' xp', '#ff6666');
  beep(600, 140, .14, 'sawtooth', .05);
  st.trauma = Math.min(1, st.trauma + .3);
}
function doBurst() {
  if (st.mode !== 'play' || st.dashCd > 0) return;
  if (st.xp < 5) {
    pop(g.x, g.y - 18, 'dash needs 5 souls', '#ff6666');
    return;
  }
  st.xp -= 5;
  st.dashCd = 1.9;
  st.dashT = .28;
  rats.forEach(r => { if (dist(g.x, g.y, r.x, r.y) < 150) r.f = 3; });
  beep(520, 120, .18, 'sawtooth', .05);
}
function ramGate() {  if (GATE.cd > 0) return;
  GATE.cd = .9;
  GATE.hitT = .4;
  st.freeze = .06;  const dmg = Math.round(4 + g.tr * .95);
  GATE.hp -= dmg;  pop(g.x + 30, g.y - g.r - 16, GATE.hp > 0 ? GATE.hp + ' to go' : 'that was it', GATE.hp > 0 ? '#aaa' : '#ffd700');
  beep(150, 70, .1, 'square', .04);if(GATE.hp<=0){st.mode='end';st.endT=0;ov.style.display='flex';noteEl.innerHTML='<h1>you broke the gates</h1><p>lvl '+st.level+', '+st.souls+' souls, '+Math.floor(st.clock/60)+':'+String(Math.floor(st.clock%60)).padStart(2,'0')+'</p><div class="actions"><button onclick="location.reload()">again</button></div>'}}
function levelUps() {
  // each line is a thing you can now do, not a mood. the old ones all had the same three-word shape and said "surface" twice.
  const n = {
    2: 'space dashes. it costs souls', 3: 'souls are worth more now', 4: 'rats chase harder',
    5: 'great souls start dropping', 6: 'rats will find you', 7: 'the gates are open. almost',
    8: 'the gates are waiting'
  };
  while (st.xp >= needXP(st.level) && st.level < 8) {
    st.xp -= needXP(st.level);
    st.level++;
    pop(g.x, g.y - 30, 'lvl ' + st.level + ' · ' + n[st.level], '#ffd700');
    beep(95, 38, .22, 'sine', .09);
    beep(190, 76, .22, 'triangle', .05);
  }
}
function startGame() {
  ensureAC();
  st.mode = 'play';
  st.level = 1;
  st.xp = 0;
  st.souls = 0;
  st.clock = 0;
  st.trauma = 0;
  scraps = []; rats = []; pops = []; trail = [];
  g.x = 170; g.y = 470; g.r = 8.5; g.tr = 8.5;
  spawnRats(3);
  for (let i = 0; i < 8; i++) spawnSoul('wisp', rnd() * W, rnd() * H);
  ov.style.display = 'none';
  requestAnimationFrame(loop);
}
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); doBurst(); }
  if (e.code === 'KeyP') { st.mode = st.mode === 'play' ? 'pause' : 'play'; pzBtn.disabled = st.mode !== 'play'; }
  if ((e.code === 'Enter' || e.code === 'Space') && st.mode === 'title') startGame();
  if (e.code === 'KeyM') { st.mute = !st.mute; sndBtn.textContent = 'sound: ' + (st.mute ? 'off' : 'on'); }
});

window.addEventListener('keyup', e => { keys[e.code] = false; });

sndBtn.onclick = () => {
  st.mute = !st.mute;
  sndBtn.textContent = 'sound: ' + (st.mute ? 'off' : 'on');
};

pzBtn.onclick = () => {
  st.mode = st.mode === 'play' ? 'pause' : 'play';
  pzBtn.disabled = st.mode !== 'play';
};
let last = 0;
function loop(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, .1);

  if (st.mode === 'play') {
    st.clock += dt;
    st.dashCd = Math.max(0, st.dashCd - dt);
    st.dashT = Math.max(0, st.dashT - dt);
    st.chainT = Math.max(0, st.chainT - dt);
    if (st.chainT <= 0) st.chain = 0;
    st.inv = Math.max(0, st.inv - dt);
    st.stealCd = Math.max(0, st.stealCd - dt);
    st.respawnCd = Math.max(0, st.respawnCd - dt);
    GATE.cd = Math.max(0, GATE.cd - dt);
    GATE.hitT = Math.max(0, GATE.hitT - dt);
    g.chomp = Math.max(0, g.chomp - dt * 4);
    g.squash = Math.max(0, g.squash - dt * 4);

    let ax = 0, ay = 0;
    if (keys['ArrowLeft'] || keys['KeyA']) ax = -1;
    if (keys['ArrowRight'] || keys['KeyD']) ax = 1;
    if (keys['ArrowUp'] || keys['KeyW']) ay = -1;
    if (keys['ArrowDown'] || keys['KeyS']) ay = 1;
    if (ax || ay) {
      const m = 1 / Math.sqrt(ax * ax + ay * ay);
      ax *= m;
      ay *= m;
    }

    const spd = st.dashT > 0 ? 220 : 90;
    g.vx = ax * spd;
    g.vy = ay * spd;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    g.x = clamp(g.x, 46, W - 46);
    g.y = clamp(g.y, 104, H - 46);
    if (g.r < 0) g.r = 0; // leftover guard, never triggers

    g.wob += dt * (4 + Math.hypot(g.vx, g.vy) * 7);

    scraps.forEach(s => {
      if (!s.live) return;
      if (dist(g.x, g.y, s.x, s.y) < g.r + s.r) eatSoul(s);
    });

    rats.forEach(r => {
      if (r.f > 0) r.f -= dt;
      const tg = r.f > 0 ? { x: g.x + 100, y: g.y + 100 } : g;
      const dx = tg.x - r.x, dy = tg.y - r.y, d = Math.hypot(dx, dy) || 1;
      const sp = r.f > 0 ? RAT.speed * 1.5 : RAT.speed;
      r.x += (dx / d) * sp * dt;
      r.y += (dy / d) * sp * dt;
      if (dist(g.x, g.y, r.x, r.y) < g.r + 12 && st.inv <= 0) {
        if (st.xp > 0) ratSteal(r);
        st.inv = 1.5;
        g.squash = .5;
      }
    });

    if (st.level >= 8 && dist(g.x, g.y, GATE.x0, GATE.y0) < g.r + 30) ramGate();

    if (st.respawnCd <= 0 && scraps.length < 6) {
      spawnSoul(st.level >= 5 && rnd() < .3 ? 'great' : st.level >= 3 ? 'soul' : 'wisp', rnd() * (W - 100) + 50, rnd() * (H - 120) + 110);
      st.respawnCd = 2 + rnd() * 3;
    }

    trail.push({ x: g.x, y: g.y, t: 0 });
    if (trail.length > 12) trail.shift();
    trail.forEach(t => t.t += dt);
    trail = trail.filter(t => t.t < .3);

    pops.forEach(p => { p.t += dt; p.y -= 20 * dt; });
    pops = pops.filter(p => p.t < 1);
  } else if (st.mode === 'end') {
    st.endT += dt;
  }

  draw();
  requestAnimationFrame(loop);
}
function draw() {  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fcfbfc';
  ctx.fillRect(0, 0, W, H);  const GY = H - 46;
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GY);
  ctx.lineTo(W, GY);
  ctx.stroke();  if (st.level >= 8) {
    ctx.fillStyle = GATE.hp <= 0 ? '#ffd700' : '#888';
    ctx.fillRect(GATE.x0 - 26, GY - 60, 52, 60);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.strokeRect(GATE.x0 - 26, GY - 60, 52, 60);
    ctx.fillStyle = '#222';
    ctx.font = '12px monospace';
    ctx.fillText('GATES', GATE.x0 - 22, GY - 20);
    } scraps.forEach(s => {
    if (!s.live) return;
    ctx.fillStyle = s.t === 'great' ? '#ffd700' : s.t === 'soul' ? '#4a90e9' : '#88c';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, 6.28);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  });  rats.forEach(r => {
    ctx.fillStyle = r.m === 'flee' ? '#ff6666' : '#666';
    ctx.beginPath();
    ctx.arc(r.x, r.y, 10, 0, 6.28);
    ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1;
    ctx.stroke();
  });  const sz = g.r * (1 + Math.sin(g.wob) * .02) * (1 + g.squash * .06);
  ctx.fillStyle = '#f0e9d8';
  ctx.beginPath();
  ctx.arc(g.x, g.y, sz, 0, 6.28);
  ctx.fill();
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(g.x + g.lx * sz * .4, g.y + g.ly * sz * .4, sz * .25, 0, 6.28);
  ctx.fill();

  trail.forEach(t => {    ctx.globalAlpha = 1 - t.t / .3;
    ctx.fillStyle = '#ccc';
    ctx.beginPath();
    ctx.arc(t.x, t.y, 3, 0, 6.28);
    ctx.fill();
    });
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#222';
  ctx.font = '12px sans-serif';
    pops.forEach(p => {
    ctx.globalAlpha = 1 - p.t;
    ctx.fillText(p.txt, p.x, p.y - p.t * 40);
    });
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#222';
  ctx.font = '13px sans-serif';
  ctx.fillText('lvl ' + st.level + ' xp ' + st.xp + '/' + needXP(st.level) + ' souls ' + st.souls + ' chain ' + (st.chain > 1 ? 'x' + st.chain : ''), 10, 24);  if (st.level >= 8) ctx.fillText('go and hit them', 10, 44);

  if (st.mode === 'title') {    ctx.fillStyle = 'rgba(0, 0, 0, .35)';    ctx.fillRect(0, 0, W, H);    ctx.fillStyle = '#222';    ctx.font = 'bold 30px sans-serif';    ctx.textAlign = 'center';ctx.fillText("the world's worst ghost", W / 2, H / 2 - 20);    ctx.font = '14px sans-serif';    ctx.fillText('press enter to start', W / 2, H / 2 + 20);    ctx.fillText('wasd or arrows to move. space to dash. p pauses, m mutes.', W / 2, H / 2 + 42);
    ctx.fillText('dashing burns souls.', W / 2, H / 2 + 62);ctx.textAlign = 'left';
  }

  if (st.mode === 'pause') {    ctx.fillStyle = 'rgba(0, 0, 0, .45)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#222';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('paused', W / 2, H / 2);
    ctx.textAlign = 'left';
  }
}
cv.width = innerWidth;
cv.height = innerHeight;
W = cv.width;
H = cv.height;
window.addEventListener('resize', () => {
  cv.width = innerWidth;
  cv.height = innerHeight;
  W = cv.width;
  H = cv.height;
});
requestAnimationFrame(loop);
