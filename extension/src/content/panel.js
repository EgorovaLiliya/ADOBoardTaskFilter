/*
 * Плавающая панель фильтра. Живёт в Shadow DOM: стили доски её не задевают,
 * а её собственные изменения не видны наблюдателю за доской.
 */
(function (root) {
  'use strict';

  const ICONS = {
    filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5z"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    collapse: '<path d="M6 14l6-6 6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>'
  };

  function icon(name, size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function initials(name) {
    const parts = name.replace(/[^\p{L}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]).join('');
    return (letters || '?').toUpperCase();
  }

  function hue(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  const STYLE = `
    :host { all: initial; }
    .wrap {
      --bg: #ffffff; --fg: #1f2937; --muted: #6b7280; --line: #e7e9ee; --hover: #f4f5f7;
      --accent: #2563eb; --accent-soft: #eef4ff; --danger: #c2410c;
      --shadow: 0 12px 32px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
      position: fixed; bottom: 18px; z-index: 2147483000;
      font: 13px/1.45 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
      color: var(--fg);
    }
    .wrap.right { right: 18px; } .wrap.left { left: 18px; }
    .wrap.dark {
      --bg: #1f232a; --fg: #e6e8eb; --muted: #9aa3ae; --line: #343a43; --hover: #2a2f37;
      --accent: #6ea8ff; --accent-soft: rgba(110, 168, 255, 0.14); --danger: #fb923c;
      --shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    }
    .card {
      width: 296px; background: var(--bg); border: 1px solid var(--line); border-radius: 14px;
      box-shadow: var(--shadow); overflow: hidden;
    }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; }
    header .title { flex: 1; font-weight: 600; letter-spacing: 0.1px; display: flex; align-items: center; gap: 8px; }
    header .title svg { color: var(--accent); }
    button { font: inherit; color: inherit; cursor: pointer; }
    .icon-btn {
      width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: 8px;
      background: transparent; color: var(--muted);
    }
    .icon-btn:hover { background: var(--hover); color: var(--fg); }
    .icon-btn:focus-visible, .row:focus-visible, .link:focus-visible, .pill:focus-visible, input:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 1px;
    }
    .icon-btn.spin svg { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .search { position: relative; margin: 0 12px 8px; }
    .search svg { position: absolute; left: 9px; top: 8px; color: var(--muted); }
    .search input {
      width: 100%; box-sizing: border-box; height: 32px; padding: 0 10px 0 30px; border-radius: 9px;
      border: 1px solid var(--line); background: var(--bg); color: var(--fg); font: inherit;
    }
    .search input::placeholder { color: var(--muted); }
    ul { list-style: none; margin: 0; padding: 0 6px; max-height: 232px; overflow-y: auto; }
    .row {
      display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 9px; cursor: pointer;
      user-select: none;
    }
    .row:hover { background: var(--hover); }
    .row[aria-selected="true"] { background: var(--accent-soft); }
    .row[aria-selected="true"] .name { color: var(--accent); font-weight: 600; }
    .avatar {
      width: 26px; height: 26px; flex: none; border-radius: 50%; display: grid; place-items: center;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
    }
    .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .count {
      min-width: 22px; padding: 1px 7px; border-radius: 10px; background: var(--hover); color: var(--muted);
      font-size: 11px; text-align: center; box-sizing: border-box;
    }
    .tick { width: 16px; color: var(--accent); visibility: hidden; }
    .row[aria-selected="true"] .tick { visibility: visible; }
    .empty { padding: 10px 14px; color: var(--muted); }
    .switch { display: flex; align-items: center; gap: 10px; padding: 10px 14px 4px; cursor: pointer; }
    .switch input { position: absolute; opacity: 0; pointer-events: none; }
    .track {
      width: 32px; height: 18px; border-radius: 9px; background: var(--line); position: relative; flex: none;
      transition: background 0.15s;
    }
    .track::after {
      content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); transition: transform 0.15s;
    }
    .switch input:checked + .track { background: var(--accent); }
    .switch input:checked + .track::after { transform: translateX(14px); }
    .switch input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
    footer {
      display: flex; align-items: center; gap: 8px; padding: 8px 14px 12px; margin-top: 4px;
      border-top: 1px solid var(--line);
    }
    .status { flex: 1; color: var(--muted); font-size: 12px; }
    .status.error { color: var(--danger); }
    .link { border: 0; background: none; padding: 2px 4px; border-radius: 6px; color: var(--accent); font-weight: 600; }
    .link[disabled] { color: var(--muted); opacity: 0.5; cursor: default; }
    .pill {
      display: none; align-items: center; gap: 8px; height: 36px; padding: 0 14px; border-radius: 18px;
      border: 1px solid var(--line); background: var(--bg); box-shadow: var(--shadow); color: var(--fg);
      max-width: 296px;
    }
    .pill svg { color: var(--accent); flex: none; }
    .pill .label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill .badge { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .collapsed .card { display: none; }
    .collapsed .pill { display: inline-flex; }
  `;

  class Panel {
    constructor(handlers) {
      this.on = handlers;
      this.people = [];
      this.selected = new Set();
      this.query = '';
      this.summary = null;
    }

    mount(side, theme) {
      this.host = document.createElement('btf-panel');
      this.host.setAttribute('data-btf', '');
      // Хост добавляем в <html>, а не в <body>: наблюдатель за доской смотрит только в body.
      document.documentElement.appendChild(this.host);
      const shadow = this.host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `
        <style>${STYLE}</style>
        <div class="wrap">
          <section class="card" aria-label="Фильтр доски по исполнителям">
            <header>
              <div class="title">${icon('filter')}<span>Фильтр по исполнителям</span></div>
              <button class="icon-btn refresh" type="button" title="Обновить данные" aria-label="Обновить данные">${icon('refresh')}</button>
              <button class="icon-btn hide" type="button" title="Свернуть" aria-label="Свернуть панель">${icon('collapse')}</button>
            </header>
            <div class="search">${icon('search', 14)}<input type="search" placeholder="Найти человека" aria-label="Поиск по людям"></div>
            <ul role="listbox" aria-multiselectable="true" aria-label="Люди на доске"></ul>
            <label class="switch"><input type="checkbox" class="active"><span class="track"></span><span>Только незавершённые задачи</span></label>
            <footer>
              <span class="status" role="status" aria-live="polite"></span>
              <button class="link reset" type="button">Сбросить</button>
            </footer>
          </section>
          <button class="pill" type="button" aria-label="Развернуть фильтр">${icon('filter')}<span class="label"></span><span class="badge"></span></button>
        </div>`;
      const $ = (s) => shadow.querySelector(s);
      this.el = {
        wrap: $('.wrap'), list: $('ul'), search: $('.search input'), active: $('.active'),
        status: $('.status'), reset: $('.reset'), refresh: $('.refresh'), hide: $('.hide'),
        pill: $('.pill'), pillLabel: $('.pill .label'), pillBadge: $('.pill .badge')
      };
      this.el.search.addEventListener('input', () => { this.query = this.el.search.value.trim().toLowerCase(); this.renderList(); });
      this.el.search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { this.el.search.value = ''; this.query = ''; this.renderList(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); const first = this.el.list.querySelector('.row'); if (first) first.focus(); }
      });
      this.el.list.addEventListener('click', (e) => {
        const row = e.target.closest('.row');
        if (row) this.toggle(row.dataset.key);
      });
      this.el.list.addEventListener('keydown', (e) => this.onListKey(e));
      this.el.active.addEventListener('change', () => this.on.onlyActive(this.el.active.checked));
      this.el.reset.addEventListener('click', () => this.on.reset());
      this.el.refresh.addEventListener('click', () => this.on.refresh());
      this.el.hide.addEventListener('click', () => this.setCollapsed(true, true));
      this.el.pill.addEventListener('click', () => this.setCollapsed(false, true));
      this.setLook(side, theme);
      return this;
    }

    setLook(side, theme) {
      const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      this.el.wrap.classList.toggle('dark', dark);
      this.el.wrap.classList.toggle('left', side === 'left');
      this.el.wrap.classList.toggle('right', side !== 'left');
    }

    toggle(key) {
      if (this.selected.has(key)) this.selected.delete(key); else this.selected.add(key);
      this.renderList();
      this.renderPill();
      this.on.select(new Set(this.selected));
    }

    onListKey(e) {
      const row = e.target.closest('.row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(row.dataset.key); return; }
      const rows = [...this.el.list.querySelectorAll('.row')];
      const at = rows.indexOf(row);
      if (e.key === 'ArrowDown' && rows[at + 1]) { e.preventDefault(); rows[at + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (rows[at - 1] || this.el.search).focus(); }
    }

    setPeople(people) {
      this.people = people;
      this.renderList();
      this.renderPill();
    }

    setSelected(keys) {
      this.selected = new Set(keys);
      this.renderList();
      this.renderPill();
    }

    setOnlyActive(value) {
      this.el.active.checked = value;
    }

    renderList() {
      const focusedKey = this.el.list.contains(this.host.shadowRoot.activeElement) ? this.host.shadowRoot.activeElement.dataset.key : null;
      const visible = this.people.filter((p) => !this.query || p.name.toLowerCase().includes(this.query));
      // Выбранные люди, которых сейчас нет на доске, остаются в списке, чтобы их можно было снять.
      for (const key of this.selected) {
        if (!this.people.some((p) => p.key === key) && (!this.query || key.includes(this.query))) {
          visible.unshift({ key, name: key, count: 0 });
        }
      }
      if (!visible.length) {
        this.el.list.innerHTML = `<li class="empty">${this.people.length ? 'Никого не нашлось' : 'Людей пока нет'}</li>`;
        return;
      }
      this.el.list.innerHTML = visible.map((p) => {
        const h = hue(p.name);
        const dark = this.el.wrap.classList.contains('dark');
        const bg = dark ? `hsl(${h} 32% 28%)` : `hsl(${h} 70% 92%)`;
        const fg = dark ? `hsl(${h} 70% 86%)` : `hsl(${h} 45% 30%)`;
        const on = this.selected.has(p.key);
        return `<li class="row" role="option" tabindex="0" aria-selected="${on}" data-key="${escapeHtml(p.key)}">
          <span class="avatar" style="background:${bg};color:${fg}">${escapeHtml(initials(p.name))}</span>
          <span class="name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
          <span class="count" title="Карточек на доске">${p.count}</span>
          <span class="tick">${icon('check', 16)}</span>
        </li>`;
      }).join('');
      if (focusedKey) {
        const again = [...this.el.list.querySelectorAll('.row')].find((r) => r.dataset.key === focusedKey);
        if (again) again.focus();
      }
    }

    renderPill() {
      const names = [...this.selected].map((k) => (this.people.find((p) => p.key === k) || { name: k }).name);
      this.el.pillLabel.textContent = names.length ? names[0] + (names.length > 1 ? ` +${names.length - 1}` : '') : 'Фильтр по исполнителям';
      this.el.pillBadge.textContent = this.summary && names.length ? `${this.summary.shown}/${this.summary.total}` : '';
      this.el.reset.disabled = names.length === 0;
    }

    setStatus(kind, text) {
      this.el.status.textContent = text;
      this.el.status.classList.toggle('error', kind === 'error');
      this.el.refresh.classList.toggle('spin', kind === 'loading');
    }

    setSummary(shown, total) {
      this.summary = { shown, total };
      this.renderPill();
    }

    setCollapsed(collapsed, byUser) {
      this.el.wrap.classList.toggle('collapsed', collapsed);
      if (byUser && this.on.collapse) this.on.collapse(collapsed);
      (collapsed ? this.el.pill : this.el.search).focus({ preventScroll: true });
    }

    destroy() {
      if (this.host) this.host.remove();
    }
  }

  root.BTF = root.BTF || {};
  root.BTF.Panel = Panel;
})(globalThis);
