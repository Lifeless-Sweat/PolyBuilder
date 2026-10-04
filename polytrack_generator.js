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
 *   node polytrack_generator.js --plain          (skip the self-review, just one random track)
 *   node polytrack_generator.js --tries 100 --refine 1000   (review harder)
 *
 * Confirmed piece IDs (decoded from real exported tracks):
 *   0 = straight, 5 = start, 6 = finish, 36 = curve, 75 = checkpoint, ramps = see RAMPS below
 *
 * RAMPS: same footprint/rotation as a straight piece, but the piece after it sits `rise`
 * grid levels higher. Only id 33 (rise 1) is confirmed from a real export; the rest are
 * estimated from a screenshot and may need correcting - see the RAMPS table.
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

// Alternate styles for start / finish / checkpoint - all single-cell, non-connecting
// markers with the same placement rule as the base ones above, just a different gate
// look. Picked randomly per-track for variety.
const START_STYLES = [5, 91, 92, 93];        // Start, StartWide, PlaneStart, PlaneStartWide
// Straight-like 1-cell pieces, assumed to share Straight's connection rule (untested on the
// exit side - this is the "add now, fix after" batch). Pillar and Tilted variants were
// pulled out after a confirmed in-game mismatch: they likely don't share the same height
// baseline as a plain Straight at the same y value (a Pillar piece probably sits on a
// support column of its own, not flush with the road the way Straight does), so mixing
// them produced a visibly disconnected block. StraightWide looked fine and stays in.
const STRAIGHT_STYLES = [0, 10];                      // Straight, StraightWide
// TurnLong/TurnLong2/TurnLong3 do NOT share TurnShort's exact footprint - tried reusing
// its connection math as a guess and it produced gaps in real tracks (confirmed in-game).
// Back to just the one confirmed curve until the TurnLong family gets a real export test.
const CURVE_STYLES = [36];                            // TurnShort only
const FINISH_STYLES = [6, 74, 76, 78];       // Finish, FinishWide, PlaneFinish, PlaneFinishWide
const CHECKPOINT_STYLES = [52, 65, 75, 77];  // Checkpoint, CheckpointWide, PlaneCheckpoint, PlaneCheckpointWide

// Ramp pieces: same 1-cell footprint and rotation rule as a straight piece, but the far
// end sits `rise` grid levels higher (confirmed for id 33: rise 1, from a real exported
// connection). The rest are ESTIMATED from a screenshot comparing relative heights, not
// individually confirmed - verify in-game and adjust RAMPS below if any height is off.
const RAMPS = [
  { id: 33, rise: 1 }, // confirmed via real export: 1 cell long, rises 1 level
];
// The other 10 ramp ids (145, 35, 170, 171, 13, 14, 148, 147, 17, 18) are NOT used yet -
// an earlier attempt guessed their height from a screenshot and produced floating/
// disconnected track sections in-game. They're very likely longer than 1 cell too
// (a gentler climb needs more length as well as more height), so both dimensions need
// a real single-ramp connect test (like the one that confirmed id 33) before they're safe
// to use. Re-enable one at a time here once confirmed, with { id, rise, cells: N }.

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
    cpEvery: 6, env: 'Summer', name: 'AI Track', out: null, preview: null, tries: 40, refine: 400, ramp: 0.12, variety: true, startHeight: 0,
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
    else if (k === '--tries') { a.tries = parseInt(v, 10); i++; }
    else if (k === '--refine') { a.refine = parseInt(v, 10); i++; }
    else if (k === '--plain') { a.tries = 1; a.refine = 0; }
    else if (k === '--ramp') { a.ramp = parseFloat(v); i++; }
    else if (k === '--no-variety') { a.variety = false; }
    else if (k === '--start-height') { a.startHeight = parseInt(v, 10); i++; }
  }
  if (!Number.isFinite(a.tries) || a.tries < 1) a.tries = 1;
  if (!Number.isFinite(a.refine) || a.refine < 0) a.refine = 0;
  if (!Number.isFinite(a.ramp) || a.ramp < 0) a.ramp = 0;
  if (!Number.isFinite(a.startHeight) || a.startHeight < 0) a.startHeight = 0;
  if (!Number.isFinite(a.seed)) a.seed = Math.floor(Math.random() * 1e9);
  if (!Number.isFinite(a.pieces) || a.pieces < 4) a.pieces = 4;
  if (!Number.isFinite(a.turn)) a.turn = 0.3;
  if (!['Summer', 'Winter', 'Desert'].includes(a.env)) a.env = 'Summer';
  return a;
}

