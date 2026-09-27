'use strict';
const { encodeTrackDataV6, encodeTrackCodeV6, decodeTrackCodeV6, decodeTrackDataV6 } = require('./polytrack_codec.js');

// Confirmed IDs: 0=straight, 5=start, 75=checkpoint, 36=curve (fixed right-turn shape, rotation 0-3 = facing dir)
// EXPERIMENT: build a 4-sided loop using straight + right-curve, cycling rotation 0->1->2->3 at each
// successive curve. If the loop doesn't close correctly in-game, the rotation cycle direction or
// offset is what needs adjusting (easy one-line fix once we see how it actually looks).
const STEP = 4;
const STRAIGHTS_PER_SIDE = 3; // pieces per side of the rectangle

function buildOvalTrack() {
  const straightBlocks = [];
  const curveBlocks = [];
  let x = 0, z = 0;
  let curveRotation = 0;

  // side order: we don't know the true compass mapping, so we just walk a square path in our
  // OWN x/z bookkeeping (visual shape may come out rotated/mirrored - that's what we're testing)
  const sideDirs = [ [0, -1], [1, 0], [0, 1], [-1, 0] ]; // dz/dx per side, purely for our own bookkeeping

  let firstStraightPos = null;

  for (let side = 0; side < 4; side++) {
    const [dx, dz] = sideDirs[side];
    // straight pieces need the same 4-value heading rotation as curves, not just axis
    // parity - there are 4 distinct headings around a rectangular loop, not 2.
    const straightRotation = side;
    for (let i = 0; i < STRAIGHTS_PER_SIDE; i++) {
      x += dx * STEP; z += dz * STEP;
      if (firstStraightPos === null) firstStraightPos = { x, z };
      straightBlocks.push({ x, y: 0, z, rotation: straightRotation, dir: 'YPos', color: 0 });
    }
    // place a curve at the corner, rotation cycles 0,1,2,3
    x += dx * STEP; z += dz * STEP;
    curveBlocks.push({ x, y: 0, z, rotation: curveRotation, dir: 'YPos', color: 0 });
    curveRotation = (curveRotation + 1) % 4;
  }

  // start piece REPLACES the very first straight (same cell) rather than taking a new
  // cell - a perfect closed rectangle returns exactly to its own starting corner, so
  // there's no free adjacent cell to add a new piece into without colliding.
  const startSource = straightBlocks.shift();
  const startBlock = { x: startSource.x, y: 0, z: startSource.z, rotation: startSource.rotation, dir: 'YPos', color: 0, startOrder: 0 };
  // checkpoint REPLACES one of the straight positions (same cell, same rotation) rather
  // than duplicating it - a track editor grid cell can only hold one piece.
  const cpIndex = Math.floor(straightBlocks.length / 2);
  const cpSource = straightBlocks.splice(cpIndex, 1)[0];
  const cpBlock = { ...cpSource, cpOrder: 0 };

  const parts = [
    { id: 0, amount: straightBlocks.length, blocks: straightBlocks },
    { id: 36, amount: curveBlocks.length, blocks: curveBlocks },
    { id: 5, amount: 1, blocks: [startBlock] },
    { id: 75, amount: 1, blocks: [cpBlock] },
  ];

  // compute bounds to keep coordinates non-negative (shift everything if needed)
  let minXv = 0, minZv = 0;
  for (const p of parts) for (const b of p.blocks) { minXv = Math.min(minXv, b.x); minZv = Math.min(minZv, b.z); }
  const shiftX = -minXv, shiftZ = -minZv;
  for (const p of parts) for (const b of p.blocks) { b.x += shiftX; b.z += shiftZ; }

  return {
    env: 'Summer', sunDir: 127,
    minX: 0, minY: 0, minZ: 0,
    dataBytes: 1 | (1 << 2) | (1 << 4),
    parts,
  };
}

const info = buildOvalTrack();
const trackData = encodeTrackDataV6(info);
const code = encodeTrackCodeV6({ name: 'AI Oval Test', author: null, lastModified: null, trackData });
console.log('CODE:', code);
console.log('length:', code.length);

const decoded = decodeTrackCodeV6(code);
const decodedInfo = decodeTrackDataV6(decoded.trackData);
console.log('\nround-trip parts summary:');
for (const p of decodedInfo.parts) console.log(' id', p.id, 'amount', p.amount, p.blocks.map(b => `(${b.x},${b.y},${b.z}) rot${b.rotation}`).join(' '));

if (process.env.OUTPUT_FILE) {
  require('fs').writeFileSync(process.env.OUTPUT_FILE, code + '\n');
}
