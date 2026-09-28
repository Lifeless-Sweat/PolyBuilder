'use strict';
/**
 * PolyTrack random track generator  (v2 - big curves)
 * ---------------------------------------------------------------
 * Builds a random point-to-point track: START -> road -> CHECKPOINTS -> FINISH
 * and prints a PolyTrack import code you can paste into the game.
 *
 * Usage:
 *   node polytrack_generator.js
 *   node polytrack_generator.js --seed 42 --pieces 30 --turn 0.4
 *   node polytrack_generator.js --env Winter --out track_code.txt --preview track_preview.txt
 *
 * Confirmed piece IDs (decoded from real exported tracks):
 *   0 = straight, 5 = start, 6 = finish, 36 = curve, 75 = checkpoint
 *
 * GEOMETRY (all confirmed from real exported tracks):
 *   - The grid step is 4 units. Straight / start / finish / checkpoint fill ONE cell.
 *   - A CURVE is a big piece: it fills a 2x2 block of cells and its arc has radius 6.
 *     Its block coordinate is the cell that holds its "near" face. The far face sits
 *     one cell forward and one cell sideways, so the next piece goes 1 cell forward
 *     and 2 cells sideways from where the curve started.
 *   - Rotation picks which two sides a curve opens on:
 *       rot 0: south + east   rot 1: east + north   rot 2: north + west   rot 3: west + south
 *     Entering through the near face is a RIGHT turn, through the far face a LEFT turn.
 */

const fs = require('fs');
const {
  encodeTrackDataV6, encodeTrackCodeV6, decodeTrackCodeV6, decodeTrackDataV6,
} = require('./polytrack_codec.js');

const CELL = 4;
const ID = { STRAIGHT: 0, START: 5, FINISH: 6, CURVE: 36, CHECKPOINT: 75 };