// ---------------------------------------------------------------- pieces
/** Work out a curve for a turn: which rotation, where its block sits, where we are afterwards. */
function planTurn(front, hIn, side, styles, rng) {
  const curveId = (styles && styles.curveIds && rng) ? styles.curveIds[Math.floor(rng() * styles.curveIds.length)] : ID.CURVE;
  const hOut = side === 'R' ? turnRight(hIn) : turnLeft(hIn);
  for (let r = 0; r < 4; r++) {
    const nearFace = rot(S, r), farFace = rot(E, r);
    let origin = null;
    if (side === 'R' && eq(nearFace, neg(hIn)) && eq(farFace, hOut)) origin = front;      // enter by the near face
    if (side === 'L' && eq(farFace, neg(hIn)) && eq(nearFace, hOut)) origin = add(front, neg(rot(CURVE_FAR, r))); // enter by the far face
    if (origin) {
      const cells = CURVE_CELLS.map((c) => add(origin, rot(c, r)));
      const nextFront = add(add(front, hIn), scale(hOut, 2));
      return { kind: 'curve', id: curveId, rotation: r, origin, cells, nextFront, hOut, hIn, side, entryFace: side === 'R' ? 'A' : 'B', dy: 0 };
    }
  }
  throw new Error('no curve rotation found');
}

function planStraight(front, hIn, styles, rng) {
  const id = (styles && styles.straightIds && rng) ? styles.straightIds[Math.floor(rng() * styles.straightIds.length)] : ID.STRAIGHT;
  return { kind: 'straight', id, rotation: hIn[1] !== 0 ? 0 : 1, origin: front, cells: [front], nextFront: add(front, hIn), hOut: hIn, hIn, dy: 0 };
}

function planRamp(front, hIn, y, ramp) {
  return {
    kind: 'ramp', id: ramp.id, rotation: hIn[1] !== 0 ? 0 : 1, origin: front, cells: [front],
    nextFront: add(front, hIn), hOut: hIn, hIn, y, dy: ramp.rise, riseId: ramp.id,
  };
}

// ---------------------------------------------------------------- path search
/** A track under construction. Choices are 'S' (straight), 'L' or 'R' (turn). */
const DEFAULT_STYLES = { startId: ID.START, finishId: ID.FINISH, cpId: 75 };

