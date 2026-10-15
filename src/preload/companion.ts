import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('teammateApi', {
  call: (method: string, args: unknown) => ipcRenderer.invoke('ai:call', method, args),
  onChange: (cb: () => void) => { const listener = () => cb(); ipcRenderer.on('ai:changed', listener); return () => ipcRenderer.removeListener('ai:changed', listener); },
});
