// The only bridge between the renderer and the main process. The renderer
// runs sandboxed with no Node access; it gets exactly this API.

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import { Channels, type AppState, type EditorCall, type EditorMessage, type TreeNode, type UiRequest } from "@shared/ipc";

function listen<T>(channel: string, callback: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const host = {
  platform: process.platform,
  /** Runs a named command in the main process (see src/main/commands.ts). */
  call: (name: string, ...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(Channels.command, name, ...args),
  onState: (callback: (state: AppState) => void) => listen(Channels.state, callback),
  onTree: (callback: (tree: TreeNode[]) => void) => listen(Channels.tree, callback),
  onUi: (callback: (request: UiRequest) => void) => listen(Channels.ui, callback),
  onEditorCall: (callback: (call: EditorCall) => void) => listen(Channels.editorCall, callback),
  /** Editor → native messages (REQUIREMENTS §2.1). */
  postEditor: (message: EditorMessage) => ipcRenderer.send(Channels.editorMessage, message),
  /** The file system path of a dropped file. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
};

export type HolocronHost = typeof host;

contextBridge.exposeInMainWorld("holocronHost", host);