function newLayout(styles, rng) {
  const { startId, finishId } = styles || DEFAULT_STYLES;
  const L = { pieces: [], owner: new Map(), front: [0, -1], h: N, finishId, styles, rng };
  // fine if it overlaps nothing and does not sit side by side with any piece other than the one it connects to
  L.fits = (cells, prevIdx) => {
    const mine = new Set(cells.map(key));
    for (const c of cells) {
      if (L.owner.has(key(c))) return false;
      for (const d of [N, E, S, W]) {
        const q = add(c, d);
        if (mine.has(key(q))) continue;
        const o = L.owner.get(key(q));
        if (o !== undefined && o !== prevIdx) return false;
      }
    }
    return true;
  };
  L.place = (p) => { const idx = L.pieces.length; L.pieces.push(p); for (const c of p.cells) L.owner.set(key(c), idx); };
  L.y = 0;
  L.sinceRamp = 99; // pieces since the last ramp event (up or down)
  L.sinceTurn = 99; // pieces since the last curve
  L.tryAdd = (choice) => {
    let p;
    if (choice === 'S') p = planStraight(L.front, L.h, L.styles, L.rng);
    else if (choice === 'L' || choice === 'R') p = planTurn(L.front, L.h, choice, L.styles, L.rng);
    else p = planRamp(L.front, L.h, L.y, choice); // choice is a ramp descriptor object
    p.hIn = L.h;
    if (p.y === undefined) p.y = L.y;
    const isRamp = p.kind === 'ramp';
    const isTurn = p.kind === 'curve';
    // keep ramps away from each other and from turns, so a hill has flat ground on both sides
    if (isRamp && (L.sinceRamp < 3 || L.sinceTurn < 2)) return false;
    if (isTurn && L.sinceRamp < 2) return false;
    if (!L.fits(p.cells, L.pieces.length - 1)) return false;
    L.place(p); L.front = p.nextFront; L.h = p.hOut; L.y = L.y + (p.dy || 0);
    L.sinceRamp = isRamp ? 0 : L.sinceRamp + 1;
    L.sinceTurn = isTurn ? 0 : L.sinceTurn + 1;
    return true;
  };
  L.finish = () => {
    const fin = { kind: 'finish', id: L.finishId, rotation: HEAD_ROT.get(key(L.h)), origin: L.front, cells: [L.front], hIn: L.h, hOut: L.h, nextFront: add(L.front, L.h), y: L.y, dy: 0 };
    if (!L.fits(fin.cells, L.pieces.length - 1)) return false;
    L.place(fin);
    return true;
  };
  // start piece at the origin, facing north
  const startHeight0 = (styles && styles.startHeight) || 0;
  L.place({ kind: 'start', id: startId, rotation: HEAD_ROT.get(key(N)), origin: [0, 0], cells: [[0, 0]], hIn: N, hOut: N, nextFront: [0, -1], y: startHeight0, dy: 0 });
  L.front = [0, -1]; L.h = N; L.y = startHeight0;
  // optional elevated start: chain confirmed down-ramps (PlaneSlopeUp, id 33, used in
  // reverse) right after the start, so the track begins high up and descends to ground
  // level before the random path begins. Only uses geometry we've verified in-game.
  const startHeight = (styles && styles.startHeight) || 0;
  for (let i = 0; i < startHeight; i++) {
    L.sinceRamp = 99; // this is an intentional staircase - the normal ramp-spacing rule doesn't apply here
    const down = { id: 33, rise: -1 };
    if (!L.tryAdd(down)) break; // stop early if it somehow can't fit (shouldn't happen in a straight line)
  }
  L.sinceRamp = 99; // reset so the random path after this doesn't inherit a fake "just had a ramp" state
  return L;
}

/** Lay a track out from a list of choices. Returns null if it does not fit. */
function build(choices, styles) {
  const L = newLayout(styles, mulberry32(1)); // fixed rng: style re-picks during refine stay stable per-cell
  for (const c of choices) if (!L.tryAdd(c)) return null;
  return L.finish() ? L.pieces : null;
}

function isTurnToken(c) { return c === 'S' || c === 'L' || c === 'R'; }

/** One random valid list of choices. */
function randomChoices(rng, n, turnProb, rampProb, styles) {
  for (let attempt = 0; attempt < 30000; attempt++) {
    const L = newLayout(styles, rng);
    const choices = [];
    let ok = true;
    for (let i = 0; i < n - 2 && ok; i++) {
      const turns = rng() < 0.5 ? ['L', 'R'] : ['R', 'L'];
      let order = rng() < turnProb ? [...turns, 'S'] : ['S', ...turns];
      // occasionally try a ramp (up or down) before falling back to the usual order -
      // ramps only make sense on level ground with no elevation already changing here
      if (rampProb > 0 && rng() < rampProb) {
        const up = RAMPS[Math.floor(rng() * RAMPS.length)];
        const down = { id: up.id, rise: -up.rise, down: true };
        order = rng() < 0.5 ? [up, down, ...order] : [down, up, ...order];
      }
      ok = false;
      for (const o of order) if (L.tryAdd(o)) { choices.push(o); ok = true; break; }
    }
    if (ok && L.finish()) return choices;
  }
  throw new Error('could not build a track - try fewer pieces, a lower --turn, or a lower --ramp value');
}

