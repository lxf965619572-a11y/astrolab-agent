// 预加载脚本：界面进程能调用的全部接口。界面拿不到 Node 和 Electron，只能用 window.astro。
const { contextBridge, ipcRenderer } = require('electron')

async function invoke(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args)
  if (!r || !r.ok) throw new Error((r && r.error) || '操作失败')
  return r.data
}

contextBridge.exposeInMainWorld('astro', {
  platform: process.platform,
  getState: () => invoke('app:state'),
  onEvent: (cb) => {
    const h = (_e, m) => cb(m)
    ipcRenderer.on('astro:event', h)
    return () => ipcRenderer.removeListener('astro:event', h)
  },
  project: {
    open: (id) => invoke('project:open', id),
    add: () => invoke('project:add'),
    files: (q) => invoke('project:files', q),
    mentions: (text) => invoke('project:mentions', text),
  },
  task: {
    start: (input) => invoke('task:start', input),
    send: (text) => invoke('task:send', text),
    stop: () => invoke('task:stop'),
    resume: (text) => invoke('task:resume', text),
    answer: (id, answers) => invoke('task:answer', id, answers),
    reset: () => invoke('task:new'),
    open: (id) => invoke('task:open', id),
    history: () => invoke('task:history'),
  },
  review: {
    changes: () => invoke('review:changes'),
    file: (path) => invoke('review:file', path),
    commit: (message, paths) => invoke('review:commit', message, paths),
    undo: () => invoke('review:undoCommit'),
    restore: () => invoke('review:restore'),
  },
  sys: {
    openPath: (rel) => invoke('sys:openPath', rel),
    showItem: (rel) => invoke('sys:showItem', rel),
  },
})
