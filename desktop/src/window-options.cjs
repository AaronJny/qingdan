'use strict';
const { MIN_WIDTH, MIN_HEIGHT } = require('./window-state.cjs');
const SECURE_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
  safeDialogs: true,
  navigateOnDragDrop: false,
  spellcheck: false, // No implicit external dictionary downloads in standalone mode.
});
function windowOptions({ platform, title, state, partition, packaged, icon }) {
  return {
    x: state.x, y: state.y, width: state.width, height: state.height,
    minWidth: Math.min(MIN_WIDTH, state.width), minHeight: Math.min(MIN_HEIGHT, state.height), show: false,
    title, backgroundColor: '#f7f8fa', icon,
    frame: true,
    titleBarStyle: 'default',
    autoHideMenuBar: platform !== 'darwin',
    webPreferences: { ...SECURE_WEB_PREFERENCES, partition, devTools: !packaged },
  };
}
module.exports = { SECURE_WEB_PREFERENCES, windowOptions };
