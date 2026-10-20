import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/modules/i18n";
import { LAYER } from "../lib/layers";
import { basename } from "../lib/fs";
import { prettyCwd } from "../lib/paths";

type Props = {
  paths: string[];
  onCancel: () => void;
  /** `purgeData` also deletes the saved conversations of the removed projects. */
  onConfirm: (options: { purgeData: boolean }) => void;
};

const SHOWN = 6;

/** Drops every project whose folder no longer exists, in one confirmation. */
export function RemoveUnavailableProjectsDialog({ paths, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [purgeData, setPurgeData] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const shown = paths.slice(0, SHOWN);
  const hidden = paths.length - shown.length;

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: LAYER.dialog }}>
      <div className="absolute inset-0 z-0 bg-black/30" onMouseDown={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("harness.chrome.removeUnavailableTitle", { count: paths.length })}
        onMouseDown={(event) => event.stopPropagation()}
        className="voktty-floating-surface absolute z-[1] left-1/2 top-[22%] flex w-[min(460px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-3 rounded-xl border p-4 text-popover-foreground shadow-2xl"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-[13px] font-medium leading-tight text-content">
            {t("harness.chrome.removeUnavailableTitle", { count: paths.length })}
          </h2>
          <p className="text-[12px] leading-snug text-content/55">
            {t("harness.chrome.removeUnavailableDescription")}
          </p>
        </div>
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {shown.map((path) => (
            <li key={path} className="min-w-0 text-[12px] leading-tight text-content/80">
              <span className="font-medium">{basename(path)}</span>
              <span className="ml-2 truncate text-[11px] text-content/40">{prettyCwd(path)}</span>
            </li>
          ))}
          {hidden > 0 ? (
            <li className="text-[11px] text-content/45">
              {t("harness.chrome.removeUnavailableMore", { count: hidden })}
            </li>
          ) : null}
        </ul>
        <label className="flex items-start gap-2 text-[12px] leading-snug text-content/70">
          <input
            type="checkbox"
            checked={purgeData}
            onChange={(event) => setPurgeData(event.target.checked)}
            className="mt-0.5"
          />
          <span>{t("harness.chrome.removeUnavailablePurge")}</span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ purgeData })}
            className="rounded-md bg-red-500/20 px-3 py-1.5 text-[12px] font-medium text-red-300 hover:bg-red-500/30"
          >
            {t("harness.chrome.removeUnavailableConfirm", { count: paths.length })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}