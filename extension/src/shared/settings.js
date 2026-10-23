/*
 * Настройки расширения: значения по умолчанию, чтение, запись и проверка.
 * Файл подключается в service worker, на страницу настроек и в content script.
 */
(function (root) {
  'use strict';

  const DEFAULTS = Object.freeze({
    // Серверы Azure DevOps, на которых работает расширение (origin без пути).
    servers: [],
    // Типы дочерних рабочих элементов, исполнители которых участвуют в отборе.
    childTypes: ['Task'],
    // Состояния дочерних элементов, которые считаются завершёнными.
    doneStates: ['Closed', 'Done', 'Removed', 'Resolved'],
    // Учитывать людей из полей самой карточки (Assigned To и другие поля типа Identity).
    useCardFields: true,
    // Поля карточки типа Identity, которые не считаются участием.
    ignoredFields: [
      'System.CreatedBy',
      'System.ChangedBy',
      'System.AuthorizedAs',
      'Microsoft.VSTS.Common.ActivatedBy',
      'Microsoft.VSTS.Common.ResolvedBy',
      'Microsoft.VSTS.Common.ClosedBy'
    ],
    // Значение переключателя «Только незавершённые» при открытии доски.
    onlyActiveByDefault: true,
    // Запоминать выбранных людей отдельно для каждой доски.
    rememberSelection: true,
    // Автообновление данных, минуты. 0 — выключено.
    autoRefreshMinutes: 0,
    // Сторона экрана для панели: right | left.
    panelSide: 'right',
    // Тема панели: auto | light | dark.
    theme: 'auto',
    // Версия REST API Azure DevOps.
    apiVersion: '6.0',
    // CSS-селектор карточки на доске и селектор номера внутри карточки.
    cardSelector: '.board-tile',
    cardIdSelector: '.id-title-container .id'
  });

  const AUTO_REFRESH_CHOICES = [0, 1, 5, 15, 30];
  const SIDES = ['right', 'left'];
  const THEMES = ['auto', 'light', 'dark'];

  function cleanList(value, fallback) {
    if (!Array.isArray(value)) return [...fallback];
    const seen = new Set();
    const out = [];
    for (const item of value) {
      const text = String(item ?? '').trim();
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      out.push(text);
    }
    return out;
  }

  function pick(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  }

  function normalize(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    return {
      servers: cleanList(s.servers, []).map((v) => {
        try { return parseServer(v).origin; } catch (_) { return null; }
      }).filter(Boolean),
      childTypes: cleanList(s.childTypes, DEFAULTS.childTypes),
      doneStates: cleanList(s.doneStates, []),
      useCardFields: s.useCardFields !== false,
      ignoredFields: cleanList(s.ignoredFields, []),
      onlyActiveByDefault: s.onlyActiveByDefault !== false,
      rememberSelection: s.rememberSelection !== false,
      autoRefreshMinutes: pick(Number(s.autoRefreshMinutes), AUTO_REFRESH_CHOICES, 0),
      panelSide: pick(s.panelSide, SIDES, DEFAULTS.panelSide),
      theme: pick(s.theme, THEMES, DEFAULTS.theme),
      apiVersion: /^\d+\.\d+(-preview(\.\d+)?)?$/.test(String(s.apiVersion)) ? String(s.apiVersion) : DEFAULTS.apiVersion,
      cardSelector: String(s.cardSelector || '').trim() || DEFAULTS.cardSelector,
      cardIdSelector: String(s.cardIdSelector || '').trim() || DEFAULTS.cardIdSelector
    };
  }

  /**
   * Разбирает адрес сервера, введённый пользователем. Принимает и голый хост,
   * и полную ссылку на доску. Возвращает origin и шаблоны адресов для браузера.
   */
  function parseServer(input) {
    let text = String(input || '').trim();
    if (!text) throw new Error('Укажите адрес сервера');
    if (!/^[a-z]+:\/\//i.test(text)) text = 'https://' + text;
    let url;
    try { url = new URL(text); } catch (_) { throw new Error('Не похоже на адрес сервера'); }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Поддерживаются только адреса http и https');
    }
    // Шаблоны адресов браузера не учитывают порт, поэтому строим их по имени хоста.
    const host = `${url.protocol}//${url.hostname}`;
    return {
      origin: url.origin,
      permission: `${host}/*`,
      boardMatches: [`${host}/*/_boards/*`, `${host}/*/_backlogs/*`, `${host}/_boards/*`]
    };
  }

  async function load() {
    const stored = await chrome.storage.sync.get(null);
    return normalize(stored);
  }

  async function save(partial) {
    const merged = normalize({ ...(await chrome.storage.sync.get(null)), ...partial });
    await chrome.storage.sync.set(merged);
    return merged;
  }

  async function reset() {
    const keep = (await load()).servers;
    const fresh = normalize({ ...DEFAULTS, servers: keep });
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(fresh);
    return fresh;
  }

  root.BTF = root.BTF || {};
  root.BTF.settings = { DEFAULTS, AUTO_REFRESH_CHOICES, normalize, parseServer, load, save, reset };
})(globalThis);
