/*
 * Связывает доску, данные и панель: загружает данные, применяет отбор,
 * следит за перерисовкой доски, сменой доски и настройками.
 */
(function (root) {
  'use strict';

  if (root.__btfStarted) return;
  root.__btfStarted = true;

  const { AdoClient, AdoError, apiBaseFrom, boardKeyFrom } = root.BTF.api;
  const WAIT_STEP_MS = 300;
  const WAIT_LIMIT_MS = 15000;
  const LOCATION_CHECK_MS = 1000;
  const CHILD_FIELDS = ['System.Id', 'System.State', 'System.AssignedTo'];
  const TAG = '[ADO Board Task Filter]';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  class Controller {
    constructor(settings) {
      this.settings = settings;
      this.selected = new Set();
      this.onlyActive = settings.onlyActiveByDefault;
      this.index = null;
      this.generation = 0;        // номер текущей загрузки, устаревшие ответы отбрасываются
      this.pending = new Set();   // карточки, по которым идёт дозагрузка
      this.lastHidden = new Set();
      this.notice = '';
    }

    async start() {
      this.boardKey = boardKeyFrom(location.href);
      this.dom = new root.BTF.BoardDom(this.settings);
      this.panel = new root.BTF.Panel({
        select: (keys) => { this.selected = keys; this.persist(); this.apply(); },
        onlyActive: (value) => { this.onlyActive = value; this.persist(); this.showPeople(); this.apply(); },
        reset: () => this.reset(),
        refresh: () => this.reload(),
        collapse: (value) => chrome.storage.local.set({ collapsed: value })
      }).mount(this.settings.panelSide, this.settings.theme);

      await this.restore();
      this.dom.watch(() => this.onBoardRedrawn());
      setInterval(() => this.checkLocation(), LOCATION_CHECK_MS);
      this.scheduleAutoRefresh();
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') this.onSettingsChanged();
      });
      await this.waitForCardsAndLoad();
    }

    // ---------- состояние между сессиями ----------

    storageKey() {
      return 'selection:' + this.boardKey;
    }

    async restore() {
      const keys = ['collapsed'];
      if (this.settings.rememberSelection) keys.push(this.storageKey());
      const saved = await chrome.storage.local.get(keys);
      const selection = saved[this.storageKey()];
      this.selected = new Set(selection && Array.isArray(selection.people) ? selection.people : []);
      if (selection && typeof selection.onlyActive === 'boolean') this.onlyActive = selection.onlyActive;
      this.panel.setSelected(this.selected);
      this.panel.setOnlyActive(this.onlyActive);
      if (saved.collapsed) this.panel.setCollapsed(true, false);
    }

    persist() {
      if (!this.settings.rememberSelection) return;
      chrome.storage.local.set({ [this.storageKey()]: { people: [...this.selected], onlyActive: this.onlyActive } });
    }

    // ---------- загрузка ----------

    async waitForCardsAndLoad() {
      const generation = ++this.generation;
      this.panel.setStatus('wait', 'Жду карточки на доске…');
      const started = Date.now();
      while (this.dom.cards().size === 0) {
        if (generation !== this.generation) return;
        if (Date.now() - started > WAIT_LIMIT_MS) {
          this.panel.setStatus('error', 'Карточки не найдены. Когда доска загрузится, нажмите «Обновить».');
          return;
        }
        await sleep(WAIT_STEP_MS);
      }
      await this.reload(generation);
    }

    async reload(generation) {
      const current = generation || ++this.generation;
      const base = apiBaseFrom(location.href);
      if (!base) {
        this.panel.setStatus('error', 'Откройте канбан-доску проекта.');
        return;
      }
      const ids = [...this.dom.cards().keys()];
      if (!ids.length) {
        this.panel.setStatus('error', 'Карточки не найдены. Когда доска загрузится, нажмите «Обновить».');
        return;
      }
      this.client = new AdoClient(base, this.settings.apiVersion);
      this.panel.setStatus('loading', `Загружаю данные по ${ids.length} карточкам…`);
      const index = new root.BTF.BoardIndex(this.settings);
      try {
        await this.fill(index, ids);
      } catch (e) {
        if (current === this.generation) this.fail(e);
        return;
      }
      if (current !== this.generation) return;
      this.index = index;
      this.pending.clear();
      this.notice = '';
      this.showPeople();
      this.apply();
    }

    async fill(index, ids) {
      const fields = this.settings.useCardFields ? undefined : ['System.Id'];
      index.addCards(await this.client.workItems(ids, fields));
      // Карточки без ответа сервера (удалены или недоступны) считаем карточками без участников.
      index.addCards(ids.filter((id) => !index.knows(id)).map((id) => ({ id, fields: {} })));
      if (!this.settings.childTypes.length) return;
      const pairs = await this.client.childLinks(ids, this.settings.childTypes);
      index.addLinks(pairs);
      const children = [...new Set(pairs.map((p) => p.child))];
      if (children.length) index.addChildren(await this.client.workItems(children, CHILD_FIELDS));
    }

    /** Дозагрузка карточек, которые появились на доске после загрузки. */
    async loadNewCards(ids) {
      ids.forEach((id) => this.pending.add(id));
      const generation = this.generation;
      const index = this.index;
      try {
        await this.fill(index, ids);
        if (generation === this.generation) this.notice = '';
      } catch (e) {
        console.warn(TAG, e);
        if (generation === this.generation) this.notice = 'Не удалось загрузить новые карточки. Нажмите «Обновить».';
      } finally {
        ids.forEach((id) => this.pending.delete(id));
      }
      if (generation !== this.generation) return;
      this.showPeople();
      this.apply();
    }

    fail(error) {
      console.error(TAG, error);
      const text = error instanceof AdoError ? error.message : 'Не удалось загрузить данные. Подробности в консоли браузера.';
      this.panel.setStatus('error', text);
    }

    // ---------- отбор ----------

    showPeople() {
      if (!this.index) return;
      this.panel.setPeople(this.index.people([...this.dom.cards().keys()], this.onlyActive));
    }

    apply() {
      if (!this.index) return;
      const cards = this.dom.cards();
      const filtering = this.selected.size > 0;
      const hiddenNow = new Set();
      let total = 0;
      let shown = 0;
      for (const [id, card] of cards) {
        const verdict = filtering ? this.index.matches(id, this.selected, this.onlyActive) : null;
        // null: данных по карточке ещё нет — показываем, пока не загрузим.
        const hide = verdict === false;
        this.dom.setHidden(card, hide);
        if (hide) hiddenNow.add(id);
        if (this.dom.hiddenByBoard(card)) continue; // карточку скрыл встроенный фильтр доски
        total += 1;
        if (!hide) shown += 1;
      }
      // Пересчитываем раскладку, только если изменился набор скрытых карточек.
      if (!sameSet(hiddenNow, this.lastHidden)) this.dom.relayout();
      this.lastHidden = hiddenNow;
      this.panel.setSummary(shown, total);
      this.panel.setStatus(this.notice ? 'error' : 'ready', this.statusText(filtering, shown, total));
    }

    statusText(filtering, shown, total) {
      if (this.notice) return this.notice;
      const loading = this.pending.size ? ' · загружаю новые' : '';
      if (!filtering) return `Карточек на доске: ${total}. Выберите людей${loading}`;
      return `Показано ${shown} из ${total}${loading}`;
    }

    reset() {
      this.selected = new Set();
      this.panel.setSelected(this.selected);
      this.persist();
      this.dom.showAll();
      this.apply();
    }

    // ---------- события страницы ----------

    onBoardRedrawn() {
      if (!this.index) return;
      const fresh = [...this.dom.cards().keys()].filter((id) => !this.index.knows(id) && !this.pending.has(id));
      if (fresh.length) this.loadNewCards(fresh);
      this.showPeople();
      this.apply();
    }

    async checkLocation() {
      const onBoard = apiBaseFrom(location.href) !== null;
      this.panel.host.hidden = !onBoard;
      const key = boardKeyFrom(location.href);
      if (key === this.boardKey) return;
      this.boardKey = key;
      this.index = null;
      this.lastHidden = new Set();
      this.dom.showAll();
      if (!onBoard) { this.generation += 1; return; }
      await this.restore();
      await this.waitForCardsAndLoad();
    }

    scheduleAutoRefresh() {
      clearInterval(this.autoTimer);
      const minutes = this.settings.autoRefreshMinutes;
      if (!minutes) return;
      this.autoTimer = setInterval(() => {
        if (document.visibilityState === 'visible' && this.index) this.reload();
      }, minutes * 60000);
    }

    async onSettingsChanged() {
      this.settings = await root.BTF.settings.load();
      this.dom.stop();
      this.dom.showAll();
      this.dom = new root.BTF.BoardDom(this.settings);
      this.dom.watch(() => this.onBoardRedrawn());
      this.panel.setLook(this.settings.panelSide, this.settings.theme);
      this.scheduleAutoRefresh();
      this.lastHidden = new Set();
      await this.reload();
    }
  }

  (async () => {
    try {
      const settings = await root.BTF.settings.load();
      await new Controller(settings).start();
    } catch (e) {
      console.error(TAG, e);
    }
  })();
})(globalThis);
