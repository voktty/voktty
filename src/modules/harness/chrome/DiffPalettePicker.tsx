import { useEffect, useState } from "react";
import { useTranslation } from "@/modules/i18n";
import {
  DIFF_PALETTE_CHANGE_EVENT,
  loadDiffPalette,
  saveDiffPalette,
  type DiffPalette,
} from "@/modules/harness/lib/diffPalette";

export function DiffPalettePicker() {
  const { t } = useTranslation();
  const [palette, setPalette] = useState(loadDiffPalette);

  useEffect(() => {
    const onChange = () => setPalette(loadDiffPalette());
    window.addEventListener(DIFF_PALETTE_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(DIFF_PALETTE_CHANGE_EVENT, onChange);
  }, []);

  return (
    <select
      aria-label={t("harness.settings.diffColors")}
      value={palette}
      onChange={(event) => {
        const next = event.target.value as DiffPalette;
        saveDiffPalette(next);
        setPalette(next);
      }}
      className="max-w-52 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[12px] text-foreground outline-none hover:border-border"
    >
      <option value="default">{t("common.default")}</option>
      <option value="colorblind">{t("harness.settings.colorblind")}</option>
      <option value="high-contrast">
        {t("harness.settings.highContrast")}
      </option>
    </select>
  );
}
