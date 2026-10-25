import { CORE_URL, FFMessageType } from './ffmpeg-worker-const.js';
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_IMPORT_FAILURE } from './ffmpeg-worker-errors.js';

let ffmpeg;

const load = async ({ coreURL: suppliedCoreURL, wasmURL: suppliedWasmURL, workerURL: suppliedWorkerURL }) => {
  const coreURL = suppliedCoreURL || CORE_URL;
  let createFFmpegCore;
  try {
    createFFmpegCore = (await import(/* @vite-ignore */ coreURL)).default;
  } catch {
    throw ERROR_IMPORT_FAILURE;
  }
  if (!createFFmpegCore) throw ERROR_IMPORT_FAILURE;
  const wasmURL = suppliedWasmURL || coreURL.replace(/\.js$/g, '.wasm');
  const workerURL = suppliedWorkerURL || coreURL.replace(/\.js$/g, '.worker.js');
  ffmpeg = await createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));
  return true;
};

const exec = ({ args, timeout = -1 }) => { ffmpeg.setTimeout(timeout); ffmpeg.exec(...args); const ret = ffmpeg.ret; ffmpeg.reset(); return ret; };
const ffprobe = ({ args, timeout = -1 }) => { ffmpeg.setTimeout(timeout); ffmpeg.ffprobe(...args); const ret = ffmpeg.ret; ffmpeg.reset(); return ret; };
const writeFile = ({ path, data }) => { ffmpeg.FS.writeFile(path, data); return true; };
const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });
const deleteFile = ({ path }) => { ffmpeg.FS.unlink(path); return true; };
const rename = ({ oldPath, newPath }) => { ffmpeg.FS.rename(oldPath, newPath); return true; };
const createDir = ({ path }) => { ffmpeg.FS.mkdir(path); return true; };
const listDir = ({ path }) => ffmpeg.FS.readdir(path).map((name) => ({ name, isDir: ffmpeg.FS.isDir(ffmpeg.FS.stat(`${path}/${name}`).mode) }));
const deleteDir = ({ path }) => { ffmpeg.FS.rmdir(path); return true; };
const mount = ({ fsType, options, mountPoint }) => { const fs = ffmpeg.FS.filesystems[fsType]; if (!fs) return false; ffmpeg.FS.mount(fs, options, mountPoint); return true; };
const unmount = ({ mountPoint }) => { ffmpeg.FS.unmount(mountPoint); return true; };

self.onmessage = async ({ data: { id, type, data } }) => {
  const transferables = [];
  let result;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;
    switch (type) {
      case FFMessageType.LOAD: result = await load(data); break;
      case FFMessageType.EXEC: result = exec(data); break;
      case FFMessageType.FFPROBE: result = ffprobe(data); break;
      case FFMessageType.WRITE_FILE: result = writeFile(data); break;
      case FFMessageType.READ_FILE: result = readFile(data); break;
      case FFMessageType.DELETE_FILE: result = deleteFile(data); break;
      case FFMessageType.RENAME: result = rename(data); break;
      case FFMessageType.CREATE_DIR: result = createDir(data); break;
      case FFMessageType.LIST_DIR: result = listDir(data); break;
      case FFMessageType.DELETE_DIR: result = deleteDir(data); break;
      case FFMessageType.MOUNT: result = mount(data); break;
      case FFMessageType.UNMOUNT: result = unmount(data); break;
      default: throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: error.toString() });
    return;
  }
  if (result instanceof Uint8Array) transferables.push(result.buffer);
  self.postMessage({ id, type, data: result }, transferables);
};
