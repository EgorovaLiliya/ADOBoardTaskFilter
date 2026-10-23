/* Страница настроек: серверы и параметры отбора. Каждое изменение сохраняется сразу. */
(function () {
  'use strict';

  const S = globalThis.BTF.settings;
  const $ = (id) => document.getElementById(id);
  let current = null;
  let savedTimer = null;

  function flashSaved(text = 'Сохранено') {
    const el = $('saved');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  async function save(partial) {
    current = await S.save(partial);
    flashSaved();
  }

  // ---------- серверы ----------

  async function hasAccess(origin) {
    const { permission } = S.parseServer(origin);
    return chrome.permissions.contains({ origins: [permission] });
  }

  async function renderServers() {
    const list = $('server-list');
    list.textContent = '';
    if (!current.servers.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Серверов пока нет. Добавьте адрес, на котором открываете доску.';
      list.append(li);
      return;
    }
    for (const origin of current.servers) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'origin';
      name.textContent = origin;
      const badge = document.createElement('span');
      const granted = await hasAccess(origin);
      badge.className = 'badge ' + (granted ? 'ok' : 'warn');
      badge.textContent = granted ? 'доступ есть' : 'нет доступа';
      li.append(name, badge);
      if (!granted) {
        const grant = document.createElement('button');
        grant.type = 'button';
        grant.className = 'btn small';
        grant.textContent = 'Выдать доступ';
        grant.addEventListener('click', () => requestAccess(origin));
        li.append(grant);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn small ghost';
      remove.textContent = 'Удалить';
      remove.setAttribute('aria-label', `Удалить ${origin}`);
      remove.addEventListener('click', () => removeServer(origin));
      li.append(remove);
      list.append(li);
    }
  }

  async function requestAccess(origin) {
    const { permission } = S.parseServer(origin);
    // Запрос доступа должен идти прямо из обработчика нажатия.
    const granted = await chrome.permissions.request({ origins: [permission] });
    await renderServers();
    return granted;
  }

  async function addServer(event) {
    event.preventDefault();
    const input = $('server-input');
    const error = $('server-error');
    error.hidden = true;
    let parsed;
    try {
      parsed = S.parseServer(input.value);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      input.focus();
      return;
    }
    const granted = await chrome.permissions.request({ origins: [parsed.permission] });
    if (!current.servers.includes(parsed.origin)) {
      await save({ servers: [...current.servers, parsed.origin] });
    }
    input.value = '';
    await renderServers();
    if (!granted) {
      error.textContent = 'Сервер добавлен, но доступ не выдан. Без доступа расширение не сможет читать доску.';
      error.hidden = false;
    }
  }

  async function removeServer(origin) {
    const rest = current.servers.filter((s) => s !== origin);
    const { permission } = S.parseServer(origin);
    const stillNeeded = rest.some((s) => S.parseServer(s).permission === permission);
    if (!stillNeeded) await chrome.permissions.remove({ origins: [permission] }).catch(() => false);
    await save({ servers: rest });
    await renderServers();
  }

  // ---------- списки-«чипсы» ----------

  function renderChips(box) {
    const key = box.dataset.key;
    box.textContent = '';
    for (const value of current[key]) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(document.createTextNode(value));
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.setAttribute('aria-label', `Убрать ${value}`);
      x.addEventListener('click', () => save({ [key]: current[key].filter((v) => v !== value) }).then(() => renderChips(box)));
      chip.append(x);
      box.append(chip);
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Добавить и нажать Enter';
    input.setAttribute('aria-label', 'Новое значение');
    input.addEventListener('keydown', async (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
        e.preventDefault();
        const values = input.value.split(',').map((v) => v.trim()).filter(Boolean);
        await save({ [key]: [...current[key], ...values] });
        renderChips(box);
        box.querySelector('input').focus();
      } else if (e.key === 'Backspace' && !input.value && current[key].length) {
        await save({ [key]: current[key].slice(0, -1) });
        renderChips(box);
        box.querySelector('input').focus();
      }
    });
    box.append(input);
    box.onclick = (e) => { if (e.target === box) input.focus(); };
  }

  // ---------- остальные поля ----------

  function renderSegmented(group) {
    const key = group.dataset.key;
    for (const button of group.querySelectorAll('button')) {
      button.setAttribute('aria-checked', String(button.dataset.value === current[key]));
      button.onclick = () => save({ [key]: button.dataset.value }).then(() => renderSegmented(group));
    }
  }

  function bindToggle(id) {
    const box = $(id);
    box.checked = current[id];
    box.onchange = () => save({ [id]: box.checked });
  }

  function bindText(id) {
    const input = $(id);
    input.value = current[id];
    input.onchange = async () => {
      await save({ [id]: input.value });
      input.value = current[id];
    };
  }

  async function renderAll() {
    current = await S.load();
    await renderServers();
    document.querySelectorAll('.chips').forEach(renderChips);
    document.querySelectorAll('.segmented').forEach(renderSegmented);
    ['useCardFields', 'onlyActiveByDefault', 'rememberSelection'].forEach(bindToggle);
    ['apiVersion', 'cardSelector', 'cardIdSelector'].forEach(bindText);
    const refresh = $('autoRefreshMinutes');
    refresh.value = String(current.autoRefreshMinutes);
    refresh.onchange = () => save({ autoRefreshMinutes: Number(refresh.value) });
  }

  $('server-form').addEventListener('submit', addServer);
  $('reset').addEventListener('click', async () => {
    current = await S.reset();
    await renderAll();
    flashSaved('Настройки по умолчанию восстановлены');
  });
  renderAll();
})();