// ---------------------------------------------------------------- the "eye": scoring a track
/** Higher is better: interesting, varied, no long dull stretches, no endless spirals. */
function score(pieces) {
  const road = pieces.slice(1, -1);
  let s = 0;

  // long straight stretches are boring
  let run = 0;
  const flush = () => { if (run > 5) s -= 1.5 * Math.pow(run - 5, 1.5); run = 0; };
  for (const p of road) { if (p.kind === 'curve') flush(); else run++; }
  flush();

  // a healthy share of the road should be curves
  const curves = road.filter((p) => p.kind === 'curve');
  const ratio = curves.length / Math.max(1, road.length);
  s -= 40 * Math.max(0, 0.25 - ratio) + 20 * Math.max(0, ratio - 0.5);

  // balance left and right so the track does not just circle
  const signs = curves.map((p) => p.side);
  const nR = signs.filter((x) => x === 'R').length, nL = signs.length - nR;
  s -= 4 * Math.max(0, Math.abs(nR - nL) - 2);

  // reward chicanes (left-right-left), punish three same turns in a row
  let alt = 0, same3 = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) alt++;
  for (let i = 2; i < signs.length; i++) if (signs[i] === signs[i - 1] && signs[i] === signs[i - 2]) same3++;
  s += Math.min(alt, 8) - 3 * same3;

  // finish should not be right next to the start
  const a = pieces[0].origin, b = pieces[pieces.length - 1].origin;
  s += Math.min(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), pieces.length / 3) * 0.5;
  return s;
}

/** Change 1-3 random choices. */
function mutate(rng, choices) {
  const c = choices.slice();
  const idx = c.map((x, i) => i).filter((i) => isTurnToken(c[i]));
  if (idx.length === 0) return c;
  const k = Math.min(idx.length, 1 + Math.floor(rng() * 3));
  for (let i = 0; i < k; i++) {
    const j = idx[Math.floor(rng() * idx.length)];
    const opts = ['S', 'L', 'R'].filter((x) => x !== c[j]);
    c[j] = opts[Math.floor(rng() * 2)];
  }
  return c;
}

/**
 * Draw `tries` random tracks and keep the best, then keep tweaking it:
 * every change that makes the track score higher is kept, the rest are thrown away.
 */
function smartTrack(rng, n, turnProb, tries, refine, rampProb, useVariety, startHeight) {
  const styles = {
    startId: START_STYLES[Math.floor(rng() * START_STYLES.length)],
    finishId: FINISH_STYLES[Math.floor(rng() * FINISH_STYLES.length)],
    cpId: CHECKPOINT_STYLES[Math.floor(rng() * CHECKPOINT_STYLES.length)],
    straightIds: useVariety ? STRAIGHT_STYLES : [ID.STRAIGHT],
    curveIds: useVariety ? CURVE_STYLES : [ID.CURVE],
    startHeight,
  };
  let best = null, firstScore = null;
  for (let t = 0; t < Math.max(1, tries); t++) {
    const choices = randomChoices(rng, n, turnProb, rampProb, styles);
    const pieces = build(choices, styles);
    const s = score(pieces);
    if (t === 0) firstScore = s;
    if (!best || s > best.s) best = { choices, pieces, s };
  }
  let changes = 0;
  for (let i = 0; i < refine; i++) {
    const c = mutate(rng, best.choices);
    const p = build(c, styles);
    if (!p) continue;
    const s = score(p);
    if (s > best.s) { best = { choices: c, pieces: p, s }; changes++; }
  }
  addCheckpoints(best.pieces, build.cpEvery || 6, styles.cpId);
  return { pieces: best.pieces, score: best.s, firstScore, changes };
}

