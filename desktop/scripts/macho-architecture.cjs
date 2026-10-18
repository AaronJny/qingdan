'use strict';
// Read Mach-O headers directly. No lipo, executable launch, or host-architecture
// inference: renamed ARM binaries must never pass as an Intel release.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const MAGIC = new Map([
  ['feedface', { little: false, bits: 32 }], ['cefaedfe', { little: true, bits: 32 }],
  ['feedfacf', { little: false, bits: 64 }], ['cffaedfe', { little: true, bits: 64 }],
  ['cafebabe', { little: false, fat: 32 }], ['bebafeca', { little: true, fat: 32 }],
  ['cafebabf', { little: false, fat: 64 }], ['bfbafeca', { little: true, fat: 64 }],
]);
const architecture = cpu => ({ 7: 'ia32', 12: 'arm', 0x01000007: 'x64', 0x0100000c: 'arm64' })[cpu] || `unknown-${cpu.toString(16)}`;
function parseReader(read, length, label) {
  const take = (offset, count, end = length) => {
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(count) && offset >= 0 && count >= 0 && offset <= end && count <= end - offset, `Truncated Mach-O: ${label}`);
    const bytes = read(offset, count); assert.equal(bytes.length, count, `Truncated Mach-O: ${label}`); return bytes;
  };
  if (length < 4) return null;
  const magic = MAGIC.get(take(0, 4).toString('hex'));
  if (!magic) return null;
  const thin = (offset, size) => {
    const end = offset + size, type = MAGIC.get(take(offset, 4, end).toString('hex'));
    assert(type && !type.fat, `Invalid nested Mach-O slice: ${label}`);
    const headerSize = type.bits === 64 ? 32 : 28, header = take(offset, headerSize, end);
    const u32 = start => type.little ? header.readUInt32LE(start) : header.readUInt32BE(start);
    const cpuType = u32(4), cpuSubtype = u32(8), ncmds = u32(16), sizeofcmds = u32(20);
    assert.equal(Boolean(cpuType & 0x01000000), type.bits === 64, `Mach-O CPU/header width mismatch: ${label}`);
    assert(sizeofcmds <= size - headerSize && ncmds <= Math.floor(sizeofcmds / 8), `Invalid Mach-O load commands: ${label}`);
    let cursor = offset + headerSize;
    const commandsEnd = cursor + sizeofcmds;
    for (let i = 0; i < ncmds; i++) {
      const command = take(cursor, 8, commandsEnd), commandSize = type.little ? command.readUInt32LE(4) : command.readUInt32BE(4);
      assert(commandSize >= 8 && commandSize % (type.bits === 64 ? 8 : 4) === 0 && commandSize <= commandsEnd - cursor, `Invalid Mach-O load command size: ${label}`);
      cursor += commandSize;
    }
    assert.equal(cursor, commandsEnd, `Mach-O load command coverage mismatch: ${label}`);
    return { architecture: architecture(cpuType), cpuType, cpuSubtype, bits: type.bits };
  };
  if (!magic.fat) {
    const slice = thin(0, length);
    return { format: `mach-o${slice.bits}`, architectures: [slice.architecture], slices: [slice] };
  }
  const header = take(0, 8), count = magic.little ? header.readUInt32LE(4) : header.readUInt32BE(4), entrySize = magic.fat === 64 ? 32 : 20;
  assert(count > 0 && count <= 64 && count <= Math.floor((length - 8) / entrySize), `Invalid Mach-O fat slice count: ${label}`);
  const tableEnd = 8 + count * entrySize, slices = [], ranges = [];
  for (let i = 0; i < count; i++) {
    const entry = take(8 + i * entrySize, entrySize);
    const u32 = start => magic.little ? entry.readUInt32LE(start) : entry.readUInt32BE(start);
    const u64 = start => {
      const value = magic.little ? entry.readBigUInt64LE(start) : entry.readBigUInt64BE(start);
      assert(value <= BigInt(Number.MAX_SAFE_INTEGER), `Unsafe Mach-O fat offset/size: ${label}`); return Number(value);
    };
    const offset = magic.fat === 64 ? u64(8) : u32(8), size = magic.fat === 64 ? u64(16) : u32(12), align = u32(magic.fat === 64 ? 24 : 16);
    assert(offset >= tableEnd && size >= 28 && offset <= length && size <= length - offset, `Invalid Mach-O fat slice bounds: ${label}`);
    assert(align <= 52 && offset % (2 ** align) === 0, `Invalid Mach-O fat alignment: ${label}`);
    if (magic.fat === 64) assert.equal(u32(28), 0, `Invalid Mach-O fat reserved field: ${label}`);
    assert(ranges.every(range => offset >= range.end || offset + size <= range.start), `Overlapping Mach-O fat slices: ${label}`);
    const slice = thin(offset, size);
    assert.equal(slice.cpuType, u32(0), `Mach-O fat CPU type differs from slice: ${label}`);
    assert.equal(slice.cpuSubtype, u32(4), `Mach-O fat CPU subtype differs from slice: ${label}`);
    assert(!slices.some(previous => previous.cpuType === slice.cpuType && previous.cpuSubtype === slice.cpuSubtype), `Duplicate Mach-O fat slice: ${label}`);
    ranges.push({ start: offset, end: offset + size }); slices.push(slice);
  }
  return { format: `fat${magic.fat}`, architectures: [...new Set(slices.map(slice => slice.architecture))].sort(), slices };
}
function parseMachO(bytes, label = 'buffer') {
  assert(Buffer.isBuffer(bytes), 'Mach-O input must be a Buffer');
  return parseReader((offset, count) => bytes.subarray(offset, offset + count), bytes.length, label);
}
function inspectMachOFile(file) {
  const descriptor = fs.openSync(file, 'r');
  try {
    return parseReader((offset, count) => {
      const bytes = Buffer.alloc(count); let done = 0;
      while (done < count) { const size = fs.readSync(descriptor, bytes, done, count - done, offset + done); if (!size) break; done += size; }
      return bytes.subarray(0, done);
    }, fs.fstatSync(descriptor).size, file);
  } finally { fs.closeSync(descriptor); }
}
function assertTargetMachO(info, arch, label) {
  assert(['x64', 'arm64'].includes(arch), `Unsupported macOS architecture: ${arch}`);
  assert(info, `Required native file is not Mach-O: ${label}`);
  assert.deepEqual(info.architectures, [arch], `Mach-O architecture must be exactly ${arch}: ${label}`);
  assert(info.slices.every(slice => slice.bits === 64), `Required 64-bit Mach-O: ${label}`);
  return { path: label, format: info.format, architectures: info.architectures };
}
module.exports = { parseMachO, inspectMachOFile, assertTargetMachO };
