/*
 * Работа с разметкой доски: поиск карточек, скрытие и показ,
 * наблюдение за перерисовкой.
 */
(function (root) {
  'use strict';

  // Класс, которым доска Azure DevOps сама скрывает отфильтрованные карточки.
  // Им же пользуемся мы, чтобы доска пересчитала высоту дорожек.
  const BOARD_HIDDEN = 'filterHide';
  // Отметка «эту карточку скрыло расширение».
  const MARK = 'data-btf-hidden';
  const WORK_ITEM_LINK = /\/_workitems\/edit\/(\d+)/;

  class BoardDom {
    constructor(settings) {
      this.cardSelector = settings.cardSelector;
      this.idSelector = settings.cardIdSelector;
      this.observer = null;
      this.timer = null;
    }

    idOf(card) {
      const label = card.querySelector(this.idSelector);
      const fromLabel = label ? parseInt(label.textContent.replace(/\D+/g, ''), 10) : NaN;
      if (Number.isInteger(fromLabel) && fromLabel > 0) return fromLabel;
      const link = card.querySelector('a[href*="/_workitems/edit/"]');
      const fromLink = link ? link.getAttribute('href').match(WORK_ITEM_LINK) : null;
      if (fromLink) return Number(fromLink[1]);
      const fromData = Number(card.getAttribute('data-itemid') || card.getAttribute('data-id'));
      return Number.isInteger(fromData) && fromData > 0 ? fromData : null;
    }

    /** Карточки на доске: номер -> элемент. */
    cards() {
      const found = new Map();
      let nodes;
      try {
        nodes = document.querySelectorAll(this.cardSelector);
      } catch (_) {
        return found; // в настройках неверный селектор
      }
      for (const node of nodes) {
        const id = this.idOf(node);
        if (id && !found.has(id)) found.set(id, node);
      }
      return found;
    }

    hiddenByBoard(card) {
      return card.classList.contains(BOARD_HIDDEN) && !card.hasAttribute(MARK);
    }

    /** Скрывает или показывает карточку. Возвращает true, если что-то изменилось. */
    setHidden(card, hidden) {
      if (hidden) {
        if (card.classList.contains(BOARD_HIDDEN)) return false; // уже скрыта доской или нами
        card.classList.add(BOARD_HIDDEN);
        card.setAttribute(MARK, '');
        return true;
      }
      if (!card.hasAttribute(MARK)) return false; // не наша: не трогаем
      card.classList.remove(BOARD_HIDDEN);
      card.removeAttribute(MARK);
      return true;
    }

    showAll() {
      let changed = false;
      for (const card of document.querySelectorAll(`[${MARK}]`)) changed = this.setHidden(card, false) || changed;
      return changed;
    }

    /** Просит доску пересчитать раскладку после скрытия карточек. */
    relayout() {
      window.dispatchEvent(new Event('resize'));
    }

    /**
     * Сообщает о перерисовке доски: появились или пропали карточки.
     * Изменения атрибутов и любые другие узлы игнорируются.
     */
    watch(onChange) {
      const selector = this.cardSelector;
      const touchesCards = (nodes) => {
        for (const node of nodes) {
          if (node.nodeType !== 1) continue;
          try {
            if (node.matches(selector) || node.querySelector(selector)) return true;
          } catch (_) {
            return false;
          }
        }
        return false;
      };
      this.observer = new MutationObserver((records) => {
        const relevant = records.some((r) => touchesCards(r.addedNodes) || touchesCards(r.removedNodes));
        if (!relevant) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(onChange, 250);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }

    stop() {
      if (this.observer) this.observer.disconnect();
      clearTimeout(this.timer);
    }
  }

  root.BTF = root.BTF || {};
  root.BTF.BoardDom = BoardDom;
})(globalThis);
