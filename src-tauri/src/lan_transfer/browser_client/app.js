const statusEl = document.getElementById('status');
const transfersEl = document.getElementById('transfers');
const transferState = new Map();
let canRead = true;
let canUpload = true;
let pendingAccessId = '';

const ICONS = {
  arrowLeft: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 21h14"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
};

function createIcon(name, className = 'icon') {
  const icon = document.createElement('span');
  icon.className = className;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICONS[name] || '';
  return icon;
}

function setStatus(message) {
  statusEl.textContent = message || '';
}

function permissionText(permission) {
  if (permission === 'readOnly') return '只读';
  if (permission === 'uploadOnly') return '仅上传';
  return '读写';
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '-';
  if (value >= 1024 * 1024 * 1024) return (value / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (value >= 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return Math.max(0, Math.round(value)) + ' B';
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-';
  const total = Math.ceil(seconds);
  if (total < 60) return total + 's';
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return minutes + 'm ' + (total % 60) + 's';
  return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

function updateTransfer(id, patch) {
  const prev = transferState.get(id) || { transferred: 0, total: 0, startedAt: Date.now(), updatedAt: Date.now(), status: '等待中' };
  transferState.set(id, { ...prev, ...patch, updatedAt: Date.now() });
  renderTransfers();
}

function renderTransfers() {
  transfersEl.innerHTML = '';
  for (const [id, task] of Array.from(transferState.entries()).reverse()) {
    const row = document.createElement('div');
    row.className = 'transfer-row';
    const total = task.total || 0;
    const percent = total > 0 ? Math.min(100, Math.round((task.transferred / total) * 100)) : 0;
    const elapsed = Math.max(0.001, (Date.now() - task.startedAt) / 1000);
    const speed = task.transferred / elapsed;
    const eta = speed > 0 && total > task.transferred ? (total - task.transferred) / speed : 0;
    row.innerHTML = `
      <div class="transfer-top">
        <span class="transfer-name">${escapeHtml(task.direction)} · ${escapeHtml(task.name)}</span>
        <span class="${task.failed ? 'danger' : ''}">${escapeHtml(task.status)}</span>
      </div>
      <div class="progress"><div style="width:${percent}%"></div></div>
      <div class="transfer-meta">
        <span>${formatBytes(task.transferred)} / ${total ? formatBytes(total) : '-'}</span>
        <span>${formatBytes(speed)}/s · 剩余 ${formatEta(eta)}</span>
      </div>`;
    if (task.failed && task.retry) {
      const actions = document.createElement('div');
      actions.className = 'transfer-actions';
      const retry = document.createElement('button');
      retry.className = 'button button-secondary';
      retry.textContent = '重试';
      retry.onclick = task.retry;
      actions.append(retry);
      row.append(actions);
    }
    transfersEl.append(row);
  }
}

function clearFinishedTransfers() {
  for (const [id, task] of transferState) {
    if (task.status === '完成' || task.status === '已跳过') transferState.delete(id);
  }
  renderTransfers();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function showCompatibilityHints() {
  const hints = [];
  if (!window.File || !window.FormData) hints.push('当前浏览器的文件上传能力可能不完整，建议使用新版 Chrome、Edge、Safari 或 Firefox。');
  document.getElementById('compat').innerHTML = hints.map(hint => `<div class="notice">${escapeHtml(hint)}</div>`).join('');
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error('status request failed');
    const status = await response.json();
    canRead = status.canRead !== false;
    canUpload = status.canUpload !== false;
    document.getElementById('permission').textContent = permissionText(status.permission);
    document.getElementById('shares-panel').hidden = !canRead;
    document.getElementById('upload-panel').hidden = !canUpload;
    document.getElementById('transfers-panel').hidden = !canUpload;
    const permissionMode = canRead && canUpload ? 'read-write' : canRead ? 'read-only' : 'upload-only';
    document.querySelector('.shell').dataset.permissionMode = permissionMode;
    if (!status.authorized) {
      if (status.authMode === 'confirm' || status.authMode === 'trusted') {
        await requestAccess();
      } else if (status.authMode === 'code') {
        setStatus('请输入确认码授权');
      } else {
        setStatus('等待授权');
      }
      return;
    }
    setStatus('');
    if (canRead) await load();
  } catch (error) {
    setStatus('无法连接传输服务，请刷新页面重试');
  }
}

async function requestAccess() {
  if (!pendingAccessId) {
    const res = await fetch('/api/request-access?type=browser', { method: 'POST' });
    if (!res.ok) { setStatus('访问申请发送失败'); return; }
    const data = await res.json();
    pendingAccessId = data.id || '';
  }
  document.getElementById('auth').innerHTML = '<div class="notice">已发送访问申请，请等待此电脑确认。</div>';
  setStatus('等待此电脑确认访问');
  pollAccessDecision();
}

async function pollAccessDecision() {
  if (!pendingAccessId) return;
  const res = await fetch('/api/access-decision?id=' + encodeURIComponent(pendingAccessId));
  if (!res.ok) return;
  const data = await res.json();
  if (data.status === 'approved') {
    pendingAccessId = '';
    document.getElementById('auth').innerHTML = '';
    setStatus('已授权');
    await refreshStatus();
    return;
  }
  if (data.status === 'rejected') {
    setStatus('访问已被拒绝');
    document.getElementById('auth').innerHTML = '<div class="notice">访问已被此电脑拒绝。</div>';
    return;
  }
  if (data.status === 'expired') {
    pendingAccessId = '';
    setStatus('访问申请已过期，请刷新页面重试');
    return;
  }
  window.setTimeout(pollAccessDecision, 1500);
}

function joinPath(base, name) {
  return base ? base + '/' + name : name;
}

async function authorize() {
  try {
    const code = document.getElementById('code').value;
    const res = await fetch('/api/authorize?code=' + encodeURIComponent(code), { method: 'POST' });
    if (res.status === 429) { setStatus('错误次数过多，请稍后再试'); return; }
    if (!res.ok) { setStatus('确认码错误'); return; }
    document.getElementById('auth').innerHTML = '';
    setStatus('');
    await refreshStatus();
  } catch (error) {
    setStatus('授权请求失败，请重试');
  }
}

async function uploadFromFileInput() {
  if (!canUpload) { setStatus('当前权限不允许上传'); return; }
  const input = document.getElementById('file');
  if (!input.files.length) { setStatus('请选择文件'); return; }
  const entries = Array.from(input.files).map(file => ({ file, name: file.name }));
  await uploadEntries(entries);
  input.value = '';
}

async function uploadEntries(entries) {
  if (!canUpload) { setStatus('当前权限不允许上传'); return; }
  if (!entries.length) { setStatus('请选择文件'); return; }
  let done = 0;
  for (const entry of entries) {
    const result = await uploadSingleEntry(entry);
    if (result === 'failed') return;
    if (result !== 'skipped') done += 1;
  }
  setStatus(`上传完成：${done} 个文件`);
}

async function uploadSingleEntry(entry) {
  const file = entry.file;
  const uploadName = entry.name || file.name;
  const taskId = 'upload:' + uploadName + ':' + file.size + ':' + file.lastModified;
  let conflict = 'resume';
  try {
    const existsRes = await fetch('/api/upload-offset?name=' + encodeURIComponent(uploadName) + '&size=' + file.size);
    if (existsRes.ok) {
      const existsData = await existsRes.json();
      if (existsData.complete) {
        const choice = window.prompt(`${uploadName} 已存在。输入 o 覆盖，r 重命名，s 跳过`, 'r');
        if (choice === null || choice.toLowerCase() === 's') {
          updateTransfer(taskId, { direction: '上传', name: uploadName, total: file.size, transferred: file.size, status: '已跳过' });
          return 'skipped';
        }
        conflict = choice.toLowerCase() === 'o' ? 'overwrite' : 'rename';
      }
    }
    await uploadFileWithResume(file, uploadName, conflict, taskId);
    return 'ok';
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setStatus(`上传失败：${uploadName} ${message}`);
    updateTransfer(taskId, {
      direction: '上传',
      name: uploadName,
      total: file.size,
      status: '失败',
      failed: true,
      retry: () => uploadSingleEntry(entry),
    });
    return 'failed';
  }
}

async function uploadFileWithResume(file, uploadName, conflict, taskId) {
  let offset = 0;
  if (conflict === 'resume') {
    const offsetRes = await fetch('/api/upload-offset?name=' + encodeURIComponent(uploadName) + '&size=' + file.size);
    if (offsetRes.ok) {
      const offsetData = await offsetRes.json();
      offset = Math.min(file.size, offsetData.offset || 0);
    }
  }
  updateTransfer(taskId, { direction: '上传', name: uploadName, total: file.size, transferred: offset, startedAt: Date.now(), status: offset > 0 ? '续传中' : '上传中', failed: false });
  const chunk = file.slice(offset);
  const headers = { 'X-Mftp-Total-Size': String(file.size) };
  if (file.size > 0) headers['Content-Range'] = `bytes ${offset}-${file.size - 1}/${file.size}`;
  await xhrUpload('/api/upload?name=' + encodeURIComponent(uploadName) + '&conflict=' + encodeURIComponent(conflict), chunk, headers, loaded => {
    updateTransfer(taskId, { transferred: offset + loaded, status: offset > 0 ? '续传中' : '上传中' });
  });
  updateTransfer(taskId, { transferred: file.size, status: '完成', failed: false });
}

function xhrUpload(url, body, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = event => onProgress(event.loaded || 0);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText || xhr.statusText || 'upload failed'));
    };
    xhr.onerror = () => reject(new Error('network error'));
    xhr.onabort = () => reject(new Error('aborted'));
    xhr.send(body);
  });
}

