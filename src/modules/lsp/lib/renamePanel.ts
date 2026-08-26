import { StateEffect, StateField } from "@codemirror/state";
import { type EditorView, showTooltip, type Tooltip } from "@codemirror/view";

type RenamePanelSpec = {
  pos: number;
  title: string;
  inputLabel: string;
  submitLabel: string;
  placeholder: string;
  onSubmit: (newName: string) => void | Promise<void>;
};

const setRenamePanel = StateEffect.define<RenamePanelSpec | null>();

const renamePanelField = StateField.define<RenamePanelSpec | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRenamePanel)) return effect.value;
    }
    return transaction.docChanged ? null : value;
  },
  provide: (field) =>
    showTooltip.from(field, (spec) =>
      spec ? createRenameTooltip(spec) : null,
    ),
});

export function openRenamePanel(view: EditorView, spec: RenamePanelSpec): void {
  view.dispatch({ effects: setRenamePanel.of(spec) });
}

export function closeRenamePanel(view: EditorView): void {
  view.dispatch({ effects: setRenamePanel.of(null) });
  view.focus();
}

function createRenameTooltip(spec: RenamePanelSpec): Tooltip {
  return {
    pos: spec.pos,
    above: false,
    arrow: true,
    create(view) {
      const dom = document.createElement("form");
      dom.className = "cm-lsp-rename-panel";
      dom.setAttribute("role", "dialog");
      dom.setAttribute("aria-label", spec.title);

      const input = document.createElement("input");
      input.className = "cm-lsp-rename-input";
      input.value = spec.placeholder;
      input.setAttribute("aria-label", spec.inputLabel);
      input.autocomplete = "off";
      input.spellcheck = false;
      dom.appendChild(input);

      const submit = document.createElement("button");
      submit.type = "submit";
      submit.textContent = spec.submitLabel;
      dom.appendChild(submit);

      dom.addEventListener("submit", (event) => {
        event.preventDefault();
        const next = input.value.trim();
        if (!next || next === spec.placeholder) {
          closeRenamePanel(view);
          return;
        }
        closeRenamePanel(view);
        void spec.onSubmit(next);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        closeRenamePanel(view);
      });

      return {
        dom,
        mount: () => {
          input.focus();
          input.select();
        },
      };
    },
  };
}

export const renamePanel = renamePanelField;
