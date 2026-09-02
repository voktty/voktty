import { useEffect, useState } from "react";
import {
  LAYOUT_CHANGE_EVENT,
  loadSidebarLayout,
  type SidebarLayout,
} from "../lib/appearance";

/** Subscribes to sidebar layout changes triggered by saveSidebarLayout(). */
export function useSidebarLayout(): SidebarLayout {
  const [layout, setLayout] = useState<SidebarLayout>(loadSidebarLayout);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<SidebarLayout>).detail;
      setLayout(detail === "deck" ? "deck" : "classic");
    };
    window.addEventListener(LAYOUT_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LAYOUT_CHANGE_EVENT, onChange);
  }, []);
  return layout;
}
