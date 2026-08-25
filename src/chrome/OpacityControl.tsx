import { listen } from "@tauri-apps/api/event";
import { Blend } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  applyBodyGlass,
  applyColorScheme,
  applySidebarBlur,
  applySidebarOpacity,
  applyThemeTint,
  loadBodyGlass,
  loadColorScheme,
  loadSidebarBlur,
  loadSidebarLayout,
  loadSidebarOpacity,
  loadThemeHue,
  loadThemeSaturation,
  saveBodyGlass,
  saveColorScheme,
  saveSidebarBlur,
  saveSidebarLayout,
  saveSidebarOpacity,
  saveThemeHue,
  saveThemeSaturation,
  SIDEBAR_BLUR_MAX,
  SIDEBAR_BLUR_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  THEME_HUE_MAX,
  THEME_HUE_MIN,
  THEME_SATURATION_MAX,
  THEME_SATURATION_MIN,
  type ColorScheme,
  type SidebarLayout,
} from "../lib/appearance";

export function OpacityControl() {
  const [open, setOpen] = useState(false);
  const [opacity, setOpacity] = useState(() => {
    const value = loadSidebarOpacity();
    applySidebarOpacity(value);
    return value;
  });
  const [blur, setBlur] = useState(() => {
    const value = loadSidebarBlur();
    applySidebarBlur(value);
    return value;
  });
  const [bodyGlass, setBodyGlass] = useState(() => {
    const value = loadBodyGlass();
    applyBodyGlass(value);
    return value;
  });
  const [themeHue, setThemeHue] = useState(loadThemeHue);
  const [themeSaturation, setThemeSaturation] = useState(loadThemeSaturation);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(loadColorScheme);
  const [sidebarLayout, setSidebarLayout] =
    useState<SidebarLayout>(loadSidebarLayout);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unlisten = listen("sidebar_opacity", () => setOpen(true));
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const percent = Math.round(opacity * 100);

  const onOpacity = (nextPercent: number) => {
    const next = applySidebarOpacity(nextPercent / 100);
    saveSidebarOpacity(next);
    setOpacity(next);
  };

  const onBlur = (nextRadius: number) => {
    const next = applySidebarBlur(nextRadius);
    saveSidebarBlur(next);
    setBlur(next);
  };

  const onBodyGlass = (next: boolean) => {
    applyBodyGlass(next);
    saveBodyGlass(next);
    setBodyGlass(next);
  };

  const onColorScheme = (next: ColorScheme) => {
    applyColorScheme(next);
    saveColorScheme(next);
    setColorScheme(next);
  };

  const onSidebarLayout = (next: SidebarLayout) => {
    saveSidebarLayout(next);
    setSidebarLayout(next);
  };

  const onThemeHue = (nextHue: number) => {
    const { hue, saturation } = applyThemeTint(nextHue, themeSaturation);
    saveThemeHue(hue);
    setThemeHue(hue);
    setThemeSaturation(saturation);
  };

  const onThemeSaturation = (nextSaturation: number) => {
    const { hue, saturation } = applyThemeTint(themeHue, nextSaturation);
    saveThemeSaturation(saturation);
    setThemeHue(hue);
    setThemeSaturation(saturation);
  };

  return (
    <div ref={root} className="relative" data-tauri-drag-region="false">
      <button
        type="button"
        title="Appearance"
        aria-label="Appearance"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tauri-drag-region="false"
        onClick={() => setOpen((value) => !value)}
        className={`grid size-6.5 place-items-center rounded-md ${
          open
            ? "bg-content/10 text-content"
            : "text-content/50 hover:bg-content/10 hover:text-content"
        }`}
      >
        <Blend className="size-3.5" strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Appearance"
          data-tauri-drag-region="false"
          className="absolute right-0 top-full z-50 mt-1.5 flex w-72 flex-col gap-3 rounded-lg border border-content/5 bg-content/5 p-3 shadow-xl backdrop-blur-md"
        >
          <SegmentedRow
            label="Layout"
            value={sidebarLayout}
            options={[
              { value: "classic", label: "Classic" },
              { value: "deck", label: "Deck" },
            ]}
            onChange={onSidebarLayout}
          />
          <SegmentedRow
            label="Theme"
            value={colorScheme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            onChange={onColorScheme}
          />
          <SliderRow
            label="Opacity"
            value={percent}
            display={`${percent}%`}
            min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
            max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
            onChange={onOpacity}
          />
          <SliderRow
            label="Hue"
            value={themeHue}
            display={`${themeHue}°`}
            min={THEME_HUE_MIN}
            max={THEME_HUE_MAX}
            onChange={onThemeHue}
          />
          <SliderRow
            label="Saturation"
            value={themeSaturation}
            display={`${themeSaturation}%`}
            min={THEME_SATURATION_MIN}
            max={THEME_SATURATION_MAX}
            onChange={onThemeSaturation}
          />
          <SliderRow
            label="Blur radius"
            value={blur}
            display={String(blur)}
            min={SIDEBAR_BLUR_MIN}
            max={SIDEBAR_BLUR_MAX}
            onChange={onBlur}
          />
          <ToggleRow label="Main pane" on={bodyGlass} onChange={onBodyGlass} />
        </div>
      ) : null}
    </div>
  );
}

function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-content/50">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-0.5 rounded-md border border-content/10 p-0.5"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-[5px] px-2 py-0.5 ${
              value === option.value
                ? "bg-content/10 text-content"
                : "text-content/50 hover:text-content"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[12px]">
        <span className="text-content/50">{label}</span>
        <span className="tabular-nums text-content">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-label={label}
        className="sidebar-opacity-slider w-full"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between text-[12px]"
    >
      <span className="text-content/50">{label}</span>
      <span
        className={`relative h-4 w-7 rounded-full ${on ? "bg-accent" : "bg-content/20"}`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-content ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
