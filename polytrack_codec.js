'use strict';
const zlib = require('zlib');

const ENCODE_VALUES = (
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
).split('');
const DECODE_VALUES = new Array(123).fill(-1);
for (let i = 0; i < ENCODE_VALUES.length; i++) {
  DECODE_VALUES[ENCODE_VALUES[i].charCodeAt(0)] = i;
}

function encodeChars(bytes, bitIndex) {
  if (bitIndex >= 8 * bytes.length) return null;
  const byteIndex = Math.floor(bitIndex / 8);
  const currentByte = bytes[byteIndex];
  const offset = bitIndex - 8 * byteIndex;
  if (offset <= 2 || byteIndex >= bytes.length - 1) {
    return (currentByte & (63 << offset)) >> offset;
  } else {
    const nextByte = bytes[byteIndex + 1];
    return ((currentByte & (63 << offset)) >> offset) | ((nextByte & (63 >> (8 - offset))) << (8 - offset));
  }
}

function customEncode(bytes) {
  let bitPos = 0;
  let res = '';
  while (bitPos < 8 * bytes.length) {
    let charValue = encodeChars(bytes, bitPos);
    if ((charValue & 30) === 30) { charValue &= 31; bitPos += 5; }
    else { bitPos += 6; }
    res += ENCODE_VALUES[charValue];
  }
  return res;
}

function decodeChars(bytesOut, bitIndex, valueLen, charValue, isLast) {
  const byteIndex = Math.floor(bitIndex / 8);
  while (byteIndex >= bytesOut.length) bytesOut.push(0);
  const offset = bitIndex - 8 * byteIndex;
  bytesOut[byteIndex] |= (charValue << offset) & 0xFF;
  if (offset > 8 - valueLen && !isLast) {
    const nextIdx = byteIndex + 1;
    if (nextIdx >= bytesOut.length) bytesOut.push(0);
    bytesOut[nextIdx] |= (charValue >> (8 - offset)) & 0xFF;
  }
}

function customDecode(input) {
  let outPos = 0;
  const bytesOut = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code >= DECODE_VALUES.length) return null;
    const charValue = DECODE_VALUES[code];
    if (charValue === -1) return null;
    const valueLen = (charValue & 30) === 30 ? 5 : 6;
    decodeChars(bytesOut, outPos, valueLen, charValue, i === input.length - 1);
    outPos += valueLen;
  }
  return Buffer.from(bytesOut);
}

function zlibDecompress(buf) { return zlib.inflateSync(buf); }
function zlibCompress(buf, windowBits) { return zlib.deflateSync(buf, { level: 9, windowBits }); }

function readU32(buf, o) { const v = (buf[o.v] | (buf[o.v+1] << 8) | (buf[o.v+2] << 16) | (buf[o.v+3] << 24)) >>> 0; o.v += 4; return v; }
function readU16(buf, o) { const v = buf[o.v] | (buf[o.v+1] << 8); o.v += 2; return v; }
function writeU32(arr, v) { arr.push(v & 0xFF, (v>>>8)&0xFF, (v>>>16)&0xFF, (v>>>24)&0xFF); }
function writeU16(arr, v) { arr.push(v & 0xFF, (v>>>8)&0xFF); }

const CP_IDS = [52, 65, 75, 77];
const START_IDS = [5, 91, 92, 93];
const FINISH_ID = 6; // confirmed via real exported test track

