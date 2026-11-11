import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Settings,
  Star,
} from "./icons";
import { openSettingsWindow } from "@/modules/settings/openSettingsWindow";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "@/modules/i18n";
import {
  modelSettingDescription,
  modelSettingLabel,
  modelSettingOptionLabel,
} from "../lib/catalogLabels";
import {
  coerceModelPickerTab,
  findModel,
  getModelSnapshot,
  getPickerVisibilitySnapshot,
  loadFavoriteModels,
  loadRecentModelChoices,
  modelsFor,
  resolveModel,
  saveFavoriteModels,
  saveLastModelChoice,
  saveRecentModelChoice,
  showProviderInModelPicker,
  subscribeModels,
  subscribePickerVisibility,
  type AgentModel,
  type ModelPickerTab,
  type ModelSetting,
} from "../lib/models";
import {
  harnessUnavailableHint,
  hasProbedHarnessAvailability,
  isHarnessAvailable,
  probeHarnessAvailability,
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../lib/harness/availability";
import { refreshHarnessCatalogs } from "../lib/harness/registry";
import { HARNESSES, HARNESS_TITLE, type HarnessId } from "../lib/session";
import { useLockOverscroll } from "../hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import { Popover } from "./Popover";
import { MOD } from "../lib/platform";
import "./ModelPicker.css";

function isEffortSetting(setting: ModelSetting): boolean {
  return (
    setting.id === "effort" ||
    setting.id === "reasoning" ||
    setting.id === "reasoningEffort" ||
    setting.id === "variant"
  );
}

export function effortTileTone(
  setting: ModelSetting,
  value: string,
): "ultra" | "max" | undefined {
  if (!isEffortSetting(setting)) return undefined;
  const normalized = value.toLowerCase();
  return normalized === "ultra"
    ? "ultra"
    : normalized === "max"
      ? "max"
      : undefined;
}

const EFFORT_TILE_COLUMNS = 32;
const EFFORT_TILE_ROWS = 5;

function EffortTileShimmer() {
  return (
    <span className="codex-effort-tiles" aria-hidden="true">
      {Array.from(
        { length: EFFORT_TILE_COLUMNS * EFFORT_TILE_ROWS },
        (_, index) => {
          const column = index % EFFORT_TILE_COLUMNS;
          const row = Math.floor(index / EFFORT_TILE_COLUMNS);
          const centerColumn = (EFFORT_TILE_COLUMNS - 1) / 2;
          const centerRow = (EFFORT_TILE_ROWS - 1) / 2;
          const distance = Math.hypot(
            (column - centerColumn) / centerColumn,
            (row - centerRow) / centerRow,
          );
          const filled = (index * 73 + index * index * 19 + 23) % 101 < 65;
          return (
            <span
              key={index}
              className={`codex-effort-tile${filled ? " codex-effort-tile--filled" : ""}`}
              style={{ "--tile-distance": distance } as React.CSSProperties}
            />
          );
        },
      )}
    </span>
  );
}

type Props = {
  harness: HarnessId;
  model: string;
  values: Record<string, string>;
  hotkeys?: boolean;
  onChange: (harness: HarnessId, model: string) => void;
  onSettingsChange: (settings: Record<string, string>) => void;
  onClose?: () => void;
};

type MenuEntry = { kind: "setting"; setting: ModelSetting } | { kind: "model" };

type Submenu = { kind: "setting"; setting: ModelSetting } | { kind: "models" };

type RecentMenu = { models: AgentModel[] };

const MENU_WIDTH = 250;
const MODEL_MENU_WIDTH = 310;
const SELF = "[data-model-picker]";

/** Tall enough for tabs, search, about eight models and the footer. */
const MODEL_LIST_HEIGHT = 380;

const SETTING_ORDER = [
  "fast",
  "effort",
  "reasoning",
  "thinking",
  "variant",
  "agent",
  "context",
];

function pickerSettings(model: AgentModel): ModelSetting[] {
  return [...(model.settings ?? [])]
    .filter(
      (setting) => !(model.harness === "opencode" && setting.id === "agent"),
    )
    .sort((a, b) => {
      const ai = SETTING_ORDER.indexOf(a.id);
      const bi = SETTING_ORDER.indexOf(b.id);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
}

/** Effort-like choices short enough to pick on a track instead of a submenu. */
const MAX_SLIDER_STOPS = 8;

export function sliderSetting(settings: ModelSetting[]): ModelSetting | undefined {
  return settings.find(
    (setting) =>
      setting.kind === "select" &&
      isEffortSetting(setting) &&
      setting.options.length >= 2 &&
      setting.options.length <= MAX_SLIDER_STOPS,
  );
}

const EFFORT_RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** Track order: least effort on the left, whatever order the catalog lists. */
export function sliderOptions(setting: ModelSetting): ModelSetting["options"] {
  const options = setting.options;
  const first = EFFORT_RANK.indexOf(options[0]?.value.toLowerCase() ?? "");
  const last = EFFORT_RANK.indexOf(
    options[options.length - 1]?.value.toLowerCase() ?? "",
  );
  return first >= 0 && last >= 0 && first > last ? [...options].reverse() : options;
}

function settingValue(
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  return values[setting.id] ?? setting.value;
}

function settingValueLabel(
  t: (key: string) => string,
  setting: ModelSetting,
  values: Record<string, string>,
): string {
  const value = settingValue(setting, values);
  const option = setting.options.find((item) => item.value === value);
  return option ? modelSettingOptionLabel(t, setting, option) : value;
}

function recentMenuModels(current: AgentModel): AgentModel[] {
  const models = loadRecentModelChoices().flatMap((choice) => {
    const item = findModel(choice.model);
    return item?.harness === choice.harness ? [item] : [];
  });
  if (!models.some((item) => item.id === current.id)) models.push(current);
  return models.slice(0, 6);
}

export function ModelPicker({
  harness,
  model,
  values,
  hotkeys = false,
  onChange,
  onSettingsChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const catalogVersion = useSyncExternalStore(
    subscribeModels,
    getModelSnapshot,
    getModelSnapshot,
  );
  const availabilityVersion = useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const visibilityVersion = useSyncExternalStore(
    subscribePickerVisibility,
    getPickerVisibilitySnapshot,
    getPickerVisibilitySnapshot,
  );
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelPickerTab>(harness);
  const [active, setActive] = useState(0);
  const [activeModel, setActiveModel] = useState(0);
  const [activeSetting, setActiveSetting] = useState(0);
  const [recentMenu, setRecentMenu] = useState<RecentMenu | null>(null);
  const [recentActive, setRecentActive] = useState(0);
  const [submenu, setSubmenu] = useState<Submenu | null>(null);
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(loadFavoriteModels);
  const recentMenuId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  const recentOpenRef = useRef(recentMenu != null);
  const currentRef = useRef<AgentModel | null>(null);
  const lastHotkey = useRef(0);
  const directRef = useRef(false);
  onCloseRef.current = onClose;
  openRef.current = open;
  recentOpenRef.current = recentMenu != null;

  const current = resolveModel(harness, model);
  currentRef.current = current;
  const settings = useMemo(() => {
    void catalogVersion;
    return pickerSettings(current);
  }, [catalogVersion, current]);
  const entries = useMemo<MenuEntry[]>(
    () => [
      { kind: "model" as const },
      ...settings.map((setting) => ({
        kind: "setting" as const,
        setting,
      })),
    ],
    [settings],
  );

  const triggerLabel = current.name;
  const effort = sliderSetting(settings);
  const effortLabel = effort ? settingValueLabel(t, effort, values) : null;
  // A model with nothing to tune has nothing to show before its list.
  const direct = settings.length === 0;
  directRef.current = direct;

  const pickerHarnesses = useMemo(() => {
    void availabilityVersion;
    void visibilityVersion;
    return HARNESSES.filter((id) =>
      showProviderInModelPicker(
        id,
        isHarnessAvailable(id),
        hasProbedHarnessAvailability(),
      ),
    );
  }, [availabilityVersion, visibilityVersion]);
  const providerKey = pickerHarnesses.join(",");
  const visibleTab = coerceModelPickerTab(tab, (id) =>
    pickerHarnesses.includes(id),
  );

  const visibleModels = useMemo(() => {
    void catalogVersion;
    const needle = query.trim().toLowerCase();
    const pool =
      visibleTab === "favorites"
        ? favorites
            .map((id) => findModel(id))
            .filter(
              (item): item is AgentModel =>
                item != null && pickerHarnesses.includes(item.harness),
            )
        : modelsFor(visibleTab);
    if (!needle) return pool;
    return pool.filter((item) =>
      `${item.name} ${HARNESS_TITLE[item.harness]}`
        .toLowerCase()
        .includes(needle),
    );
  }, [catalogVersion, favorites, providerKey, query, visibleTab]);

  const dismiss = (restore: boolean) => {
    setOpen(false);
    setRecentMenu(null);
    setSubmenu(null);
    if (restore) onCloseRef.current?.();
  };

  const togglePicker = () => {
    if (openRef.current) dismiss(true);
    else {
      setRecentMenu(null);
      setOpen(true);
    }
  };

  const openRecentMenu = () => {
    const selected = currentRef.current;
    if (!selected) return;
    const models = recentMenuModels(selected);
    const selectedIndex = models.findIndex((item) => item.id === selected.id);
    setOpen(false);
    setSubmenu(null);
    setRecentActive(selectedIndex >= 0 ? selectedIndex : 0);
    setRecentMenu({ models });
  };

  const toggleRecentMenu = () => {
    if (recentOpenRef.current) {
      setRecentMenu(null);
      onCloseRef.current?.();
    } else {
      openRecentMenu();
    }
  };

  const toggleFromHotkey = () => {
    const now = performance.now();
    if (now - lastHotkey.current < 80) return;
    lastHotkey.current = now;
    toggleRecentMenu();
  };

  useEffect(() => {
    if (!open) return;
    void probeHarnessAvailability();
    void refreshHarnessCatalogs([current.harness]);
    setTab(
      coerceModelPickerTab(current.harness, (id) =>
        pickerHarnesses.includes(id),
      ),
    );
    setActive(0);
    setSubmenu(directRef.current ? { kind: "models" } : null);
    setQuery("");
    setFavorites(loadFavoriteModels());
  }, [open, current.harness]);

  useEffect(() => {
    if (visibleTab === tab) return;
    setTab(visibleTab);
  }, [tab, visibleTab]);

  useEffect(() => {
    if (!open || submenu?.kind !== "models" || visibleTab === "favorites") {
      return;
    }
    void refreshHarnessCatalogs([visibleTab]);
  }, [open, submenu?.kind, visibleTab]);

  useEffect(() => {
    const inBlockingUi = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".monocode-terminal")) return true;
      return Boolean(
        target.closest(
          "[data-file-picker], [data-branch-picker], [data-skill-picker], [data-mention-picker], [data-access-picker]",
        ),
      );
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      if (
        hotkeys &&
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "." || event.code === "Period")
      ) {
        if (!openRef.current && inBlockingUi(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        toggleFromHotkey();
        return;
      }
      if (!openRef.current || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [hotkeys]);

  const setSetting = (setting: ModelSetting, value: string) => {
    onSettingsChange({ ...values, [setting.id]: value });
  };

  const pickModel = (item: AgentModel) => {
    if (!isHarnessAvailable(item.harness)) return;
    saveLastModelChoice(item.harness, item.id);
    saveRecentModelChoice(item.harness, item.id);
    onChange(item.harness, item.id);
    dismiss(true);
  };

  useEffect(() => {
    if (!recentMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setRecentActive(
          (index) =>
            (index + direction + recentMenu.models.length) %
            recentMenu.models.length,
        );
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      const item = recentMenu.models[recentActive];
      if (item) pickModel(item);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recentActive, recentMenu]);

  const pickSetting = (setting: ModelSetting, value: string) => {
    setSetting(setting, value);
    dismiss(true);
  };

  const toggleFavorite = (id: string) => {
    setFavorites((previous) => {
      const next = previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id];
      saveFavoriteModels(next);
      return next;
    });
  };

  const selectTab = (next: ModelPickerTab) => {
    setTab(next);
    setQuery("");
    setActiveModel(0);
  };

  const showEntrySubmenu = (entry: MenuEntry) => {
    if (entry.kind === "model") {
      setSubmenu({ kind: "models" });
      return;
    }
    if (entry.setting.kind === "select" && entry.setting !== effort) {
      setSubmenu({ kind: "setting", setting: entry.setting });
      return;
    }
    setSubmenu(null);
  };

  const backToCard = () => {
    setSubmenu(null);
    setQuery("");
    requestAnimationFrame(() => card.current?.focus({ preventScroll: true }));
  };

  const moveEntry = (direction: 1 | -1) => {
    setSubmenu(null);
    setActive((index) => (index + direction + entries.length) % entries.length);
  };

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (submenu?.kind === "models") {
        setActiveModel((index) =>
          Math.min(visibleModels.length - 1, index + 1),
        );
      } else if (submenu?.kind === "setting") {
        setActiveSetting((index) =>
          Math.min(submenu.setting.options.length - 1, index + 1),
        );
      } else {
        moveEntry(1);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (submenu?.kind === "models") {
        setActiveModel((index) => Math.max(0, index - 1));
      } else if (submenu?.kind === "setting") {
        setActiveSetting((index) => Math.max(0, index - 1));
      } else {
        moveEntry(-1);
      }
      return;
    }
    const activeEntry = entries[active];
    if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      submenu == null &&
      activeEntry?.kind === "setting" &&
      effort &&
      activeEntry.setting === effort
    ) {
      event.preventDefault();
      const options = sliderOptions(effort);
      const at = options.findIndex(
        (option) => option.value === settingValue(effort, values),
      );
      const next = Math.min(
        options.length - 1,
        Math.max(0, at + (event.key === "ArrowRight" ? 1 : -1)),
      );
      if (options[next]) setSetting(effort, options[next].value);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = entries[active];
      if (entry) showEntrySubmenu(entry);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setSubmenu(null);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (submenu?.kind === "models") {
      const item = visibleModels[activeModel];
      if (item) pickModel(item);
      return;
    }
    if (submenu?.kind === "setting") {
      const option = submenu.setting.options[activeSetting];
      if (option) pickSetting(submenu.setting, option.value);
      return;
    }
    const entry = entries[active];
    if (!entry) return;
    if (entry.kind === "setting" && entry.setting === effort) return;
    if (entry.kind === "model" || entry.setting.kind === "select") {
      showEntrySubmenu(entry);
      return;
    }
    const value = settingValue(entry.setting, values);
    setSetting(entry.setting, value === "true" ? "false" : "true");
  };


  return (
    <>
      <button
        ref={button}
        type="button"
        title={t("harness.modelPicker.recentHint", {
          harness: HARNESS_TITLE[current.harness],
          model: current.name,
          shortcut: MOD,
        })}
        aria-label={`${HARNESS_TITLE[current.harness]} ${current.name}`}
        aria-keyshortcuts={`${MOD}.`}
        aria-expanded={open || recentMenu != null}
        aria-haspopup="menu"
        onMouseDown={(event) => event.preventDefault()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openRecentMenu();
        }}
        onClick={() => togglePicker()}
        className={`flex h-6.5 shrink-0 items-center gap-1 rounded-md px-1.5 ${
          open
            ? "bg-content/10 text-content"
            : "bg-content/10 text-content hover:bg-content/15"
        }`}
      >
        <HarnessIcon harness={current.harness} className="size-4 shrink-0" />
        <span className="whitespace-nowrap text-[11px]">{triggerLabel}</span>
        {effortLabel ? (
          <span className="whitespace-nowrap text-[11px] text-content/50">
            {effortLabel}
          </span>
        ) : null}
        <ChevronDown
          className={`size-3 shrink-0 text-content/50 ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
        />
      </button>

      {open ? (
        <Popover
          ref={card}
          anchor={button}
          side="top"
          width={submenu?.kind === "models" ? MODEL_MENU_WIDTH : MENU_WIDTH}
          autoFocus
          dismissOnEscape={false}
          ignore={SELF}
          onDismiss={() => dismiss(false)}
          role={submenu?.kind === "models" ? "dialog" : "menu"}
          aria-label={
            submenu?.kind === "models"
              ? t("harness.modelPicker.models")
              : t("harness.modelPicker.modelAndEffort")
          }
          tabIndex={-1}
          onKeyDown={onMenuKey}
          data-model-picker
          className="font-sans"
        >
          {submenu?.kind === "models" ? (
            <ModelList
              onBack={direct ? undefined : backToCard}
              harnesses={pickerHarnesses}
              tab={visibleTab}
              models={visibleModels}
              currentId={current.id}
              active={activeModel}
              query={query}
              favorites={favorites}
              searchRef={search}
              onQuery={setQuery}
              onSelectTab={selectTab}
              onActive={setActiveModel}
              onPick={pickModel}
              onToggleFavorite={toggleFavorite}
              onClose={() => dismiss(true)}
            />
          ) : submenu?.kind === "setting" ? (
            <div className="p-1">
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={backToCard}
                className="flex h-8 w-full items-center gap-1 rounded-lg px-1.5 text-left text-[12px] text-content/55 hover:bg-content/5 hover:text-content"
              >
                <ChevronLeft className="size-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">
                  {modelSettingLabel(t, submenu.setting)}
                </span>
              </button>
              {submenu.setting.options.map((option, index) => {
                const selected =
                  option.value === settingValue(submenu.setting, values);
                const highlighted = index === activeSetting;
                const tileTone = effortTileTone(submenu.setting, option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveSetting(index)}
                    onClick={() => pickSetting(submenu.setting, option.value)}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] ${
                      highlighted
                        ? "bg-content/10 text-content"
                        : "text-content hover:bg-content/5"
                    } ${tileTone ? "codex-effort-option" : ""}`}
                    data-effort-tone={tileTone}
                  >
                    {tileTone ? <EffortTileShimmer /> : null}
                    <span className="min-w-0 flex-1 truncate">
                      {modelSettingOptionLabel(t, submenu.setting, option)}
                    </span>
                    {selected ? (
                      <Check
                        className="size-3.5 shrink-0 text-content/50"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-1.5">
              {entries.map((entry, index) => {
                const highlighted = index === active;
                if (entry.kind === "model") {
                  return (
                    <button
                      key="model"
                      data-model-control-index={index}
                      type="button"
                      role="menuitem"
                      aria-haspopup="dialog"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => showEntrySubmenu(entry)}
                      className={`flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left ${
                        highlighted ? "bg-content/10" : "hover:bg-content/5"
                      }`}
                    >
                      {effortLabel ? (
                        <span className="text-[15px] font-semibold leading-5 text-content">
                          {effortLabel}
                        </span>
                      ) : null}
                      <span
                        className={`flex max-w-full items-center gap-1 ${
                          effortLabel
                            ? "text-[12px] text-content/55"
                            : "text-[13px] text-content"
                        }`}
                      >
                        <HarnessIcon
                          harness={current.harness}
                          className="size-3.5 shrink-0"
                        />
                        <span className="min-w-0 truncate">{current.name}</span>
                        <ChevronRight
                          className="size-3.5 shrink-0 text-content/45"
                          strokeWidth={1.75}
                        />
                      </span>
                    </button>
                  );
                }

                const setting = entry.setting;
                const value = settingValue(setting, values);
                if (setting === effort) {
                  return (
                    <EffortSlider
                      key={setting.id}
                      setting={setting}
                      value={value}
                      label={modelSettingLabel(t, setting)}
                      optionLabel={(option) =>
                        modelSettingOptionLabel(t, setting, option)
                      }
                      onHover={() => setActive(index)}
                      onPick={(next) => setSetting(setting, next)}
                    />
                  );
                }
                const isToggle = setting.kind === "toggle";
                return (
                  <button
                    key={setting.id}
                    data-model-control-index={index}
                    type="button"
                    role={isToggle ? "menuitemcheckbox" : "menuitem"}
                    aria-checked={isToggle ? value === "true" : undefined}
                    aria-haspopup={isToggle ? undefined : "menu"}
                    title={modelSettingDescription(t, setting)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => {
                      if (isToggle) {
                        setSetting(setting, value === "true" ? "false" : "true");
                      } else {
                        showEntrySubmenu(entry);
                      }
                    }}
                    className={`flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[12px] ${
                      highlighted
                        ? "bg-content/10 text-content"
                        : "text-content/80 hover:bg-content/5"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      {modelSettingLabel(t, setting)}
                    </span>
                    {isToggle ? (
                      <span
                        aria-hidden="true"
                        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                          value === "true" ? "bg-content/35" : "bg-content/15"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 size-4 rounded-full bg-content shadow-sm transition-transform ${
                            value === "true" ? "translate-x-4.5" : "translate-x-0.5"
                          }`}
                        />
                      </span>
                    ) : (
                      <>
                        <span className="min-w-0 max-w-28 truncate text-content/55">
                          {settingValueLabel(t, setting, values)}
                        </span>
                        <ChevronRight
                          className="size-3.5 shrink-0 text-content/45"
                          strokeWidth={1.75}
                        />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Popover>
      ) : null}

      {recentMenu ? (
        <Popover
          anchor={button}
          side="top"
          width={MENU_WIDTH}
          autoFocus
          onDismiss={() => setRecentMenu(null)}
          role="menu"
          aria-label={t("harness.modelPicker.recentlyUsed")}
          aria-activedescendant={`${recentMenuId}-${recentActive}`}
          tabIndex={-1}
          onContextMenu={(event) => event.preventDefault()}
          data-model-picker
          className="p-1 font-sans"
        >
          {recentMenu.models.map((item, index) => {
            const selected = item.id === current.id;
            const highlighted = index === recentActive;
            const disabled = !isHarnessAvailable(item.harness);
            return (
              <button
                key={item.id}
                id={`${recentMenuId}-${index}`}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                title={
                  disabled ? harnessUnavailableHint(item.harness) : undefined
                }
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setRecentActive(index)}
                onClick={() => pickModel(item)}
                className={`flex h-10 w-full items-center gap-2 rounded-lg px-2 text-left disabled:cursor-not-allowed ${
                  disabled
                    ? "text-content/30"
                    : highlighted
                      ? "bg-content/10 text-content"
                      : "text-content hover:bg-content/5"
                }`}
              >
                <HarnessIcon
                  harness={item.harness}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-4">
                    {item.name}
                  </span>
                  <span className="block truncate text-[11px] leading-4 text-content/45">
                    {HARNESS_TITLE[item.harness]}
                  </span>
                </span>
                {selected ? (
                  <Check
                    className="size-3.5 shrink-0 text-content/55"
                    strokeWidth={2}
                  />
                ) : null}
              </button>
            );
          })}
        </Popover>
      ) : null}
    </>
  );
}

function ModelList({
  onBack,
  harnesses,
  tab,
  models,
  currentId,
  active,
  query,
  favorites,
  searchRef,
  onQuery,
  onSelectTab,
  onActive,
  onPick,
  onToggleFavorite,
  onClose,
}: {
  /** Returns to the model card; absent when the list is all there is. */
  onBack?: () => void;
  harnesses: HarnessId[];
  tab: ModelPickerTab;
  models: AgentModel[];
  currentId: string;
  active: number;
  query: string;
  favorites: string[];
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (query: string) => void;
  onSelectTab: (tab: ModelPickerTab) => void;
  onActive: (index: number) => void;
  onPick: (model: AgentModel) => void;
  onToggleFavorite: (id: string) => void;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    // The popover starts hidden while it measures its anchor.
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [searchRef]);

  const onSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.min(models.length - 1, active + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      onActive(Math.max(0, active - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const item = models[active];
      if (item) onPick(item);
      return;
    }
    if (event.key === "Backspace" && !query && onBack) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.stopPropagation();
    }
  };

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden"
      style={{ height: MODEL_LIST_HEIGHT }}
    >
      <nav
        role="tablist"
        aria-label={t("harness.modelPicker.providers")}
        aria-orientation="horizontal"
        className="flex shrink-0 items-center gap-1 overflow-x-auto px-1.5 pt-1.5"
      >
        {onBack ? (
          <button
            type="button"
            title={t("harness.modelPicker.back")}
            aria-label={t("harness.modelPicker.back")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onBack}
            className="grid size-8 shrink-0 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
        ) : null}
        <ProviderTabButton
          title={t("harness.modelPicker.favorites")}
          selected={tab === "favorites"}
          onSelect={() => onSelectTab("favorites")}
        >
          <Star
            className="size-4"
            strokeWidth={1.75}
            fill={tab === "favorites" ? "currentColor" : "none"}
          />
        </ProviderTabButton>
        {harnesses.map((harness) => (
          <ProviderTabButton
            key={harness}
            title={HARNESS_TITLE[harness]}
            selected={tab === harness}
            onSelect={() => onSelectTab(harness)}
          >
            <HarnessIcon harness={harness} className="size-4" />
          </ProviderTabButton>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <label className="flex shrink-0 items-center gap-2 border-b border-content/10 px-3 py-2.5 text-content/50">
          <Search className="size-3.5 shrink-0" strokeWidth={1.75} />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder={t("harness.modelPicker.searchModels")}
            aria-label={t("harness.modelPicker.searchModels")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-content outline-none placeholder:text-content/40"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>

        <div
          ref={lockOverscroll}
          role="listbox"
          aria-label={t("harness.modelPicker.models")}
          className="min-h-0 flex-1 overflow-y-auto overscroll-none p-1"
        >
          {models.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-content/50">
              {tab === "favorites" && !query.trim()
                ? t("harness.chrome.noFavoriteModels")
                : tab !== "favorites" && !isHarnessAvailable(tab)
                  ? harnessUnavailableHint(tab)
                  : tab === "codex" && !query.trim()
                    ? t("harness.chrome.loadingCodexModels")
                    : t("harness.chrome.noMatchingModels")}
            </div>
          ) : (
            models.map((item, index) => {
              const selected = item.id === currentId;
              const highlighted = index === active;
              const favorited = favorites.includes(item.id);
              const disabled = !isHarnessAvailable(item.harness);
              return (
                <div
                  key={item.id}
                  className={`group flex h-8 items-center rounded-lg px-1 ${
                    disabled
                      ? "text-content/30"
                      : highlighted
                        ? "bg-content/10 text-content"
                        : "text-content hover:bg-content/5"
                  }`}
                  onMouseEnter={() => onActive(index)}
                >
                  <button
                    ref={highlighted ? activeRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    title={
                      disabled
                        ? harnessUnavailableHint(item.harness)
                        : undefined
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(item)}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-[13px] disabled:cursor-not-allowed"
                  >
                    <HarnessIcon
                      harness={item.harness}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </button>
                  <button
                    type="button"
                    title={
                      favorited
                        ? t("harness.chrome.removeFromFavorites")
                        : t("harness.chrome.addToFavorites")
                    }
                    aria-label={
                      favorited
                        ? t("harness.chrome.removeFromFavorites")
                        : t("harness.chrome.addToFavorites")
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFavorite(item.id);
                    }}
                    className={`grid size-6 shrink-0 place-items-center rounded-md transition-opacity ${
                      favorited
                        ? "text-content/60"
                        : "text-content/35 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    <Star
                      className="size-3.5"
                      strokeWidth={1.75}
                      fill={favorited ? "currentColor" : "none"}
                    />
                  </button>
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="grid size-6 shrink-0 place-items-center"
                    >
                      <Check
                        className="size-3.5 text-content/55"
                        strokeWidth={2}
                      />
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-content/10 px-2.5 py-1.5 bg-content/[0.02]">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onClose?.();
              void openSettingsWindow("models");
            }}
            className="flex items-center gap-1.5 text-[11px] font-medium text-content/60 hover:text-content transition-colors cursor-pointer"
          >
            <Settings className="size-3" />
            <span>{t("settings.models.manageEndpoints")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderTabButton({
  title,
  selected,
  onSelect,
  children,
}: {
  title: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      title={title}
      aria-label={title}
      aria-selected={selected}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`grid size-8 shrink-0 place-items-center rounded-md ${
        selected
          ? "bg-content/12 text-content"
          : "text-content/45 hover:bg-content/8 hover:text-content"
      }`}
    >
      <span className="shrink-0">{children}</span>
    </button>
  );
}

/** Effort as a track: drag or click anywhere on it, no submenu. */
function EffortSlider({
  setting,
  value,
  label,
  optionLabel,
  onHover,
  onPick,
}: {
  setting: ModelSetting;
  value: string;
  label: string;
  optionLabel: (option: ModelSetting["options"][number]) => string;
  onHover: () => void;
  onPick: (value: string) => void;
}) {
  const options = sliderOptions(setting);
  const at = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef(at);
  last.current = at;

  const pickAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.min(
      options.length - 1,
      Math.max(0, Math.floor(ratio * options.length)),
    );
    if (index === last.current) return;
    last.current = index;
    const option = options[index];
    if (option) onPick(option.value);
  };

  return (
    <div
      data-effort-slider
      onMouseEnter={onHover}
      className="px-2 pt-1 pb-2"
    >
      <div
        ref={track}
        role="radiogroup"
        aria-label={label}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pickAt(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current) pickAt(event.clientX);
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className="relative flex h-9 cursor-pointer touch-none select-none items-center rounded-full bg-content/10 p-1"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-content shadow-sm transition-[left] duration-150"
          style={{
            left: `calc(${(at / options.length) * 100}% + 4px)`,
            width: `calc(${100 / options.length}% - 8px)`,
          }}
        />
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={index === at}
            aria-label={optionLabel(option)}
            title={optionLabel(option)}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(option.value)}
            className="pointer-events-none relative grid h-full flex-1 place-items-center"
          >
            {index === at ? null : (
              <span className="size-1 rounded-full bg-content/40" />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