function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  if (!dropzone) return;
  const input = document.getElementById('file');
  dropzone.addEventListener('click', event => {
    if (event.target !== input) input.click();
  });
  dropzone.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    input.click();
  });
  input.addEventListener('change', () => void uploadFromFileInput());
  for (const eventName of ['dragenter', 'dragover']) {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    dropzone.addEventListener(eventName, event => {
      event.preventDefault();
      dropzone.classList.remove('dragging');
    });
  }
  dropzone.addEventListener('drop', async event => {
    const entries = collectDroppedFiles(event.dataTransfer);
    if (!entries) return;
    await uploadEntries(entries);
  });
}

function collectDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.length) {
    for (const item of items) {
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry && entry.isDirectory) {
        setStatus('浏览器端只支持上传文件，不能上传文件夹');
        return null;
      }
    }
  }
  return Array.from(dataTransfer.files || []).map(file => ({ file, name: file.name }));
}

function bindPageActions() {
  document.getElementById('refresh-shares')?.addEventListener('click', () => load());
  document.getElementById('clear-transfers')?.addEventListener('click', clearFinishedTransfers);
  document.getElementById('authorize-access')?.addEventListener('click', authorize);
  document.getElementById('request-access')?.addEventListener('click', requestAccess);
  document.getElementById('code')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') authorize();
  });
}

