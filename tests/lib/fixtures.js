// Общие тестовые данные и инструменты стенда.
const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', '..', 'extension');
const CONTENT_FILES = [
  'src/shared/settings.js',
  'src/content/ado-client.js',
  'src/content/board-index.js',
  'src/content/board-dom.js',
  'src/content/panel.js',
  'src/content/controller.js'
].map((f) => fs.readFileSync(path.join(EXT, f), 'utf8'));

const who = (name) => ({ displayName: name, uniqueName: name.replace(' ', '.').toLowerCase() + '@corp', id: 'id-' + name });

// Карточки доски и дочерние элементы.
const ITEMS = {
  101: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Owner A'), 'System.CreatedBy': who('Dev B') },
  102: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Dev B'), 'Custom.Responsible': who('Analyst D'), 'Custom.Reviewers': [who('QA E')] },
  103: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Owner A') },
  104: { 'System.WorkItemType': 'Bug', 'System.CreatedBy': who('Dev B') },
  105: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Dev C') },
  201: { 'System.WorkItemType': 'Task', 'System.State': 'Active', 'System.AssignedTo': who('Dev B') },
  202: { 'System.WorkItemType': 'Task', 'System.State': 'Closed', 'System.AssignedTo': who('Dev C') },
  203: { 'System.WorkItemType': 'Task', 'System.State': 'Active', 'System.AssignedTo': who('Dev C') },
  204: { 'System.WorkItemType': 'Task', 'System.State': 'Active' },
  205: { 'System.WorkItemType': 'Bug', 'System.State': 'Active', 'System.AssignedTo': who('QA E') },
  301: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Owner F') },
  302: { 'System.WorkItemType': 'Product Backlog Item', 'System.AssignedTo': who('Owner F') }
};
const LINKS = [[101, 201], [101, 202], [103, 203], [103, 205], [104, 204]];

const card = (n) => `<div class="board-tile" data-n="${n}"><div class="id-title-container"><span class="id">${n}</span><span class="title">Карточка ${n}</span></div></div>`;
const boardHtml = (ids) => `<!doctype html><html><head><meta charset="utf-8"><title>Board</title>
<style>body{font-family:sans-serif;background:#f8f8f8;margin:0;padding:16px}.board-tile{display:inline-block;width:150px;height:60px;margin:6px;background:#fff;border-left:4px solid #009ccc;box-shadow:0 1px 2px rgba(0,0,0,.2);padding:6px;vertical-align:top}.filterHide{display:none}</style>
</head><body><div id="board">${ids.map(card).join('')}</div></body></html>`;

// Имитация chrome.storage на основе localStorage страницы: данные переживают перезагрузку.
const CHROME_SHIM = `
(() => {
  const read = (area) => JSON.parse(localStorage.getItem('__shim_' + area) || '{}');
  const write = (area, data) => localStorage.setItem('__shim_' + area, JSON.stringify(data));
  const listeners = [];
  const area = (name) => ({
    async get(keys) {
      const all = read(name);
      if (keys == null) return { ...all };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in all) out[k] = all[k];
      return out;
    },
    async set(obj) {
      const all = read(name);
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: all[k], newValue: v }; all[k] = v; }
      write(name, all);
      listeners.forEach((fn) => fn(changes, name));
    },
    async clear() { write(name, {}); }
  });
  window.chrome = { storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (fn) => listeners.push(fn) } } };
})();`;

function createReport() {
  const results = [];
  return {
    results,
    check(id, title, expected, actual, ok, note = '') {
      results.push({ id, title, expected, actual, status: ok ? 'Пройден' : 'Не пройден', note });
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${id} ${title} | ожидалось: ${expected} | факт: ${actual}`);
    }
  };
}

module.exports = { EXT, CONTENT_FILES, ITEMS, LINKS, boardHtml, CHROME_SHIM, createReport, card };
