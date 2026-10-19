// Bridge between the sandboxed UI and the main process. Exposed as window.host.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);
const listen = ch => cb => {
  const fn = (e, v) => cb(v);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('host', {
  platform: process.platform,
  engineInfo: () => invoke('engine:info'),
  openFiles: () => invoke('dialog:openFiles'),
  openFolder: () => invoke('dialog:openFolder'),
  openSubtitle: () => invoke('dialog:openSubtitle'),
  expand: paths => invoke('media:expand', paths),
  siblings: file => invoke('media:siblings', file),
  thumb: (file, t, w) => invoke('media:thumb', file, t, w),
  poster: (file, t) => invoke('media:poster', file, t),
  stat: file => invoke('media:stat', file),
  duration: file => invoke('media:duration', file),
  barcode: (file, cols) => invoke('media:barcode', file, cols),
  scanLibrary: folders => invoke('library:scan', folders),
  defaultLibrary: () => invoke('library:defaults'),
  pickFolder: () => invoke('dialog:pickFolder'),
  storeGet: () => invoke('store:get'),
  storeSet: data => ipcRenderer.send('store:set', data),
  snapshotPath: name => invoke('shot:path', name),
  showItem: p => invoke('shell:showItem', p),
  initialFiles: () => invoke('app:initialFiles'),
  pathForFile: file => webUtils.getPathForFile(file),
  win: {
    minimize: () => invoke('win:minimize'),
    toggleMaximize: () => invoke('win:toggleMaximize'),
    close: () => invoke('win:close'),
    setFullScreen: v => invoke('win:setFullScreen', v),
    setAlwaysOnTop: v => invoke('win:setAlwaysOnTop', v),
    resize: (w, h) => invoke('win:resize', w, h),
    state: () => invoke('win:state'),
  },
  onOpenFiles: listen('open-files'),
  onFullScreen: listen('fullscreen'),
  onMaximized: listen('maximized'),
  onEngineRestarted: listen('engine-restarted'),
  debug: { capture: name => invoke('debug:capture', name), quit: () => invoke('debug:quit') },
});