// Official piece name -> numerical id, from PolyModLoader's PML API docs
// (https://wiki-vp.polymodloader.com/pmlapi/EditorExtras) - this is the authoritative
// source; every id we'd independently reverse-engineered (0, 5, 6, 36, 52/65/75/77,
// 5/91/92/93) matches it exactly.
const PART_NAMES = {
  Straight: 0, TurnSharp: 1, SlopeUp: 2, SlopeDown: 3, Slope: 4, Start: 5, Finish: 6,
  ToWideMiddle: 7, ToWideLeft: 8, ToWideRight: 9, StraightWide: 10, InnerCornerWide: 11,
  OuterCornerWide: 12, SlopeUpLeftWide: 13, SlopeUpRightWide: 14, SlopeDownLeftWide: 15,
  SlopeDownRightWide: 16, SlopeLeftWide: 17, SlopeRightWide: 18, PillarTop: 19,
  PillarMiddle: 20, PillarBottom: 21, PillarShort: 22, PlanePillarBottom: 23,
  PlanePillarShort: 24, Plane: 25, PlaneWall: 26, PlaneWallCorner: 27,
  PlaneWallInnerCorner: 28, Block: 29, WallTrackTop: 30, WallTrackMiddle: 31,
  WallTrackBottom: 32, PlaneSlopeUp: 33, PlaneSlopeDown: 34, PlaneSlope: 35,
  TurnShort: 36, TurnLong: 37, SlopeUpLong: 38, SlopeDownLong: 39, TurnSLeft: 41,
  TurnSRight: 42, IntersectionT: 43, IntersectionCross: 44, PillarBranch1: 45,
  PillarBranch2: 46, PillarBranch3: 47, PillarBranch4: 48, WallTrackBottomCorner: 49,
  WallTrackMiddleCorner: 50, WallTrackTopCorner: 51, Checkpoint: 52, HalfBlock: 53,
  QuarterBlock: 54, HalfPlane: 55, QuarterPlane: 56, PlaneBridge: 57,
  SignArrowLeft: 58, SignArrowRight: 59, SignArrowUp: 61, SignArrowDown: 62,
  SignWarning: 63, SignWrongWay: 64, CheckpointWide: 65, WallTrackCeiling: 66,
  WallTrackFloor: 67, BlockSlopedDown: 68, BlockSlopedDownInnerCorner: 69,
  BlockSlopedDownOuterCorner: 70, BlockSlopedUp: 71, BlockSlopedUpInnerCorner: 72,
  BlockSlopedUpOuterCorner: 73, FinishWide: 74, PlaneCheckpoint: 75, PlaneFinish: 76,
  PlaneCheckpointWide: 77, PlaneFinishWide: 78, WallTrackBottomInnerCorner: 79,
  WallTrackInnerCorner: 80, WallTrackTopInnerCorner: 81, TurnLong2: 82, TurnLong3: 83,
  BlockSlopeUp: 85, BlockSlopeDown: 86, BlockSlopeVerticalTop: 87,
  BlockSlopeVerticalBottom: 88, PlaneSlopeVerticalBottom: 90, StartWide: 91,
  PlaneStart: 92, PlaneStartWide: 93, TurnShortLeftWide: 94, TurnShortRightWide: 95,
  TurnLongLeftWide: 96, TurnLongRightWide: 97, SlopeUpVertical: 98, IntersectionY: 99,
  IntersectionYLong: 100, PillarBranch1Top: 101, PillarBranch1Bottom: 102,
  PillarBranch1Middle: 103, PillarBranch2Top: 104, PillarBranch2Middle: 105,
  PillarBranch2Bottom: 106, PillarBranch3Top: 107, PillarBranch3Middle: 108,
  PillarBranch3Bottom: 109, PillarBranch4Top: 110, PillarBranch4Middle: 111,
  PillarBranch4Bottom: 112, PillarBranch5: 113, PillarBranch5Top: 114,
  PillarBranch5Middle: 115, PillarBranch5Bottom: 116, ToWideDouble: 117,
  ToWideDiagonal: 118, StraightPillarBottom: 119, StraightPillarShort: 120,
  TurnSharpPillarBottom: 121, TurnSharpPillarShort: 122, IntersectionTPillarBottom: 123,
  IntersectionTPillarShort: 124, IntersectionCrossPillarBottom: 125,
  IntersectionCrossPillarShort: 126, PlaneBridgeCorner: 127,
  PlaneBridgeIntersectionT: 128, PlaneBridgeIntersectionCross: 129, BlockBridge: 130,
  BlockBridgeCorner: 131, BlockBridgeIntersectionT: 132,
  BlockBridgeIntersectionCross: 133, WallTrackCeilingCorner: 134,
  WallTrackCeilingPlaneCorner: 135, WallTrackFloorCorner: 136,
  WallTrackFloorPlaneCorner: 137, SlopeUpVerticalLeftWide: 138,
  SlopeUpVerticalRightWide: 139, BlockSlopeVerticalCornerTop: 140,
  BlockSlopeVerticalCornerBottom: 141, WallTrackSlopeToVertical: 142,
  PlaneSlopeToVertical: 143, BlockSlopeToVertical: 144, PlaneSlopeUpLong: 145,
  PlaneSlopeDownLong: 146, SlopeUpLongLeftWide: 147, SlopeUpLongRightWide: 148,
  SlopeDownLongLeftWide: 149, SlopeDownLongRightWide: 150, BlockSlopeUpLong: 151,
  BlockSlopeDownLong: 152, BlockSlopeVerticalInnerCornerBottom: 153,
  BlockSlopeVerticalInnerCornerTop: 154, BlockInnerCorner: 155,
  SlopeToVertical: 156, SlopeToVerticalLeftWide: 157, SlopeToVerticalRightWide: 158,
  StraightTilted: 159, TurnShortTilted: 160, TurnLongTilted: 161,
  TurnLong2Tilted: 162, TurnLong3Tilted: 163, TurnSLongLeft: 164, TurnSLongRight: 165,
  ToTiltedLeft: 166, ToTiltedRight: 167, PillarTopSlope: 168, PillarShortSlope: 169,
  HalfPlaneSlopeBottomLeft: 170, HalfPlaneSlopeBottomRight: 171,
  HalfPlaneSlopeTopLeft: 172, HalfPlaneSlopeTopRight: 173,
  HalfBlockSlopeBottomLeft: 174, HalfBlockSlopeBottomRight: 175,
  HalfBlockSlopeTopLeft: 176, HalfBlockSlopeTopRight: 177, PlaneWallSlopeLeft: 178,
  PlaneWallSlopeRight: 179, PlaneWallSlopeUpLeft: 180, PlaneWallSlopeUpRight: 181,
  PlaneWallSlopeDownLeft: 182, PlaneWallSlopeDownRight: 183,
  PlaneWallSlopeUpLongLeft: 184, PlaneWallSlopeUpLongRight: 185,
  PlaneWallSlopeDownLongLeft: 186, PlaneWallSlopeDownLongRight: 187,
  BlockOuterCorner: 188, PlaneCorner: 189,
};
const PART_ID_TO_NAME = Object.fromEntries(Object.entries(PART_NAMES).map(([n, i]) => [i, n]));
const DIR_NAMES = ['YPos', 'YNeg', 'XPos', 'XNeg', 'ZPos', 'ZNeg'];
const ENV_NAMES = ['Summer', 'Winter', 'Desert'];

