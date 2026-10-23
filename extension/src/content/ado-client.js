/*
 * Клиент REST API Azure DevOps Server. Только чтение: поля рабочих элементов
 * и связи «родитель → дочерний элемент».
 */
(function (root) {
  'use strict';

  const ITEMS_PER_REQUEST = 200;   // ограничение метода workitemsbatch
  const PARENTS_PER_QUERY = 100;   // держим WIQL-запрос коротким на больших досках
  const TIMEOUT_MS = 20000;
  const CHILD_LINK = 'System.LinkTypes.Hierarchy-Forward';

  class AdoError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.kind = kind;
      this.status = status || 0;
    }
  }

  /** Базовый адрес API: часть пути до раздела _boards или _backlogs. */
  function apiBaseFrom(href) {
    const url = new URL(href);
    const segments = url.pathname.split('/');
    const at = segments.findIndex((s) => s === '_boards' || s === '_backlogs');
    if (at < 0) return null;
    return url.origin + segments.slice(0, at).join('/');
  }

  /** Ключ доски: адрес без параметров, чтобы отличать одну доску от другой. */
  function boardKeyFrom(href) {
    const url = new URL(href);
    return url.origin + url.pathname.replace(/\/+$/, '');
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  function wiqlString(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  function errorFor(status, statusText) {
    if (status === 401) return new AdoError('auth', 'Сервер не принял вход. Войдите в Azure DevOps в этом браузере.', status);
    if (status === 403) return new AdoError('forbidden', 'Нет прав на чтение рабочих элементов проекта.', status);
    if (status === 404) return new AdoError('notfound', 'Сервер не нашёл проект. Проверьте адрес доски.', status);
    if (status >= 500) return new AdoError('server', `Ошибка на сервере (HTTP ${status}). Повторите позже.`, status);
    return new AdoError('http', `Сервер ответил HTTP ${status} ${statusText || ''}`.trim(), status);
  }

  class AdoClient {
    constructor(baseUrl, apiVersion) {
      this.baseUrl = baseUrl;
      this.apiVersion = apiVersion;
    }

    async post(path, body) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let response;
      try {
        response = await fetch(`${this.baseUrl}${path}?api-version=${encodeURIComponent(this.apiVersion)}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } catch (e) {
        if (e.name === 'AbortError') throw new AdoError('timeout', 'Сервер не ответил за 20 секунд.');
        throw new AdoError('network', 'Сервер недоступен. Проверьте сеть или VPN.');
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const details = await response.text().catch(() => '');
        console.warn('[ADO Board Task Filter]', response.status, path, details.slice(0, 500));
        throw errorFor(response.status, response.statusText);
      }
      return response.json();
    }

    /** Рабочие элементы по номерам. Без списка полей сервер вернёт все поля. */
    async workItems(ids, fields) {
      const result = [];
      for (const part of chunk(ids, ITEMS_PER_REQUEST)) {
        const body = fields ? { ids: part, fields } : { ids: part };
        const data = await this.post('/_apis/wit/workitemsbatch', body);
        result.push(...(data.value || []));
      }
      return result;
    }

    /** Пары «родитель → прямой дочерний элемент» заданных типов. */
    async childLinks(parentIds, childTypes) {
      const pairs = [];
      const types = childTypes.map(wiqlString).join(', ');
      for (const part of chunk(parentIds, PARENTS_PER_QUERY)) {
        const query = [
          'SELECT [System.Id] FROM WorkItemLinks',
          `WHERE [Source].[System.Id] IN (${part.join(', ')})`,
          `AND [System.Links.LinkType] = ${wiqlString(CHILD_LINK)}`,
          `AND [Target].[System.WorkItemType] IN (${types})`,
          'MODE (MustContain)'
        ].join(' ');
        const data = await this.post('/_apis/wit/wiql', { query });
        for (const relation of data.workItemRelations || []) {
          if (relation.rel === CHILD_LINK && relation.source && relation.target) {
            pairs.push({ parent: relation.source.id, child: relation.target.id });
          }
        }
      }
      return pairs;
    }
  }

  root.BTF = root.BTF || {};
  root.BTF.api = { AdoClient, AdoError, apiBaseFrom, boardKeyFrom };
})(globalThis);
