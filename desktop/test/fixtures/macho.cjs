'use strict';
function thin(arch = 'arm64', { little = true, bits = 64, commands = [] } = {}) {
  const headerSize = bits === 64 ? 32 : 28, bytes = Buffer.alloc(headerSize + commands.reduce((sum, size) => sum + size, 0));
  const write = (value, offset) => little ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset);
  write(bits === 64 ? 0xfeedfacf : 0xfeedface, 0);
  write(({ arm64: 0x0100000c, x64: 0x01000007, arm: 12, ia32: 7 })[arch], 4); write(arch === 'x64' ? 3 : 0, 8);
  write(2, 12); write(commands.length, 16); write(bytes.length - headerSize, 20);
  let offset = headerSize;
  for (const size of commands) { write(1, offset); write(size, offset + 4); offset += size; }
  return bytes;
}
function fat(architectures, { little = false, bits = 32 } = {}) {
  const entrySize = bits === 64 ? 32 : 20, offset = Math.ceil((8 + entrySize * architectures.length) / 32) * 32;
  const bytes = Buffer.alloc(offset + architectures.length * 32);
  const write = (value, at) => little ? bytes.writeUInt32LE(value, at) : bytes.writeUInt32BE(value, at);
  const wide = (value, at) => little ? bytes.writeBigUInt64LE(BigInt(value), at) : bytes.writeBigUInt64BE(BigInt(value), at);
  write(bits === 64 ? 0xcafebabf : 0xcafebabe, 0); write(architectures.length, 4);
  for (let i = 0; i < architectures.length; i++) {
    const payload = thin(architectures[i]), entry = 8 + i * entrySize, start = offset + i * 32;
    write(payload.readUInt32LE(4), entry); write(payload.readUInt32LE(8), entry + 4);
    if (bits === 64) { wide(start, entry + 8); wide(32, entry + 16); write(5, entry + 24); }
    else { write(start, entry + 8); write(32, entry + 12); write(5, entry + 16); }
    payload.copy(bytes, start);
  }
  return bytes;
}
module.exports = { thin, fat };