/** Turn some straights into checkpoints. */
function addCheckpoints(pieces, cpEvery, cpId) {
  let since = 0, count = 0;
  for (let i = 1; i < pieces.length - 2; i++) {
    since++;
    const p = pieces[i];
    if (p.kind === 'straight' && since >= cpEvery) {
      p.kind = 'checkpoint'; p.id = cpId; p.rotation = HEAD_ROT.get(key(p.hIn)); p.cpOrder = count++;
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
    return {
      entry: { at: add(c, scale(h, -2)), out: neg(h), y: p.y },
      exit: { at: add(c, scale(h, 2)), out: h, y: p.y + (p.dy || 0) },
    };
  }
  const A = { at: add(c, rot([0, 2], p.rotation)), out: rot(S, p.rotation), y: p.y };
  const B = { at: add(c, rot([6, -4], p.rotation)), out: rot(E, p.rotation), y: p.y };
  return p.entryFace === 'A' ? { entry: A, exit: B } : { entry: B, exit: A };
}

function verify(pieces) {
  const seen = new Set();
  for (const p of pieces) for (const c of p.cells) { if (seen.has(key(c))) throw new Error('overlap'); seen.add(key(c)); }
  for (let i = 0; i < pieces.length - 1; i++) {
    const a = ports(pieces[i]).exit, b = ports(pieces[i + 1]).entry;
    if (!eq(a.at, b.at) || !eq(a.out, neg(b.out))) throw new Error(`pieces ${i} and ${i + 1} do not connect`);
    if (a.y !== b.y) throw new Error(`pieces ${i} and ${i + 1} do not line up in height`);
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
      const ch = p.kind === 'start' ? 'S' : p.kind === 'finish' ? 'F' : p.kind === 'checkpoint' ? 'C'
        : p.kind === 'ramp' ? (p.dy > 0 ? '^' : 'v') : (p.rotation === 0 ? '│' : '─');
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
  // a "down" ramp can dip below the starting height - shift everything up so the
  // lowest point sits at y=0. Without this, negative y wraps to a huge unsigned byte
  // (e.g. -1 becomes 255) and the piece renders sky-high instead of underground.
  const minY = Math.min(...pieces.map((p) => p.y || 0));
  const groups = new Map();
  let maxCoord = 0;
  for (const p of pieces) {
    const x = (p.origin[0] - minX) * CELL, z = (p.origin[1] - minZ) * CELL, y = (p.y || 0) - minY;
    maxCoord = Math.max(maxCoord, x, z, y);
    const block = { x, y, z, rotation: p.rotation, dir: 'YPos', color: 0 };
    if (p.kind === 'start') block.startOrder = 0;
    if (p.kind === 'checkpoint') block.cpOrder = p.cpOrder;
    if (!groups.has(p.id)) groups.set(p.id, []);
    groups.get(p.id).push(block);
  }
  const bytes = maxCoord <= 255 ? 1 : 2;
  const parts = [...groups.entries()].map(([id, blocks]) => ({ id, amount: blocks.length, blocks }));
  const trackData = encodeTrackDataV6({
    env: args.env, sunDir: 127, minX: 0, minY: 0, minZ: 0,
    dataBytes: bytes | (bytes << 2) | (bytes << 4), parts,
  });
  return encodeTrackCodeV6({ name: args.name, author: null, lastModified: null, trackData });
}

// ---------------------------------------------------------------- main
function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);
  smartTrack.cpEvery = args.cpEvery; // read by smartTrack's internal addCheckpoints call
  build.cpEvery = args.cpEvery;
  const smart = smartTrack(rng, args.pieces, args.turn, args.tries, args.refine, args.ramp, args.variety, args.startHeight);
  const pieces = smart.pieces;
  verify(pieces);

  const code = toTrackCode(pieces, args);
  const back = decodeTrackDataV6(decodeTrackCodeV6(code).trackData);
  if (back.parts.reduce((s, p) => s + p.amount, 0) !== pieces.length) throw new Error('round-trip mismatch');

  const map = preview(pieces);
  const cps = pieces.filter((p) => p.kind === 'checkpoint').length;
  const curves = pieces.filter((p) => p.kind === 'curve').length;
  const ramps = pieces.filter((p) => p.kind === 'ramp').length;
  console.log(map);
  console.log(`\nseed ${args.seed} | ${pieces.length} pieces (${curves} curves, ${ramps} ramps) | ${cps} checkpoints | finish placed | geometry verified`);
  console.log(`quality score ${smart.score.toFixed(1)} (first random draw scored ${smart.firstScore.toFixed(1)}, ${smart.changes} improving changes kept)\n`);
  console.log('TRACK CODE:\n' + code);

  const outFile = args.out || process.env.OUTPUT_FILE;
  if (outFile) fs.writeFileSync(outFile, code + '\n');
  if (args.preview) fs.writeFileSync(args.preview, `seed ${args.seed}\n\n${map}\n`);
}

if (require.main === module) main();
module.exports = { smartTrack, randomChoices, build, score, mulberry32 };