// directions as [dx, dz]  (north = -z, east = +x)
const N = [0, -1], E = [1, 0], S = [0, 1], W = [-1, 0];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const neg = (d) => [-d[0], -d[1]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
const key = (d) => `${d[0]},${d[1]}`;
const turnRight = (h) => [-h[1], h[0]];
const turnLeft = (h) => [h[1], -h[0]];
// rotate a vector by r quarter turns (the same rotation the curve piece uses)
function rot(v, r) { let [x, z] = v; for (let i = 0; i < r; i++) [x, z] = [z, -x]; return [x, z]; }

// rotation for direction-aware pieces (start / finish / checkpoint), by travel heading
const HEAD_ROT = new Map([[key(N), 0], [key(W), 1], [key(S), 2], [key(E), 3]]);

// curve at rotation 0, in cells relative to its block coordinate
const CURVE_CELLS = [[0, 0], [1, 0], [0, -1], [1, -1]]; // the 2x2 block
const CURVE_FAR = [1, -1];                              // cell holding the far face
// road path through the block (for the preview): cell + the two sides the road opens on
const CURVE_ROAD = [
  { c: [0, 0], f: [S, N] },
  { c: [0, -1], f: [S, E] },
  { c: [1, -1], f: [W, E] },
];

// ---------------------------------------------------------------- RNG + args
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const a = {
    seed: Math.floor(Math.random() * 1e9), pieces: 30, turn: 0.3,
    cpEvery: 6, env: 'Summer', name: 'AI Track', out: null, preview: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--seed') { a.seed = parseInt(v, 10); i++; }
    else if (k === '--pieces') { a.pieces = parseInt(v, 10); i++; }
    else if (k === '--turn') { a.turn = parseFloat(v); i++; }
    else if (k === '--cp-every') { a.cpEvery = parseInt(v, 10); i++; }
    else if (k === '--env') { a.env = v; i++; }
    else if (k === '--name') { a.name = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--preview') { a.preview = v; i++; }
  }
  if (!Number.isFinite(a.seed)) a.seed = Math.floor(Math.random() * 1e9);
  if (!Number.isFinite(a.pieces) || a.pieces < 4) a.pieces = 4;
  if (!Number.isFinite(a.turn)) a.turn = 0.3;
  if (!['Summer', 'Winter', 'Desert'].includes(a.env)) a.env = 'Summer';
  return a;
}

// ---------------------------------------------------------------- pieces
/** Work out a curve for a turn: which rotation, where its block sits, where we are afterwards. */
function planTurn(front, hIn, side) {
  const hOut = side === 'R' ? turnRight(hIn) : turnLeft(hIn);
  for (let r = 0; r < 4; r++) {
    const nearFace = rot(S, r), farFace = rot(E, r);
    let origin = null;
    if (side === 'R' && eq(nearFace, neg(hIn)) && eq(farFace, hOut)) origin = front;      // enter by the near face
    if (side === 'L' && eq(farFace, neg(hIn)) && eq(nearFace, hOut)) origin = add(front, neg(rot(CURVE_FAR, r))); // enter by the far face
    if (origin) {
      const cells = CURVE_CELLS.map((c) => add(origin, rot(c, r)));
      const nextFront = add(add(front, hIn), scale(hOut, 2));
      return { kind: 'curve', id: ID.CURVE, rotation: r, origin, cells, nextFront, hOut, entryFace: side === 'R' ? 'A' : 'B' };
    }
  }
  throw new Error('no curve rotation found');
}

function planStraight(front, hIn) {
  return { kind: 'straight', id: ID.STRAIGHT, rotation: hIn[1] !== 0 ? 0 : 1, origin: front, cells: [front], nextFront: add(front, hIn), hOut: hIn, hIn };
}

// ---------------------------------------------------------------- path search
function generate(rng, n, turnProb) {
  for (let attempt = 0; attempt < 30000; attempt++) {
    const pieces = [];
    const owner = new Map(); // cell -> piece index
    // a candidate is fine if it overlaps nothing and does not sit side by side with any
    // piece other than the one it connects to
    const fits = (cells, prevIdx) => {
      const mine = new Set(cells.map(key));
      for (const c of cells) {
        if (owner.has(key(c))) return false;
        for (const d of [N, E, S, W]) {
          const q = add(c, d);
          if (mine.has(key(q))) continue;
          const o = owner.get(key(q));
          if (o !== undefined && o !== prevIdx) return false;
        }
      }
      return true;
    };
    const place = (p) => { const idx = pieces.length; pieces.push(p); for (const c of p.cells) owner.set(key(c), idx); return idx; };

    // start piece at the origin, facing north
    place({ kind: 'start', id: ID.START, rotation: HEAD_ROT.get(key(N)), origin: [0, 0], cells: [[0, 0]], hIn: N, hOut: N, nextFront: [0, -1] });
    let front = [0, -1], h = N, ok = true;

    for (let i = 1; i < n - 1 && ok; i++) {
      const prevIdx = pieces.length - 1;
      const turns = rng() < 0.5 ? ['L', 'R'] : ['R', 'L'];
      const order = rng() < turnProb ? [...turns, 'S'] : ['S', ...turns];
      let chosen = null;
      for (const o of order) {
        const p = o === 'S' ? planStraight(front, h) : planTurn(front, h, o);
        if (o !== 'S') p.hIn = h;
        if (fits(p.cells, prevIdx)) { chosen = p; break; }
      }
      if (!chosen) { ok = false; break; }
      place(chosen);
      front = chosen.nextFront; h = chosen.hOut;
    }
    if (!ok) continue;

    // finish piece
    const fin = { kind: 'finish', id: ID.FINISH, rotation: HEAD_ROT.get(key(h)), origin: front, cells: [front], hIn: h, hOut: h, nextFront: add(front, h) };
    if (!fits(fin.cells, pieces.length - 1)) continue;
    place(fin);
    return pieces;
  }
  throw new Error('could not build a track - try fewer pieces or a lower --turn value');
}

/** Turn some straights into checkpoints. */
function addCheckpoints(pieces, cpEvery) {
  let since = 0, count = 0;
  for (let i = 1; i < pieces.length - 2; i++) {
    since++;
    const p = pieces[i];
    if (p.kind === 'straight' && since >= cpEvery) {
      p.kind = 'checkpoint'; p.id = ID.CHECKPOINT; p.rotation = HEAD_ROT.get(key(p.hIn)); p.cpOrder = count++;
      since = 0;
    }
  }
}

// ---------------------------------------------------------------- self-check
/**
 * Independent geometry check in real world units: the exit port of every piece must land
 * exactly on the entry port of the next one, pointing at it, and no two pieces may share a cell.
 */
function ports(p) {
  const c = scale(p.origin, CELL);
  if (p.kind !== 'curve') {
    const h = p.hIn || p.hOut;
    return { entry: { at: add(c, scale(h, -2)), out: neg(h) }, exit: { at: add(c, scale(h, 2)), out: h } };
  }
  const A = { at: add(c, rot([0, 2], p.rotation)), out: rot(S, p.rotation) };
  const B = { at: add(c, rot([6, -4], p.rotation)), out: rot(E, p.rotation) };
  return p.entryFace === 'A' ? { entry: A, exit: B } : { entry: B, exit: A };
}

function verify(pieces) {
  const seen = new Set();
  for (const p of pieces) for (const c of p.cells) { if (seen.has(key(c))) throw new Error('overlap'); seen.add(key(c)); }
  for (let i = 0; i < pieces.length - 1; i++) {
    const a = ports(pieces[i]).exit, b = ports(pieces[i + 1]).entry;
    if (!eq(a.at, b.at) || !eq(a.out, neg(b.out))) throw new Error(`pieces ${i} and ${i + 1} do not connect`);
  }
}

// ---------------------------------------------------------------- preview
function faceChar(f) {
  const has = (d) => f.some((x) => eq(x, d));
  if (has(N) && has(S)) return '│';
  if (has(E) && has(W)) return '─';
  if (has(S) && has(E)) return '┌';
  if (has(S) && has(W)) return '┐';
  if (has(N) && has(E)) return '└';
  return '┘';
}

function preview(pieces) {
  const at = new Map();
  for (const p of pieces) {
    if (p.kind === 'curve') {
      for (const seg of CURVE_ROAD) {
        const c = add(p.origin, rot(seg.c, p.rotation));
        at.set(key(c), faceChar(seg.f.map((d) => rot(d, p.rotation))));
      }
    } else {
      const ch = p.kind === 'start' ? 'S' : p.kind === 'finish' ? 'F' : p.kind === 'checkpoint' ? 'C' : (p.rotation === 0 ? '│' : '─');
      at.set(key(p.origin), ch);
    }
  }
  const cells = [...at.keys()].map((k) => k.split(',').map(Number));
  const minX = Math.min(...cells.map((c) => c[0])), maxX = Math.max(...cells.map((c) => c[0]));
  const minZ = Math.min(...cells.map((c) => c[1])), maxZ = Math.max(...cells.map((c) => c[1]));
  const rows = [];
  for (let z = minZ; z <= maxZ; z++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) row += at.get(`${x},${z}`) || ' ';
    rows.push(row);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------- encode
function toTrackCode(pieces, args) {
  const minX = Math.min(...pieces.map((p) => p.origin[0]));
  const minZ = Math.min(...pieces.map((p) => p.origin[1]));
  const groups = new Map();
  let maxCoord = 0;
  for (const p of pieces) {
    const x = (p.origin[0] - minX) * CELL, z = (p.origin[1] - minZ) * CELL;
    maxCoord = Math.max(maxCoord, x, z);
    const block = { x, y: 0, z, rotation: p.rotation, dir: 'YPos', color: 0 };
    if (p.kind === 'start') block.startOrder = 0;
    if (p.kind === 'checkpoint') block.cpOrder = p.cpOrder;
    if (!groups.has(p.id)) groups.set(p.id, []);
    groups.get(p.id).push(block);
  }
  const bytes = maxCoord <= 255 ? 1 : 2;
  const parts = [...groups.entries()].map(([id, blocks]) => ({ id, amount: blocks.length, blocks }));
  const trackData = encodeTrackDataV6({
    env: args.env, sunDir: 127, minX: 0, minY: 0, minZ: 0,
    dataBytes: bytes | (1 << 2) | (bytes << 4), parts,
  });
  return encodeTrackCodeV6({ name: args.name, author: null, lastModified: null, trackData });
}

// ---------------------------------------------------------------- main
function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);
  const pieces = generate(rng, args.pieces, args.turn);
  addCheckpoints(pieces, args.cpEvery);
  verify(pieces);

  const code = toTrackCode(pieces, args);
  const back = decodeTrackDataV6(decodeTrackCodeV6(code).trackData);
  if (back.parts.reduce((s, p) => s + p.amount, 0) !== pieces.length) throw new Error('round-trip mismatch');

  const map = preview(pieces);
  const cps = pieces.filter((p) => p.kind === 'checkpoint').length;
  const curves = pieces.filter((p) => p.kind === 'curve').length;
  console.log(map);
  console.log(`\nseed ${args.seed} | ${pieces.length} pieces (${curves} curves) | ${cps} checkpoints | finish placed | geometry verified\n`);
  console.log('TRACK CODE:\n' + code);

  const outFile = args.out || process.env.OUTPUT_FILE;
  if (outFile) fs.writeFileSync(outFile, code + '\n');
  if (args.preview) fs.writeFileSync(args.preview, `seed ${args.seed}\n\n${map}\n`);
}

main();
