import { StateEffect, StateField } from "@codemirror/state";
import {
  type EditorView,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";

export type CodeActionPanelItem = {
  id: string;
  title: string;
  detail: string | null;
  preferredLabel: string | null;
  disabledReason: string | null;
  onPick: () => void | Promise<void>;
};

type CodeActionPanelSpec = {
  pos: number;
  title: string;
  items: CodeActionPanelItem[];
};

const setCodeActionPanel =
  StateEffect.define<CodeActionPanelSpec | null>();

const codeActionPanelField = StateField.define<CodeActionPanelSpec | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setCodeActionPanel)) return effect.value;
    }
    return transaction.docChanged || transaction.selection ? null : value;
  },
  provide: (field) =>
    showTooltip.from(field, (spec) =>
      spec ? createCodeActionTooltip(spec) : null,
    ),
});

export function openCodeActionsPanel(
  view: EditorView,
  spec: CodeActionPanelSpec,
): void {
  view.dispatch({ effects: setCodeActionPanel.of(spec) });
}

export function closeCodeActionsPanel(view: EditorView): void {
  view.dispatch({ effects: setCodeActionPanel.of(null) });
  view.focus();
}

function createCodeActionTooltip(spec: CodeActionPanelSpec): Tooltip {
  return {
    pos: spec.pos,
    above: false,
    arrow: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-code-actions";
      dom.setAttribute("role", "dialog");
      dom.setAttribute("aria-label", spec.title);

      const header = document.createElement("div");
      header.className = "cm-lsp-code-actions-header";
      header.textContent = spec.title;
      dom.appendChild(header);

      const list = document.createElement("ul");
      list.tabIndex = 0;
      list.setAttribute("role", "listbox");
      dom.appendChild(list);

      const enabled = spec.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => !item.disabledReason);
      let activeEnabledIndex = 0;
      const rows: HTMLLIElement[] = [];

      const pick = (itemIndex: number) => {
        const item = spec.items[itemIndex];
        if (!item || item.disabledReason) return;
        closeCodeActionsPanel(view);
        void item.onPick();
      };

      for (let index = 0; index < spec.items.length; index += 1) {
        const item = spec.items[index];
        const row = document.createElement("li");
        row.setAttribute("role", "option");
        row.dataset.actionId = item.id;
        if (item.disabledReason) {
          row.setAttribute("aria-disabled", "true");
          row.title = item.disabledReason;
        }

        const primary = document.createElement("span");
        primary.className = "cm-lsp-code-actions-primary";
        primary.textContent = item.title;
        row.appendChild(primary);

        const metadata = [item.preferredLabel, item.detail].filter(Boolean);
        if (metadata.length > 0) {
          const detail = document.createElement("span");
          detail.className = "cm-lsp-code-actions-detail";
          detail.textContent = metadata.join(" · ");
          row.appendChild(detail);
        }
        if (item.disabledReason) {
          const reason = document.createElement("span");
          reason.className = "cm-lsp-code-actions-disabled";
          reason.textContent = item.disabledReason;
          row.appendChild(reason);
        }
        row.addEventListener("mousedown", (event) => {
          event.preventDefault();
          pick(index);
        });
        list.appendChild(row);
        rows.push(row);
      }

      const renderActive = () => {
        const activeItemIndex = enabled[activeEnabledIndex]?.index ?? -1;
        rows.forEach((row, index) => {
          const active = index === activeItemIndex;
          row.classList.toggle("cm-lsp-code-actions-active", active);
          row.setAttribute("aria-selected", String(active));
        });
        rows[activeItemIndex]?.scrollIntoView({ block: "nearest" });
      };

      list.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
          activeEnabledIndex = Math.min(
            activeEnabledIndex + 1,
            Math.max(0, enabled.length - 1),
          );
        } else if (event.key === "ArrowUp") {
          activeEnabledIndex = Math.max(activeEnabledIndex - 1, 0);
        } else if (event.key === "Enter") {
          const itemIndex = enabled[activeEnabledIndex]?.index;
          if (itemIndex !== undefined) pick(itemIndex);
        } else if (event.key === "Escape") {
          closeCodeActionsPanel(view);
        } else {
          return;
        }
        event.preventDefault();
        renderActive();
      });

      renderActive();
      return {
        dom,
        mount: () => list.focus(),
      };
    },
  };
}

export const codeActionsPanel = codeActionPanelField;
