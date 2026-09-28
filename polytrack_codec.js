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
  CP_IDS, START_IDS, FINISH_ID, DIR_NAMES, ENV_NAMES,
};

if (require.main === module) {
  const code = process.argv[2];
  const { name, author, lastModified, trackData } = decodeTrackCodeV6(code);
  console.log('name:', JSON.stringify(name), 'author:', JSON.stringify(author), 'lastModified:', lastModified);
  console.log('trackData bytes:', trackData.length);
  const info = decodeTrackDataV6(trackData);
  console.log(JSON.stringify(info, null, 2));
}