// ---------------- v6 = "PolyTrack2" (current) ----------------
function decodeTrackCodeV6(trackCode) {
  const rest = trackCode.slice(10); // skip "PolyTrack2"
  const idx = rest.indexOf('4p');
  if (idx === -1) throw new Error('could not find 4p marker');
  const trackDataB62 = rest.slice(idx);

  const step1 = customDecode(trackDataB62);
  const step2 = zlibDecompress(step1);
  const step2Str = step2.toString('utf8');
  const step3 = customDecode(step2Str);
  const step4 = zlibDecompress(step3);

  const nameLen = step4[0];
  const name = step4.slice(1, 1 + nameLen).toString('utf8');
  const authorLen = step4[1 + nameLen];
  const authorStart = nameLen + 2;
  const author = authorLen ? step4.slice(authorStart, authorStart + authorLen).toString('utf8') : null;

  let pos = authorStart + authorLen;
  const lastmodExists = step4[pos]; pos += 1;
  let lastModified = null;
  if (lastmodExists === 1) {
    lastModified = (step4[pos] | step4[pos+1]<<8 | step4[pos+2]<<16 | step4[pos+3]<<24) >>> 0;
    pos += 4;
  }
  const trackData = step4.slice(pos);
  return { name, author, lastModified, trackData };
}

function decodeTrackDataV6(data) {
  const o = { v: 0 };
  const env = data[o.v]; o.v++;
  const sunDir = data[o.v]; o.v++;
  const minX = readU32(data, o) | 0;
  const minY = readU32(data, o) | 0;
  const minZ = readU32(data, o) | 0;
  const dataBytes = data[o.v]; o.v++;
  const xBytes = dataBytes & 3;
  const yBytes = (dataBytes >> 2) & 3;
  const zBytes = (dataBytes >> 4) & 3;

  const parts = [];
  while (o.v < data.length) {
    const id = data[o.v]; o.v++;
    const amount = readU32(data, o);
    const blocks = [];
    for (let i = 0; i < amount; i++) {
      let x = 0; for (let b = 0; b < xBytes; b++) { x |= data[o.v + b] << (8*b); } o.v += xBytes;
      let y = 0; for (let b = 0; b < yBytes; b++) { y |= data[o.v + b] << (8*b); } o.v += yBytes;
      let z = 0; for (let b = 0; b < zBytes; b++) { z |= data[o.v + b] << (8*b); } o.v += zBytes;

      const rotDir = data[o.v]; o.v++;
      const rotation = rotDir & 3;
      const dirVal = (rotDir >> 2) & 7;
      const color = data[o.v]; o.v++;

      let cpOrder = null, startOrder = null;
      if (CP_IDS.includes(id)) { cpOrder = readU16(data, o); }
      if (START_IDS.includes(id)) { startOrder = readU32(data, o); }
      blocks.push({ x, y, z, rotation, dir: DIR_NAMES[dirVal] || dirVal, color, cpOrder, startOrder });
    }
    parts.push({ id, amount, blocks });
  }
  return { env: ENV_NAMES[env], sunDir, minX, minY, minZ, dataBytes, xBytes, yBytes, zBytes, parts };
}

