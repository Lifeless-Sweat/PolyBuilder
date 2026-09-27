/**
 * PolyTrack Procedural Track Layout Generator (Stage 1)
 * --------------------------------------------------------------
 * This does NOT produce a PolyTrack import file/code yet - the real
 * export format is an opaque encoded blob, not plain JSON, and we
 * don't have a sample of it to reverse-engineer.
 *
 * What this DOES do: design a valid, non-self-intersecting, CLOSED
 * track loop as a sequence of pieces (straight / turn / ramp) on a
 * grid, with checkpoints placed along it. This is the "blueprint".
 * Stage 2 (separate script, once we have a real trackParts sample)
 * will translate this blueprint into actual game pieces.
 *
 * Usage:
 *   node track_generator.js                 -> generates + prints a track
 *   node track_generator.js --seed 42       -> reproducible track
 *   node track_generator.js --pieces 40     -> target piece count
 *   node track_generator.js --out track.json -> also writes JSON to a file
 */

'use strict';

// ---------- tiny seeded RNG (so tracks are reproducible with --seed) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- CLI args ----------
function parseArgs(argv) {
  const args = { seed: Date.now() & 0xffffffff, pieces: 30, out: null, maxHeight: 3 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 10);
    else if (argv[i] === '--pieces') args.pieces = parseInt(argv[++i], 10);
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--maxHeight') args.maxHeight = parseInt(argv[++i], 10);
  }
  return args;
}

// Directions on the XZ grid: 0=+X(East), 1=+Z(South), 2=-X(West), 3=-Z(North)
const DIR_VEC = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
];
const DIR_NAME = ['E', 'S', 'W', 'N'];

function key(x, y, z) { return `${x},${y},${z}`; }

/**
 * Builds a closed loop via randomized DFS on a 3D grid (y = height level,
 * limited to small deltas so ramps stay gentle). Backtracks on dead ends.
 * Stops once it can close the loop back to the start within [minLen,maxLen].
 */
function generateLoop(rng, targetPieces, maxHeight) {
  const minLen = Math.max(8, Math.floor(targetPieces * 0.7));
  const maxLen = targetPieces * 2;

  for (let attempt = 0; attempt < 500; attempt++) {
    const start = [0, 0, 0];
    const visited = new Set([key(...start)]);
    const path = [start];
    let dir = Math.floor(rng() * 4);

    const stack = []; // {options left to try} per depth, for backtracking

    while (path.length < maxLen) {
      const [x, y, z] = path[path.length - 1];

      // Try to close the loop back to start once we've gone far enough
      if (path.length >= minLen) {
        const [sx, , sz] = start;
        const dx = sx - x, dz = sz - z;
        if (Math.abs(dx) + Math.abs(dz) === 1 && y === start[1]) {
          path.push(start);
          return { path, closed: true };
        }
      }

      // Candidate next directions: prefer continuing straight, but allow turns
      const order = [dir, (dir + 3) % 4, (dir + 1) % 4]; // straight, left, right
      let moved = false;
      for (const d of shuffle(order, rng)) {
        const [dx, dz] = DIR_VEC[d];
        const dy = rng() < 0.12 ? (rng() < 0.5 ? 1 : -1) : 0; // occasional ramp
        const ny = Math.max(0, Math.min(maxHeight, y + dy));
        const nx = x + dx, nz = z + dz;
        const k = key(nx, ny, nz);
        if (!visited.has(k)) {
          visited.add(k);
          path.push([nx, ny, nz]);
          dir = d;
          moved = true;
          break;
        }
      }
      if (!moved) break; // dead end -> give up this attempt, try again
    }
  }
  return { path: null, closed: false };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Classify each grid step into a piece type based on turning/height change. */
function classifyPieces(path) {
  const pieces = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [x0, y0, z0] = path[i];
    const [x1, y1, z1] = path[i + 1];
    const dx = x1 - x0, dz = z1 - z0, dy = y1 - y0;
    const heading = DIR_NAME[DIR_VEC.findIndex(([vx, vz]) => vx === dx && vz === dz)];

    let type = 'straight';
    if (i > 0) {
      const [px, , pz] = path[i - 1];
      const prevDx = x0 - px, prevDz = z0 - pz;
      const prevHeadingIdx = DIR_VEC.findIndex(([vx, vz]) => vx === prevDx && vz === prevDz);
      const curHeadingIdx = DIR_VEC.findIndex(([vx, vz]) => vx === dx && vz === dz);
      const turn = ((curHeadingIdx - prevHeadingIdx) + 4) % 4;
      if (turn === 1) type = 'turn_right';
      else if (turn === 3) type = 'turn_left';
    }
    if (dy > 0) type = 'ramp_up';
    else if (dy < 0) type = 'ramp_down';

    pieces.push({
      index: i,
      type,
      x: x0, y: y0, z: z0,
      heading,
    });
  }
  return pieces;
}

function placeCheckpoints(pieces, everyN) {
  const checkpoints = [];
  for (let i = 0; i < pieces.length; i += everyN) {
    checkpoints.push(pieces[i].index);
  }
  return checkpoints;
}

function main() {
  const args = parseArgs(process.argv);
  const rng = mulberry32(args.seed);

  const { path, closed } = generateLoop(rng, args.pieces, args.maxHeight);
  if (!closed) {
    console.error('Could not close a loop with these parameters - try a different --seed or fewer --pieces.');
    process.exit(1);
  }

  const pieces = classifyPieces(path);
  const checkpoints = placeCheckpoints(pieces, 5);

  const track = {
    seed: args.seed,
    pieceCount: pieces.length,
    pieces,
    checkpoints,
  };

  // Console preview: simple top-down ASCII map
  printAsciiMap(pieces);
  console.log(`\nGenerated a closed loop: ${pieces.length} pieces, ${checkpoints.length} checkpoints, seed ${args.seed}`);

  if (args.out) {
    require('fs').writeFileSync(args.out, JSON.stringify(track, null, 2));
    console.log(`Wrote layout to ${args.out}`);
  } else {
    console.log('\nFull JSON (pass --out track.json to save instead of printing):');
    console.log(JSON.stringify(track, null, 2));
  }
}

function printAsciiMap(pieces) {
  const xs = pieces.map(p => p.x), zs = pieces.map(p => p.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const grid = [];
  for (let z = minZ; z <= maxZ; z++) {
    let row = '';
    for (let x = minX; x <= maxX; x++) {
      const p = pieces.find(pp => pp.x === x && pp.z === z);
      if (!p) { row += '.'; continue; }
      if (p.type === 'straight') row += (p.heading === 'E' || p.heading === 'W') ? '-' : '|';
      else if (p.type.startsWith('turn')) row += '+';
      else row += '^'; // ramp
    }
    grid.push(row);
  }
  console.log('Top-down layout preview:');
  console.log(grid.join('\n'));
}

main();
