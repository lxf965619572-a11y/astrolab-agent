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
    tree: () => invoke('project:tree'),
    read: (rel) => invoke('project:read', rel),
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
  kb: {
    search: (q, f) => invoke('kb:search', q, f),
    read: (id) => invoke('kb:read', id),
    save: (e) => invoke('kb:save', e),
    remove: (id) => invoke('kb:delete', id),
    publish: (id, target) => invoke('kb:publish', id, target),
  },
  skills: {
    list: () => invoke('skills:list'),
    pin: (name, on) => invoke('skills:pin', name, on),
  },
  lib: {
    state: () => invoke('lib:state'),
    sync: (id) => invoke('lib:sync', id),
    addSource: (s) => invoke('lib:addSource', s),
    removeSource: (id) => invoke('lib:removeSource', id),
    catalog: () => invoke('lib:catalog'),
    install: (key) => invoke('lib:install', key),
    uninstall: (kind, name) => invoke('lib:uninstall', kind, name),
    read: (key) => invoke('lib:readSkill', key),
    submit: (key, target) => invoke('lib:submit', key, target),
    submissions: () => invoke('lib:submissions'),
    pending: (id) => invoke('lib:pending', id),
    pendingFile: (id, ref, path) => invoke('lib:pendingFile', id, ref, path),
    approve: (id, ref) => invoke('lib:approve', id, ref),
    reject: (id, ref) => invoke('lib:reject', id, ref),
    create: (kind, prompt) => invoke('lib:create', kind, prompt),
  },
  sys: {
    titlebar: (c) => invoke('sys:titlebar', c),
    openPath: (rel) => invoke('sys:openPath', rel),
    showItem: (rel) => invoke('sys:showItem', rel),
  },
})