async function load() {
  if (!canRead) return;
  const res = await fetch('/api/shares');
  if (!res.ok) { setStatus('请先完成授权'); return; }
  const shares = await res.json();
  const root = document.getElementById('shares');
  root.innerHTML = '';
  if (!shares.length) {
    root.innerHTML = '<div class="muted">暂无共享目录</div>';
    return;
  }
  for (const share of shares) {
    const card = document.createElement('div');
    card.className = 'share';
    const head = document.createElement('div');
    head.className = 'share-head';
    const title = document.createElement('div');
    title.className = 'share-name';
    title.textContent = share.name;
    const actions = document.createElement('div');
    actions.className = 'share-actions';
    const button = document.createElement('button');
    button.className = 'button button-ghost';
    button.textContent = '浏览';
    button.onclick = () => browse(share.id, '');
    actions.append(button);
    head.append(title, actions);
    const entries = document.createElement('div');
    entries.id = 'share-' + share.id;
    entries.className = 'entries';
    card.append(head, entries);
    root.append(card);
  }
}

async function browse(id, path='') {
  const data = await fetch(`/api/browse?share=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`).then(r => r.json());
  const el = document.getElementById('share-' + id);
  el.innerHTML = '';
  if (path) {
    const toolbar = document.createElement('div');
    toolbar.className = 'directory-toolbar';
    const up = document.createElement('button');
    up.className = 'icon-button';
    up.type = 'button';
    up.title = '返回上级';
    up.setAttribute('aria-label', '返回上级');
    up.append(createIcon('arrowLeft'));
    up.onclick = () => browse(id, path.split('/').slice(0, -1).join('/'));
    const currentPath = document.createElement('span');
    currentPath.className = 'directory-path';
    currentPath.textContent = path;
    currentPath.title = path;
    toolbar.append(up, currentPath);
    el.append(toolbar);
  }
  for (const entry of data.entries || []) {
    const itemPath = joinPath(path, entry.name);
    const row = document.createElement('div');
    row.className = 'entry ' + (entry.isDir ? 'entry-directory' : 'entry-file');
    const main = document.createElement(entry.isDir ? 'button' : 'div');
    main.className = 'entry-main';
    if (entry.isDir) {
      main.type = 'button';
      main.title = `打开 ${entry.name}`;
      main.onclick = () => browse(id, itemPath);
    }
    main.append(createIcon(entry.isDir ? 'folder' : 'file', 'entry-icon'));
    const details = document.createElement('span');
    details.className = 'entry-details';
    const name = document.createElement('div');
    name.className = 'entry-name';
    name.textContent = entry.name;
    details.append(name);
    if (!entry.isDir) {
      const size = document.createElement('span');
      size.className = 'entry-size';
      size.textContent = formatBytes(entry.size);
      details.append(size);
    }
    main.append(details);
    row.append(main);
    if (entry.isDir) {
      row.append(createIcon('chevronRight', 'entry-chevron'));
    } else {
      const button = document.createElement('button');
      button.className = 'icon-button entry-action';
      button.type = 'button';
      button.title = `下载 ${entry.name}`;
      button.setAttribute('aria-label', `下载 ${entry.name}`);
      button.append(createIcon('download'));
      button.onclick = () => startBrowserDownload(`/download?share=${encodeURIComponent(id)}&path=${encodeURIComponent(itemPath)}`, entry.name);
      row.append(button);
    }
    el.append(row);
  }
  if (!(data.entries || []).length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '目录为空';
    el.append(empty);
  }
}

function startBrowserDownload(url, fileName) {
  // 让浏览器原生处理保存和断点续传，避免大文件经过 Blob 占用双倍内存。
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || '';
  link.rel = 'noopener';
  link.click();
}

showCompatibilityHints();
bindPageActions();
setupDropzone();
refreshStatus();
