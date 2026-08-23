import { useEffect, useState } from "react";
import {
  loadColorScheme,
  SCHEME_CHANGE_EVENT,
  type ColorScheme,
} from "../lib/appearance";

/** Subscribes to color scheme changes triggered by applyColorScheme(). */
export function useColorScheme(): ColorScheme {
  const [scheme, setScheme] = useState<ColorScheme>(loadColorScheme);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<ColorScheme>).detail;
      setScheme(detail === "light" ? "light" : "dark");
    };
    window.addEventListener(SCHEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, onChange);
  }, []);
  return scheme;
}
