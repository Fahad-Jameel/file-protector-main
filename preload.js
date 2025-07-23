// preload.js - Updated preload script with server status checking
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  validateLicense: (licenseKey) => ipcRenderer.invoke('validate-license', licenseKey),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  checkServerStatus: () => ipcRenderer.invoke('check-server-status')
});