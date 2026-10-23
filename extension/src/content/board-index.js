/*
 * Модель данных доски: кто участвует в каждой карточке.
 * Участие бывает двух видов: человек указан в поле карточки типа Identity
 * или исполняет её дочерний элемент.
 */
(function (root) {
  'use strict';

  /** Значение поля типа Identity: объект с именем и уникальным идентификатором. */
  function toPerson(value) {
    if (!value || typeof value !== 'object' || typeof value.displayName !== 'string') return null;
    const key = value.uniqueName || value.descriptor || value.id;
    if (typeof key !== 'string' || !key) return null;
    return { key: key.toLowerCase(), name: value.displayName };
  }

  function peopleIn(fieldValue) {
    const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
    return values.map(toPerson).filter(Boolean);
  }

  class BoardIndex {
    constructor(settings) {
      this.useCardFields = settings.useCardFields;
      this.ignored = new Set(settings.ignoredFields.map((f) => f.toLowerCase()));
      this.done = new Set(settings.doneStates.map((s) => s.toLowerCase()));
      this.cards = new Map();     // номер карточки -> { owners: Set, children: number[] }
      this.children = new Map();  // номер дочернего элемента -> { state, assignee }
      this.names = new Map();     // ключ человека -> отображаемое имя
    }

    knows(cardId) {
      return this.cards.has(cardId);
    }

    remember(person) {
      if (!this.names.has(person.key)) this.names.set(person.key, person.name);
      return person.key;
    }

    addCards(workItems) {
      for (const item of workItems) {
        const owners = new Set();
        if (this.useCardFields) {
          for (const [field, value] of Object.entries(item.fields || {})) {
            if (this.ignored.has(field.toLowerCase())) continue;
            for (const person of peopleIn(value)) owners.add(this.remember(person));
          }
        }
        const previous = this.cards.get(item.id);
        this.cards.set(item.id, { owners, children: previous ? previous.children : [] });
      }
    }

    addLinks(pairs) {
      for (const { parent, child } of pairs) {
        const card = this.cards.get(parent);
        if (card && !card.children.includes(child)) card.children.push(child);
      }
    }

    addChildren(workItems) {
      for (const item of workItems) {
        const fields = item.fields || {};
        const person = toPerson(fields['System.AssignedTo']);
        this.children.set(item.id, {
          state: String(fields['System.State'] || ''),
          assignee: person ? this.remember(person) : null
        });
      }
    }

    isOpen(child) {
      return !this.done.has(child.state.toLowerCase());
    }

    /** Ключи всех участников карточки. */
    participants(cardId, onlyActive) {
      const card = this.cards.get(cardId);
      const result = new Set(card ? card.owners : []);
      if (!card) return result;
      for (const childId of card.children) {
        const child = this.children.get(childId);
        if (!child || !child.assignee) continue;
        if (onlyActive && !this.isOpen(child)) continue;
        result.add(child.assignee);
      }
      return result;
    }

    /**
     * Подходит ли карточка под выбранных людей.
     * null — данных по карточке ещё нет, решать рано.
     */
    matches(cardId, selected, onlyActive) {
      if (!this.cards.has(cardId)) return null;
      const people = this.participants(cardId, onlyActive);
      for (const key of selected) if (people.has(key)) return true;
      return false;
    }

    /** Список людей с числом карточек на доске, по алфавиту. */
    people(cardIds, onlyActive) {
      const counts = new Map();
      for (const id of cardIds) {
        for (const key of this.participants(id, onlyActive)) counts.set(key, (counts.get(key) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([key, count]) => ({ key, name: this.names.get(key) || key, count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }

    childIds() {
      const ids = new Set();
      for (const card of this.cards.values()) for (const id of card.children) ids.add(id);
      return [...ids];
    }
  }

  root.BTF = root.BTF || {};
  root.BTF.BoardIndex = BoardIndex;
})(globalThis);
