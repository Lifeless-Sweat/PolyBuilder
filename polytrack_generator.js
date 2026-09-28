'use strict';
/**
 * PolyTrack random track generator
 * ---------------------------------------------------------------
 * Builds a random point-to-point track: START -> road -> CHECKPOINTS -> FINISH
 * and prints a PolyTrack import code you can paste into the game.
 *
 * Usage:
 *   node polytrack_generator.js
 *   node polytrack_generator.js --seed 42 --pieces 60 --turn 0.4
 *   node polytrack_generator.js --env Winter --out track_code.txt --preview track_preview.txt
 *
 * Confirmed piece IDs (decoded from real exported tracks):
 *   0 = straight, 5 = start, 6 = finish, 36 = curve, 75 = checkpoint
 *
 * How curves work (confirmed from real snapped-together pieces):
 *   A curve is a quarter arc joining TWO adjacent sides of its cell. Rotation picks which:
 *     rot 0: south+east   rot 1: east+north   rot 2: north+west   rot 3: west+south
 *   (north = -z, east = +x). The same piece makes left AND right turns.
 */

const fs = require('fs');
const {
  encodeTrackDataV6, encodeTrackCodeV6, decodeTrackCodeV6, decodeTrackDataV6,
} = require('./polytrack_codec.js');

const STEP = 4; // grid spacing between pieces
const ID = { STRAIGHT: 0, START: 5, FINISH: 6, CURVE: 36, CHECKPOINT: 75 };

// directions as [dx, dz]
const N = [0, -1], E = [1, 0], S = [0, 1], W = [-1, 0];
const neg = (d) => [-d[0], -d[1]];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
const key = (d) => `${d[0]},${d[1]}`;
const turnRight = (h) => [-h[1], h[0]];
const turnLeft = (h) => [h[1], -h[0]];

// rotation for direction-aware pieces (start / finish / checkpoint), by travel heading
const HEAD_ROT = new Map([[key(N), 0], [key(W), 1], [key(S), 2], [key(E), 3]]);
// the two open sides of a curve, per rotation
const CURVE_FACES = [[S, E], [E, N], [N, W], [W, S]];

function curveRotation(hIn, hOut) {
  const entry = neg(hIn); // side we come in through
  for (let r = 0; r < 4; r++) {
    const f = CURVE_FACES[r];
    const has = (d) => eq(f[0], d) || eq(f[1], d);
    if (has(entry) && has(hOut)) return r;
  }
  throw new Error('no curve rotation for that turn');
}

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
    seed: Math.floor(Math.random() * 1e9), pieces: 40, turn: 0.35,
    cpEvery: 8, env: 'Summer', name: 'AI Track', out: null, preview: null,
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
  if (!Number.isFinite(a.pieces) || a.pieces < 6) a.pieces = 6;
  if (!['Summer', 'Winter', 'Desert'].includes(a.env)) a.env = 'Summer';
  return a;
}

// ---------------------------------------------------------------- path
/**
 * Random self-avoiding walk. A new cell may not touch (side by side) any earlier
 * cell except the one we came from, so roads never run flush against each other.
 */
function generatePath(rng, n, turnProb) {
  for (let attempt = 0; attempt < 20000; attempt++) {
    const cells = [[0, 0]];
    const heads = [N]; // heads[i] = direction of travel leaving cell i
    const occ = new Set(['0,0']);
    const free = (p, from) => {
      if (occ.has(key(p))) return false;
      for (const d of [N, E, S, W]) {
        const q = [p[0] + d[0], p[1] + d[1]];
        if (!eq(q, from) && occ.has(key(q))) return false;
      }
      return true;
    };
    const first = [0, -1];
    cells.push(first); occ.add(key(first));
    let ok = true;
    for (let i = 1; i < n - 1 && ok; i++) {
      const cur = cells[i];
      const prevH = heads[i - 1];
      const turns = rng() < 0.5 ? [turnLeft(prevH), turnRight(prevH)] : [turnRight(prevH), turnLeft(prevH)];
      const order = rng() < turnProb ? [...turns, prevH] : [prevH, ...turns];
      let chosen = null;
      for (const h of order) {
        const p = [cur[0] + h[0], cur[1] + h[1]];
        if (free(p, cur)) { chosen = h; break; }
      }
      if (!chosen) { ok = false; break; }
      heads[i] = chosen;
      const p = [cur[0] + chosen[0], cur[1] + chosen[1]];
      cells.push(p); occ.add(key(p));
    }
    if (ok && cells.length === n) return { cells, heads };
  }
  throw new Error('could not build a path - try fewer pieces or a lower --turn value');
}

