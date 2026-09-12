import { useEffect, useState } from "react";
import { FILE_ICON_CATALOG_READY_EVENT } from "./iconResolver";

/** Re-renders visible explorer rows once the deferred icon catalog is ready. */
export function useIconCatalogVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const refresh = () => setVersion((current) => current + 1);
    window.addEventListener(FILE_ICON_CATALOG_READY_EVENT, refresh);
    return () => window.removeEventListener(FILE_ICON_CATALOG_READY_EVENT, refresh);
  }, []);

  return version;
}