function encodeTrackDataV6(info) {
  // Safety net: refuse to encode if any two blocks occupy the exact same grid cell -
  // that's the "random overlapping piece" failure mode. Report which ones collided
  // instead of silently producing a broken track.
  const seen = new Map();
  for (const part of info.parts) {
    for (const b of part.blocks) {
      const key = `${b.x},${b.y},${b.z}`;
      if (seen.has(key)) {
        const other = seen.get(key);
        throw new Error(`Overlapping pieces at (${b.x},${b.y},${b.z}): part id ${part.id} collides with part id ${other}. Move or remove one of them.`);
      }
      seen.set(key, part.id);
    }
  }

  const arr = [];
  arr.push(ENV_NAMES.indexOf(info.env));
  arr.push(info.sunDir);
  writeU32(arr, info.minX >>> 0);
  writeU32(arr, info.minY >>> 0);
  writeU32(arr, info.minZ >>> 0);
  arr.push(info.dataBytes);
  const xBytes = info.dataBytes & 3, yBytes = (info.dataBytes>>2)&3, zBytes=(info.dataBytes>>4)&3;
  for (const part of info.parts) {
    arr.push(part.id);
    writeU32(arr, part.amount);
    for (const b of part.blocks) {
      const writeN = (val, n) => { for (let i=0;i<n;i++) arr.push((val >>> (8*i)) & 0xFF); };
      writeN(b.x, xBytes); writeN(b.y, yBytes); writeN(b.z, zBytes);
      const dirIdx = typeof b.dir === 'string' ? DIR_NAMES.indexOf(b.dir) : b.dir;
      arr.push((b.rotation & 3) | ((dirIdx & 7) << 2));
      arr.push(b.color);
      if (b.cpOrder != null) writeU16(arr, b.cpOrder);
      if (b.startOrder != null) writeU32(arr, b.startOrder >>> 0);
    }
  }
  return Buffer.from(arr);
}

function encodeTrackCodeV6({ name, author, lastModified, trackData }) {
  const data = [];
  const nameBytes = Buffer.from(name, 'utf8');
  data.push(nameBytes.length, ...nameBytes);
  if (author) {
    const authorBytes = Buffer.from(author, 'utf8');
    data.push(authorBytes.length, ...authorBytes);
  } else {
    data.push(0);
  }
  if (lastModified != null) {
    data.push(1);
    writeU32(data, lastModified >>> 0);
  } else {
    data.push(0);
  }
  data.push(...trackData);

  const step1 = zlibCompress(Buffer.from(data), 9);
  const step2Str = customEncode(step1);
  const step2 = Buffer.from(step2Str, 'utf8');
  const step3 = zlibCompress(step2, 15);
  const step4 = customEncode(step3);
  return 'PolyTrack2' + step4;
}

module.exports = {
  customEncode, customDecode, zlibDecompress, zlibCompress,
  decodeTrackCodeV6, decodeTrackDataV6, encodeTrackDataV6, encodeTrackCodeV6,
  CP_IDS, START_IDS, FINISH_ID, DIR_NAMES, ENV_NAMES, PART_NAMES, PART_ID_TO_NAME,
};

if (require.main === module) {
  const code = process.argv[2];
  const { name, author, lastModified, trackData } = decodeTrackCodeV6(code);
  console.log('name:', JSON.stringify(name), 'author:', JSON.stringify(author), 'lastModified:', lastModified);
  console.log('trackData bytes:', trackData.length);
  const info = decodeTrackDataV6(trackData);
  console.log(JSON.stringify(info, null, 2));
}
