const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const WORLD = 10000;
const FOOD_N = 900;
const VIRUS_N = 55;
const LOBBY = 46;
const MIN_BOTS = 28;
const MIN_MASS = 10;
const SPLIT_MIN = 35;
const EJECT_COST = 18;
const EJECT_GAIN = 14;
const EJECT_MIN = 35;
const EAT_ONE = 1.11;
const EAT_SPLIT = 1.28;
const VIRUS_POP = 130;
const VIRUS_FEEDS = 7;
const MAX_CELLS = 16;
const MAX_CELL = 22500;
const BOT_MAX_MASS = 12000;
const SPLIT_BOOST = 30;
const GHOST_MS = 900;
const TICK = 1000 / 30;
const COLORS = ['#ff5d73','#ff8a5b','#ffd166','#7cffb2','#4ad0ff','#6ee7ff','#8b7cff','#ff6bcb','#c3f584','#70e0c0'];
const SKINS = ['chrome','glass','mangrove','surge','manatee','dawn','rust','copper','drydock','flame','bilge','weld','tarpon','cuda','shark','lionfish','gator','osprey','blackwater','nebula','comet','eclipse','phosphor','venom','jaw','lava','hotsauce','cotton','king','ghost','pearl','trophy','ice','coral','plasma','honey','midnight','magma'];
const BOT_NAMES = ['Wraith','Jelly','Orca','Piranha','Nebula','Comet','Viper','Sable','Nova','Echo','Haze','Blitz','Koi','Drift','Rogue','Mango','Cinder','Polar','Glimmer','Titan','Nix','Bolt','Harbor','Reef','Sundog','Quill','Brine','Maple','Apex','Fathom','Zinc','Ivy','Scorch','Lumen','Prowler','Nimbus','Grit','Riptide','Ember','Mirage','Osprey','Dune','Wisp','Thorn','Pulse','Marlin','Cobalt','Pike'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const massToR = m => 4 + Math.sqrt(Math.max(0, Math.min(m, MAX_CELL))) * 6;
const speedOf = m => 3.15 * Math.pow(MIN_MASS / Math.max(m, MIN_MASS), 0.32);
const mergeMs = m => (30 + 0.02 * Math.max(m, MIN_MASS)) * 1000;
const eatNeed = p => (p.cells && p.cells.length > 1) ? EAT_SPLIT : EAT_ONE;

function spawnPos(near) {
  if (near) {
    const a = rand(0, Math.PI * 2), d = rand(400, 1600);
    return { x: clamp(near.x + Math.cos(a) * d, 240, WORLD - 240), y: clamp(near.y + Math.sin(a) * d, 240, WORLD - 240) };
  }
  return { x: rand(200, WORLD - 200), y: rand(200, WORLD - 200) };
}

function makeCell(x, y, mass, extra = {}) {
  const now = Date.now();
  return {
    x, y, mass, r: massToR(mass),
    vx: 0, vy: 0, bx: 0, by: 0,
    mergeAt: extra.mergeAt != null ? extra.mergeAt : now,
    ghostUntil: extra.ghostUntil || 0,
  };
}

function makeFood(p) {
  p = p || spawnPos();
  const big = Math.random() < 0.08;
  return { x: p.x, y: p.y, mass: big ? rand(3, 8) : 1, r: big ? 7.4 : 5.2, color: pick(COLORS), pellet: false };
}

function makeVirus(p) {
  p = p || spawnPos();
  return { x: p.x, y: p.y, mass: 100, r: massToR(100), spikes: 14, feeds: 0, flying: false, vx: 0, vy: 0 };
}

function totalMass(p) { return p.cells.reduce((s, c) => s + c.mass, 0); }
function centroid(p) {
  let m = 0, x = 0, y = 0;
  for (const c of p.cells) { x += c.x * c.mass; y += c.y * c.mass; m += c.mass; }
  if (!m) return { x: WORLD / 2, y: WORLD / 2, m: MIN_MASS };
  return { x: x / m, y: y / m, m };
}

let foods = [];
let viruses = [];
let players = [];
let nid = 1;

function makePlayer(opts = {}) {
  const pos = opts.pos || spawnPos();
  const mass = opts.mass || MIN_MASS;
  return {
    id: opts.id || ('p' + nid++),
    sock: opts.sock || null,
    name: String(opts.name || 'Unnamed').slice(0, 16),
    color: opts.color || pick(COLORS),
    skin: opts.skin || '',
    bot: !!opts.bot,
    cells: [makeCell(pos.x, pos.y, mass)],
    score: Math.floor(mass),
    alive: true,
    protectUntil: opts.protectUntil || 0,
    target: { x: pos.x, y: pos.y },
    face: { x: 1, y: 0 },
    wantSplit: false,
    wantFeed: false,
    lastEject: 0,
    ai: { mood: 'farm', moodT: 0, splitCool: 0, skill: opts.skill || 0.4, tier: opts.tier || 'grunt' },
  };
}

function freshName() {
  const used = new Set(players.map(p => p.name));
  let n = pick(BOT_NAMES), g = 0;
  while (used.has(n) && g++ < 40) n = pick(BOT_NAMES) + ((Math.random() * 90) | 0);
  return n;
}

function spawnBot() {
  const humans = players.filter(p => !p.bot && p.alive).map(centroid);
  let pos = spawnPos();
  for (let n = 0; n < 8; n++) {
    const tooClose = humans.some(h => Math.hypot(pos.x - h.x, pos.y - h.y) < 1400);
    if (!tooClose) break;
    pos = spawnPos();
  }
  const skill = rand(0.28, 0.78);
  const tier = skill > 0.62 ? 'hunter' : 'grunt';
  return makePlayer({
    name: freshName(), bot: true, mass: rand(18, 24), tier, skill,
    skin: pick(SKINS),
    pos,
  });
}

function fillLobby() {
  players = players.filter(p => p.alive || p.sock);
  const humans = players.filter(p => !p.bot && (p.alive || p.sock)).length;
  let bots = players.filter(p => p.bot && p.alive);
  const want = Math.max(MIN_BOTS, Math.min(LOBBY - humans, LOBBY - humans));
  while (bots.length > want) {
    const extra = bots.pop();
    const i = players.indexOf(extra);
    if (i >= 0) players.splice(i, 1);
  }
  while (bots.length < want) {
    const b = spawnBot();
    players.push(b);
    bots.push(b);
  }
}

function keepIn(o, r) {
  if (o.x < r) { o.x = r; if (o.vx) o.vx = Math.abs(o.vx) * 0.35; if (o.bx) o.bx = Math.abs(o.bx) * 0.2; }
  if (o.x > WORLD - r) { o.x = WORLD - r; if (o.vx) o.vx = -Math.abs(o.vx) * 0.35; if (o.bx) o.bx = -Math.abs(o.bx) * 0.2; }
  if (o.y < r) { o.y = r; if (o.vy) o.vy = Math.abs(o.vy) * 0.35; if (o.by) o.by = Math.abs(o.by) * 0.2; }
  if (o.y > WORLD - r) { o.y = WORLD - r; if (o.vy) o.vy = -Math.abs(o.vy) * 0.35; if (o.by) o.by = -Math.abs(o.by) * 0.2; }
}

function facing(p) {
  const l = Math.hypot(p.face.x, p.face.y);
  if (l < 0.001) return 0;
  return Math.atan2(p.face.y, p.face.x);
}

function splitPlayer(p) {
  if (p.cells.length >= MAX_CELLS) return;
  const now = Date.now();
  const ang = facing(p);
  const order = p.cells.slice().sort((a, b) => b.mass - a.mass);
  for (const c of order) {
    if (p.cells.length >= MAX_CELLS) break;
    if (c.mass < SPLIT_MIN) continue;
    const half = c.mass / 2;
    c.mass = half; c.r = massToR(half);
    c.mergeAt = now + mergeMs(half);
    c.ghostUntil = now + GHOST_MS;
    const child = makeCell(c.x + Math.cos(ang) * 8, c.y + Math.sin(ang) * 8, half, { mergeAt: now + mergeMs(half), ghostUntil: now + GHOST_MS });
    child.bx = Math.cos(ang) * SPLIT_BOOST;
    child.by = Math.sin(ang) * SPLIT_BOOST;
    p.cells.push(child);
  }
}

function eject(p) {
  const now = Date.now();
  if (now - p.lastEject < 140) return;
  p.lastEject = now;
  const ang = facing(p);
  for (const c of p.cells) {
    if (c.mass < EJECT_MIN) continue;
    c.mass = Math.max(MIN_MASS, c.mass - EJECT_COST);
    c.r = massToR(c.mass);
    const d = c.r + 22;
    foods.push({
      x: clamp(c.x + Math.cos(ang) * d, 8, WORLD - 8),
      y: clamp(c.y + Math.sin(ang) * d, 8, WORLD - 8),
      mass: EJECT_GAIN, r: 8, color: p.color,
      vx: Math.cos(ang) * 22, vy: Math.sin(ang) * 22,
      flying: true, pellet: true,
    });
  }
}

function popSplit(p, cell) {
  const now = Date.now();
  const slots = MAX_CELLS - (p.cells.length - 1);
  if (slots <= 1) return;
  const pieces = Math.min(8, slots);
  const each = cell.mass / pieces;
  const idx = p.cells.indexOf(cell);
  if (idx >= 0) p.cells.splice(idx, 1);
  for (let i = 0; i < pieces && p.cells.length < MAX_CELLS; i++) {
    const a = (Math.PI * 2 * i) / pieces + rand(-0.15, 0.15);
    const bit = makeCell(cell.x + Math.cos(a) * 10, cell.y + Math.sin(a) * 10, each, { mergeAt: now + mergeMs(each), ghostUntil: now + GHOST_MS });
    bit.bx = Math.cos(a) * 18; bit.by = Math.sin(a) * 18;
    p.cells.push(bit);
  }
}

function botThink(p, dt) {
  const ai = p.ai;
  ai.splitCool = Math.max(0, ai.splitCool - dt);
  ai.react = (ai.react || 0) - dt;
  ai.moodT -= dt;
  if (ai.moodT <= 0) {
    const r = Math.random();
    ai.mood = r < 0.34 ? 'farm' : r < 0.58 ? 'hunt' : r < 0.74 ? 'roam' : r < 0.88 ? 'bully' : 'hide';
    ai.moodT = rand(1.8, 5.5);
  }
  if (ai.react > 0) return;
  ai.react = rand(0.12, 0.45) * (1.35 - (ai.skill || 0.4));
  const c = centroid(p);
  const biggest = p.cells.reduce((a, b) => a.mass >= b.mass ? a : b);
  const need = eatNeed(p);
  const skill = ai.skill || 0.4;
  let threat = null, td = 1e9, prey = null, ps = -1;
  for (const o of players) {
    if (o === p || !o.alive) continue;
    for (const oc of o.cells) {
      const d = Math.hypot(oc.x - biggest.x, oc.y - biggest.y);
      if (d > 1100) continue;
      if (oc.mass > biggest.mass * need && d < td) { threat = oc; td = d; }
      if (biggest.mass > oc.mass * need && Math.random() < 0.72 + skill * 0.25) {
        const s = (oc.mass * oc.mass) / (d + 40);
        if (s > ps) { prey = oc; ps = s; }
      }
    }
  }
  const miss = Math.random() > 0.55 + skill * 0.35;
  if (threat && td < 340 + skill * 80 && !miss) {
    const wob = 120 + (1 - skill) * 160;
    p.target.x = c.x + (c.x - threat.x) + rand(-wob, wob);
    p.target.y = c.y + (c.y - threat.y) + rand(-wob, wob);
    p.face.x = p.target.x - c.x; p.face.y = p.target.y - c.y;
    return;
  }
  if (prey && (ai.mood === 'hunt' || ai.mood === 'bully') && Math.random() < 0.7 + skill * 0.2) {
    p.target.x = prey.x + rand(-90, 90);
    p.target.y = prey.y + rand(-90, 90);
    p.face.x = prey.x - c.x; p.face.y = prey.y - c.y;
    const d = Math.hypot(prey.x - biggest.x, prey.y - biggest.y);
    if (ai.splitCool <= 0 && biggest.mass >= SPLIT_MIN && biggest.mass / 2 > prey.mass * need && d < 620 && Math.random() < 0.12 + skill * 0.18) {
      p.wantSplit = true; ai.splitCool = rand(2.4, 5);
    }
    return;
  }
  if (ai.mood === 'roam' || ai.mood === 'hide' || Math.random() < 0.22) {
    p.target.x = clamp(c.x + rand(-900, 900), 140, WORLD - 140);
    p.target.y = clamp(c.y + rand(-900, 900), 140, WORLD - 140);
    p.face.x = p.target.x - c.x; p.face.y = p.target.y - c.y;
    return;
  }
  let food = null, fd = 1e9;
  const step = 2 + ((Math.random() * 3) | 0);
  for (let i = (Math.random() * step) | 0; i < foods.length; i += step) {
    const f = foods[i];
    const d = Math.hypot(f.x - c.x, f.y - c.y);
    if (d < fd && d < 700 + skill * 250) { fd = d; food = f; }
  }
  if (food) { p.target.x = food.x + rand(-18, 18); p.target.y = food.y + rand(-18, 18); }
  else {
    p.target.x = clamp(c.x + rand(-700, 700), 140, WORLD - 140);
    p.target.y = clamp(c.y + rand(-700, 700), 140, WORLD - 140);
  }
  p.face.x = p.target.x - c.x; p.face.y = p.target.y - c.y;
}

function moveCells(p, dt) {
  const now = Date.now();
  for (const c of p.cells) {
    const ang = Math.atan2(p.target.y - c.y, p.target.x - c.x);
    const spd = speedOf(c.mass);
    const reach = Math.hypot(p.target.x - c.x, p.target.y - c.y);
    const scale = Math.min(1, reach / 80);
    c.vx += Math.cos(ang) * spd * 18 * dt * scale;
    c.vy += Math.sin(ang) * spd * 18 * dt * scale;
    c.vx *= Math.pow(0.86, dt * 60);
    c.vy *= Math.pow(0.86, dt * 60);
    if (!isFinite(c.mass) || c.mass < MIN_MASS * 0.5) c.mass = MIN_MASS;
    c.x += (c.vx + c.bx) * 60 * dt;
    c.y += (c.vy + c.by) * 60 * dt;
    c.bx *= Math.pow(0.94, dt * 60);
    c.by *= Math.pow(0.94, dt * 60);
    c.mass = Math.max(MIN_MASS * 0.85, Math.min(MAX_CELL, c.mass * Math.pow(1 - 0.002, dt)));
    c.r = massToR(c.mass);
    keepIn(c, c.r);
  }
  if (p.cells.length < MAX_CELLS) {
    const fat = p.cells.find(c => c.mass >= MAX_CELL - 1);
    if (fat) splitPlayer(p);
  }
  for (let i = 0; i < p.cells.length; i++) {
    for (let j = i + 1; j < p.cells.length; j++) {
      const a = p.cells[i], b = p.cells[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = a.r + b.r;
      const ready = now >= a.mergeAt && now >= b.mergeAt;
      const nx = dx / d, ny = dy / d;
      if (ready && d < min) {
        a.x += nx * 8 * dt; a.y += ny * 8 * dt;
        b.x -= nx * 8 * dt; b.y -= ny * 8 * dt;
        if (d < Math.max(a.r, b.r) * 0.55) {
          const keep = a.mass >= b.mass ? a : b;
          const drop = keep === a ? b : a;
          keep.mass += drop.mass; keep.r = massToR(keep.mass);
          p.cells.splice(p.cells.indexOf(drop), 1);
          j--;
        }
      } else if (d < min) {
        const push = (min - d) * 0.5;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

function eatPass() {
  for (const f of foods) {
    if (!f.flying) continue;
    f.x += f.vx; f.y += f.vy;
    f.vx *= 0.945; f.vy *= 0.945;
    keepIn(f, 6);
    if (Math.hypot(f.vx || 0, f.vy || 0) < 0.35) { f.flying = false; f.vx = 0; f.vy = 0; }
  }
  for (let i = foods.length - 1; i >= 0; i--) {
    const f = foods[i];
    if (!f.pellet) continue;
    for (const v of viruses) {
      if (Math.hypot(f.x - v.x, f.y - v.y) < v.r + 18) {
        v.feeds = (v.feeds || 0) + 1;
        v.r = massToR(100) + v.feeds * 7;
        const ang = Math.atan2(f.vy || 0, f.vx || 0) || Math.atan2(v.y - f.y, v.x - f.x);
        foods.splice(i, 1);
        if (v.feeds >= VIRUS_FEEDS) {
          v.feeds = 0; v.r = massToR(100);
          if (viruses.length < VIRUS_N + 10) {
            viruses.push({ x: v.x + Math.cos(ang) * (v.r + 52), y: v.y + Math.sin(ang) * (v.r + 52), mass: 100, r: massToR(100), spikes: 14, feeds: 0, flying: true, vx: Math.cos(ang) * 28, vy: Math.sin(ang) * 28 });
          }
        }
        break;
      }
    }
  }
  for (const v of viruses) {
    if (!v.flying) continue;
    v.x += v.vx; v.y += v.vy;
    v.vx *= 0.965; v.vy *= 0.965;
    if (Math.hypot(v.vx, v.vy) < 0.3) { v.flying = false; v.vx = 0; v.vy = 0; }
    keepIn(v, v.r);
  }
  const CELL = 140;
  const buckets = new Map();
  for (let i = 0; i < foods.length; i++) {
    const f = foods[i];
    const k = ((f.x / CELL) | 0) + ':' + ((f.y / CELL) | 0);
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(i);
  }
  const eaten = new Uint8Array(foods.length);
  for (const p of players) {
    if (!p.alive) continue;
    for (const c of p.cells) {
      const x0 = ((c.x - c.r) / CELL) | 0, x1 = ((c.x + c.r) / CELL) | 0;
      const y0 = ((c.y - c.r) / CELL) | 0, y1 = ((c.y + c.r) / CELL) | 0;
      for (let gx = x0; gx <= x1; gx++) {
        for (let gy = y0; gy <= y1; gy++) {
          const bucket = buckets.get(gx + ':' + gy);
          if (!bucket) continue;
          for (let n = 0; n < bucket.length; n++) {
            const i = bucket[n];
            if (eaten[i]) continue;
            const f = foods[i];
            if (Math.abs(f.x - c.x) > c.r || Math.abs(f.y - c.y) > c.r) continue;
            if (Math.hypot(f.x - c.x, f.y - c.y) < c.r - 1) {
              c.mass += f.mass; c.r = massToR(c.mass);
              eaten[i] = 1;
            }
          }
        }
      }
      for (let i = viruses.length - 1; i >= 0; i--) {
        const v = viruses[i];
        const d = Math.hypot(v.x - c.x, v.y - c.y);
        if (d < c.r - v.r * 0.28 && c.mass >= VIRUS_POP && c.mass > v.mass) {
          c.mass += v.mass; c.r = massToR(c.mass);
          viruses.splice(i, 1);
          viruses.push(makeVirus());
          if (p.cells.length < MAX_CELLS) popSplit(p, c);
          break;
        }
      }
    }
  }
  if (eaten.includes(1)) {
    const kept = [];
    for (let i = 0; i < foods.length; i++) if (!eaten[i]) kept.push(foods[i]);
    foods = kept;
  }
  while (foods.length < FOOD_N) foods.push(makeFood());
  while (viruses.length < VIRUS_N) viruses.push(makeVirus());
  if (foods.length > FOOD_N + 80) foods.length = FOOD_N + 40;

  for (let i = 0; i < players.length; i++) {
    const a = players[i];
    if (!a.alive) continue;
    const need = eatNeed(a);
    for (let j = 0; j < players.length; j++) {
      if (i === j) continue;
      const b = players[j];
      if (!b.alive) continue;
      if (b.protectUntil && Date.now() < b.protectUntil) continue;
      for (const ac of a.cells) {
        for (let k = b.cells.length - 1; k >= 0; k--) {
          const bc = b.cells[k];
          if (ac.mass < bc.mass * need) continue;
          if (Math.abs(ac.x - bc.x) > ac.r) continue;
          if (Math.hypot(ac.x - bc.x, ac.y - bc.y) < ac.r - bc.r * 0.32) {
            ac.mass += bc.mass; ac.r = massToR(ac.mass);
            b.cells.splice(k, 1);
          }
        }
      }
      if (b.cells.length === 0) {
        b.alive = false;
        if (b.sock) b.sock.emit('dead', { by: a.name });
      }
    }
  }
}

function snapshotFor(p) {
  const me = p && p.alive ? centroid(p) : { x: WORLD / 2, y: WORLD / 2, m: 10 };
  const view = Math.min(3400, 1500 + Math.sqrt(me.m) * 20);
  const plist = [];
  for (const o of players) {
    if (!o.alive) continue;
    const c = centroid(o);
    if (o !== p && (Math.abs(c.x - me.x) > view || Math.abs(c.y - me.y) > view)) continue;
    plist.push({
      id: o.id, name: o.name, color: o.color, skin: o.skin, bot: o.bot,
      cells: o.cells.map(cell => ({ x: cell.x, y: cell.y, mass: cell.mass, r: cell.r })),
    });
  }
  // Stable food sample: same pellets each tick via position hash (no index flicker)
  const nearFood = foods.filter(f => Math.abs(f.x - me.x) < view && Math.abs(f.y - me.y) < view);
  const wantFood = 220;
  const stride = nearFood.length > wantFood ? Math.ceil(nearFood.length / wantFood) : 1;
  const fd = [];
  for (const f of nearFood) {
    if (f.pellet) { fd.push({ x: f.x, y: f.y, r: f.r, color: f.color }); continue; }
    const h = Math.abs(Math.sin(f.x * 12.9898 + f.y * 78.233) * 43758.5453) % 1;
    if (h * stride < 1) fd.push({ x: f.x, y: f.y, r: f.r, color: f.color });
    if (fd.length >= wantFood) break;
  }
  const vs = viruses.filter(v => Math.abs(v.x - me.x) < view && Math.abs(v.y - me.y) < view).map(v => ({ x: v.x, y: v.y, r: v.r, spikes: v.spikes }));
  const ranked = players.filter(x => x.alive).sort((a, b) => totalMass(b) - totalMass(a));
  const top = ranked.slice(0, 8).map((x, i) => ({ i: i + 1, name: x.name, mass: Math.floor(totalMass(x)), me: x.id === (p && p.id) }));
  const myIdx = ranked.findIndex(x => p && x.id === p.id);
  if (myIdx >= 8 && p) top.push({ i: myIdx + 1, name: p.name, mass: Math.floor(totalMass(p)), me: true });
  return {
    you: p && p.alive ? p.id : null,
    world: WORLD,
    mass: p && p.alive ? Math.floor(totalMass(p)) : 0,
    score: p ? p.score : 0,
    players: plist, foods: fd, viruses: vs, lb: top,
    cx: me.x, cy: me.y,
  };
}

function resetWorld() {
  foods = Array.from({ length: FOOD_N }, () => makeFood());
  viruses = Array.from({ length: VIRUS_N }, () => makeVirus());
  players = [];
  fillLobby();
}

resetWorld();

let acc = 0, last = Date.now();
let tickN = 0;
setInterval(() => {
  const now = Date.now();
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tickN++;
  try {
  if (tickN % 10 === 0) fillLobby();
  for (const p of players) {
    if (!p.alive) continue;
    if (p.bot) botThink(p, dt);
    else {
      const c = centroid(p);
      const reach = 520 + Math.sqrt(c.m) * 24;
      p.target.x = c.x + p.face.x * reach;
      p.target.y = c.y + p.face.y * reach;
    }
    if (p.wantSplit) { splitPlayer(p); p.wantSplit = false; }
    if (p.wantFeed) { eject(p); p.wantFeed = false; }
    moveCells(p, dt);
    if (p.bot) {
      let m = totalMass(p);
      if (m > BOT_MAX_MASS) {
        const s = BOT_MAX_MASS / m;
        for (const c of p.cells) { c.mass *= s; c.r = massToR(c.mass); }
      }
    }
    p.score = Math.max(p.score, Math.floor(totalMass(p)));
  }
  eatPass();
  for (const p of players) {
    if (!p.sock) continue;
    p.sock.emit('state', snapshotFor(p));
  }
  } catch (err) {
    console.warn('tick', err && err.message);
  }
}, TICK);

io.on('connection', sock => {
  sock.emit('hello', { skins: SKINS, colors: COLORS });
  sock.on('join', data => {
    const old = players.find(p => p.sock === sock);
    if (old) { old.alive = false; old.sock = null; }
    const p = makePlayer({
      sock, name: (data && data.name) || 'Unnamed',
      skin: (data && data.skin) || '',
      mass: 22,
      protectUntil: Date.now() + 4500,
      pos: { x: WORLD / 2, y: WORLD / 2 },
    });
    const mid = centroid(p);
    for (const b of players) {
      if (!b.bot || !b.alive) continue;
      const c = centroid(b);
      if (Math.hypot(c.x - mid.x, c.y - mid.y) < 900) {
        const a = rand(0, Math.PI * 2), d = rand(1400, 2200);
        for (const cell of b.cells) {
          cell.x = clamp(mid.x + Math.cos(a) * d, 300, WORLD - 300);
          cell.y = clamp(mid.y + Math.sin(a) * d, 300, WORLD - 300);
        }
      }
    }
    players.push(p);
    sock.emit('joined', { id: p.id });
  });
  sock.on('input', data => {
    const p = players.find(x => x.sock === sock && x.alive);
    if (!p || !data) return;
    if (typeof data.x === 'number') p.face.x = clamp(data.x, -1, 1);
    if (typeof data.y === 'number') p.face.y = clamp(data.y, -1, 1);
    if (data.split) p.wantSplit = true;
    if (data.feed) p.wantFeed = true;
  });
  sock.on('exit', () => {
    const p = players.find(x => x.sock === sock);
    if (p) { p.alive = false; p.sock = null; }
  });
  sock.on('disconnect', () => {
    const p = players.find(x => x.sock === sock);
    if (p) { p.alive = false; p.sock = null; }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('OrbEats on ' + PORT);
});