// ---------------------------------------------------------------- pieces
function buildPieces(cells, heads, cpEvery) {
  const n = cells.length;
  const pieces = [];
  let since = 0, cpCount = 0;
  for (let i = 0; i < n; i++) {
    const [gx, gz] = cells[i];
    if (i === 0) {
      pieces.push({ gx, gz, id: ID.START, rotation: HEAD_ROT.get(key(heads[0])), kind: 'start' });
    } else if (i === n - 1) {
      pieces.push({ gx, gz, id: ID.FINISH, rotation: HEAD_ROT.get(key(heads[n - 2])), kind: 'finish' });
    } else {
      const hIn = heads[i - 1], hOut = heads[i];
      since++;
      if (eq(hIn, hOut)) {
        if (since >= cpEvery && i <= n - 3) {
          pieces.push({ gx, gz, id: ID.CHECKPOINT, rotation: HEAD_ROT.get(key(hIn)), kind: 'checkpoint', cpOrder: cpCount++ });
          since = 0;
        } else {
          pieces.push({ gx, gz, id: ID.STRAIGHT, rotation: hIn[1] !== 0 ? 0 : 1, kind: 'straight' });
        }
      } else {
        pieces.push({ gx, gz, id: ID.CURVE, rotation: curveRotation(hIn, hOut), kind: 'curve' });
      }
    }
  }
  return pieces;
}

// the sides each piece is open on
function facesOf(p) {
  if (p.kind === 'curve') return CURVE_FACES[p.rotation];
  return p.rotation % 2 === 0 ? [N, S] : [E, W];
}

/** Self-check: every neighbouring pair of pieces must be open towards each other. */
function verifyConnected(pieces, heads) {
  for (let i = 0; i < pieces.length - 1; i++) {
    const a = pieces[i], b = pieces[i + 1], h = heads[i];
    const fa = facesOf(a), fb = facesOf(b);
    const aOpen = eq(fa[0], h) || eq(fa[1], h);
    const bOpen = eq(fb[0], neg(h)) || eq(fb[1], neg(h));
    if (!aOpen || !bOpen) throw new Error(`pieces ${i} and ${i + 1} do not connect`);
  }
}

// ---------------------------------------------------------------- preview
function preview(pieces) {
  const xs = pieces.map((p) => p.gx), zs = pieces.map((p) => p.gz);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const at = new Map(pieces.map((p) => [`${p.gx},${p.gz}`, p]));
  const curveChar = ['┌', '└', '┘', '┐'];
  const rows = [];
  for (let z = minZ; z <= maxZ; z++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const p = at.get(`${x},${z}`);
      if (!p) row += ' ';
      else if (p.kind === 'start') row += 'S';
      else if (p.kind === 'finish') row += 'F';
      else if (p.kind === 'checkpoint') row += 'C';
      else if (p.kind === 'curve') row += curveChar[p.rotation];
      else row += p.rotation === 0 ? '│' : '─';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

// ---------------------------------------------------------------- encode
function toTrackCode(pieces, args) {
  const minGX = Math.min(...pieces.map((p) => p.gx));
  const minGZ = Math.min(...pieces.map((p) => p.gz));
  const groups = new Map();
  let maxCoord = 0;
  for (const p of pieces) {
    const x = (p.gx - minGX) * STEP, z = (p.gz - minGZ) * STEP;
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
  const { cells, heads } = generatePath(rng, args.pieces, args.turn);
  const pieces = buildPieces(cells, heads, args.cpEvery);
  verifyConnected(pieces, heads);

  const code = toTrackCode(pieces, args);

  // round-trip check: decode what we just made and count the blocks
  const back = decodeTrackDataV6(decodeTrackCodeV6(code).trackData);
  const total = back.parts.reduce((s, p) => s + p.amount, 0);
  if (total !== pieces.length) throw new Error('round-trip mismatch');

  const map = preview(pieces);
  const cps = pieces.filter((p) => p.kind === 'checkpoint').length;
  console.log(map);
  console.log(`\nseed ${args.seed} | ${pieces.length} pieces | ${cps} checkpoints | finish placed | all pieces verified connected\n`);
  console.log('TRACK CODE:\n' + code);

  const outFile = args.out || process.env.OUTPUT_FILE;
  if (outFile) fs.writeFileSync(outFile, code + '\n');
  if (args.preview) fs.writeFileSync(args.preview, `seed ${args.seed}\n\n${map}\n`);
}

main();
