import {
  DEFAULT_EDITOR_STATUS,
  useEditorStatusStore,
} from "@/modules/editor";
import { useTranslation } from "@/modules/i18n";

type Props = {
  editorId: number | null;
  onGotoLine: () => void;
};

export function EditorStatus({ editorId, onGotoLine }: Props) {
  const { t } = useTranslation();
  const status = useEditorStatusStore((state) =>
    editorId === null
      ? null
      : (state.byEditorId[editorId] ?? DEFAULT_EDITOR_STATUS),
  );

  if (!status) return null;

  const indentLabel = status.indentUnit.startsWith("\t")
    ? t("common.indentTabs")
    : t("statusbar.spacesCount", { count: status.indentUnit.length });

  return (
    <div className="flex shrink-0 items-center gap-1 text-[10.5px] tabular-nums text-muted-foreground">
      <button
        type="button"
        onClick={onGotoLine}
        title={t("statusbar.positionTooltip")}
        className="voktty-pill-in rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
      >
        {t("statusbar.line")} {status.line}, {t("statusbar.col")} {status.column}
      </button>
      {status.selectionCharacters > 0 ? (
        <span
          className="voktty-pill-in rounded px-1.5 py-0.5"
          title={t("statusbar.selectionTooltip", {
            characters: status.selectionCharacters,
            lines: status.selectionLines,
            ranges: status.selectionCount,
          })}
        >
          {t("statusbar.selection", { count: status.selectionCharacters })}
        </span>
      ) : null}
      <span className="hidden px-1 md:inline uppercase">
        {status.languageId}
      </span>
      <span className="hidden px-1 lg:inline">{indentLabel}</span>
      <span className="hidden px-1 lg:inline uppercase">{status.eol}</span>
    </div>
  );
}
