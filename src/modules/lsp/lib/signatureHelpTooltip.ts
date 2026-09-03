import { StateEffect, StateField } from "@codemirror/state";
import {
  type EditorView,
  keymap,
  showTooltip,
  type Tooltip,
} from "@codemirror/view";
import type { NormalizedSignatureHelp } from "./signatureHelp";

export type SignatureHelpLabels = {
  previous: string;
  next: string;
  close: string;
};

type SignatureTooltipSpec = {
  pos: number;
  help: NormalizedSignatureHelp;
  labels: SignatureHelpLabels;
};

const setSignatureTooltip =
  StateEffect.define<SignatureTooltipSpec | null>();

const signatureTooltipField = StateField.define<SignatureTooltipSpec | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSignatureTooltip)) return effect.value;
    }
    return transaction.docChanged || transaction.selection ? null : value;
  },
  provide: (field) =>
    showTooltip.from(field, (spec) =>
      spec ? createSignatureTooltip(spec) : null,
    ),
});

export function openSignatureTooltip(
  view: EditorView,
  spec: SignatureTooltipSpec,
): void {
  view.dispatch({ effects: setSignatureTooltip.of(spec) });
}

export function closeSignatureTooltip(view: EditorView): boolean {
  if (!view.state.field(signatureTooltipField, false)) return false;
  view.dispatch({ effects: setSignatureTooltip.of(null) });
  return true;
}

function cycleSignature(view: EditorView, delta: number): boolean {
  const spec = view.state.field(signatureTooltipField, false);
  if (!spec || spec.help.signatures.length < 2) return false;
  const count = spec.help.signatures.length;
  const activeSignature =
    (spec.help.activeSignature + delta + count) % count;
  view.dispatch({
    effects: setSignatureTooltip.of({
      ...spec,
      help: { ...spec.help, activeSignature },
    }),
  });
  return true;
}

function createSignatureTooltip(spec: SignatureTooltipSpec): Tooltip {
  return {
    pos: spec.pos,
    above: true,
    arrow: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-lsp-signature-help";
      const signature = spec.help.signatures[spec.help.activeSignature];

      const header = document.createElement("div");
      header.className = "cm-lsp-signature-header";
      if (spec.help.signatures.length > 1) {
        const previous = document.createElement("button");
        previous.type = "button";
        previous.textContent = "‹";
        previous.setAttribute("aria-label", spec.labels.previous);
        previous.title = spec.labels.previous;
        previous.addEventListener("mousedown", (event) => {
          event.preventDefault();
          cycleSignature(view, -1);
        });
        header.appendChild(previous);

        const count = document.createElement("span");
        count.className = "cm-lsp-signature-count";
        count.textContent = `${spec.help.activeSignature + 1}/${spec.help.signatures.length}`;
        header.appendChild(count);

        const next = document.createElement("button");
        next.type = "button";
        next.textContent = "›";
        next.setAttribute("aria-label", spec.labels.next);
        next.title = spec.labels.next;
        next.addEventListener("mousedown", (event) => {
          event.preventDefault();
          cycleSignature(view, 1);
        });
        header.appendChild(next);
      }

      const label = document.createElement("code");
      label.className = "cm-lsp-signature-label";
      const parameter =
        signature.activeParameter === null
          ? null
          : signature.parameters[signature.activeParameter];
      if (parameter) {
        label.appendChild(
          document.createTextNode(signature.label.slice(0, parameter.start)),
        );
        const active = document.createElement("strong");
        active.textContent = signature.label.slice(parameter.start, parameter.end);
        label.appendChild(active);
        label.appendChild(
          document.createTextNode(signature.label.slice(parameter.end)),
        );
      } else {
        label.textContent = signature.label;
      }
      header.appendChild(label);

      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", spec.labels.close);
      close.title = spec.labels.close;
      close.addEventListener("mousedown", (event) => {
        event.preventDefault();
        closeSignatureTooltip(view);
        view.focus();
      });
      header.appendChild(close);
      dom.appendChild(header);

      const documentation =
        parameter?.documentation ?? signature.documentation;
      if (documentation) {
        const docs = document.createElement("div");
        docs.className = "cm-lsp-signature-documentation";
        docs.textContent = documentation;
        dom.appendChild(docs);
      }
      return { dom };
    },
  };
}

export const signatureHelpTooltip = [
  signatureTooltipField,
  keymap.of([
    {
      key: "Escape",
      run: closeSignatureTooltip,
    },
    {
      key: "Alt-ArrowUp",
      run: (view) => cycleSignature(view, -1),
    },
    {
      key: "Alt-ArrowDown",
      run: (view) => cycleSignature(view, 1),
    },
  ]),
];
