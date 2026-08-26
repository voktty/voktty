import { Input } from "@/components/ui/input";
import { useTranslation } from "@/modules/i18n";
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  searchSettings,
  type SettingsSearchEntry,
} from "../settingsSearch";

type Props = {
  onSelect: (entry: SettingsSearchEntry) => void;
};

export function SettingsSearch({ onSelect }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchSettings(query, t), [query, t]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const handleSettingsShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", handleSettingsShortcut, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleSettingsShortcut, {
        capture: true,
      });
    };
  }, []);

  const selectResult = (entry: SettingsSearchEntry) => {
    onSelect(entry);
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <div className="relative z-20 w-full">
      <div className="relative">
        <HugeiconsIcon
          icon={Search01Icon}
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (!results.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex(
                (index) => (index - 1 + results.length) % results.length,
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              const result = results[activeIndex];
              if (result) selectResult(result);
            }
          }}
          placeholder={t("settings.search.placeholder")}
          aria-label={t("settings.search.placeholder")}
          aria-autocomplete="list"
          className="h-8 rounded-lg border-border/60 bg-background/70 pl-8 pr-8 text-[11.5px] shadow-xs"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("common.close")}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} />
          </button>
        ) : null}
      </div>

      {query ? (
        <div className="absolute left-0 right-0 top-11 overflow-hidden rounded-lg border border-border/80 bg-popover text-popover-foreground shadow-xl">
          {results.length ? (
            <div className="max-h-72 overflow-y-auto p-1">
              {results.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectResult(entry)}
                  className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors ${
                    index === activeIndex
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  <HugeiconsIcon
                    icon={Search01Icon}
                    size={13}
                    className="mt-0.5 shrink-0 text-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {t(entry.titleKey)}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {t(`settings.tabs.${entry.tab}`)}
                      {entry.descriptionKey ? ` · ${t(entry.descriptionKey)}` : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {t("settings.search.noResults")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
