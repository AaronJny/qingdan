'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_BOUNDS = Object.freeze({ width: 1280, height: 840 });
const MIN_WIDTH = 860;
const MIN_HEIGHT = 600;
function normalizeState(raw, displays) {
  const areas = displays.map(display => display.workArea || display).filter(area => Number.isFinite(area.x) && Number.isFinite(area.y) && area.width > 0 && area.height > 0);
  const primary = areas[0] || { x: 0, y: 0, width: 1920, height: 1080 };
  const candidate = raw && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(raw[key])) && raw.width > 0 && raw.height > 0 ? raw : null;
  const area = candidate && areas.find(a => candidate.x < a.x + a.width && candidate.x + candidate.width > a.x && candidate.y < a.y + a.height && candidate.y + candidate.height > a.y) || primary;
  const width = Math.min(area.width, Math.max(Math.min(MIN_WIDTH, area.width), candidate?.width || DEFAULT_BOUNDS.width));
  const height = Math.min(area.height, Math.max(Math.min(MIN_HEIGHT, area.height), candidate?.height || DEFAULT_BOUNDS.height));
  const x = Math.min(area.x + area.width - width, Math.max(area.x, candidate?.x ?? area.x + Math.round((area.width - width) / 2)));
  const y = Math.min(area.y + area.height - height, Math.max(area.y, candidate?.y ?? area.y + Math.round((area.height - height) / 2)));
  return { x, y, width, height, maximized: !!candidate && raw.maximized === true };
}
function readState(file, displays) {
  try { return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')), displays); }
  catch { return normalizeState(null, displays); }
}
function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
module.exports = { DEFAULT_BOUNDS, MIN_WIDTH, MIN_HEIGHT, normalizeState, readState, saveState };
