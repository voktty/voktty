import { createContext, useContext, useRef, type ReactNode } from "react";
import type { UseBoundStore, StoreApi } from "zustand";
import {
  createApiClientStore,
  getLegacyApiClientPresentationState,
  LEGACY_API_CLIENT_STORAGE_KEY,
  type ApiClientStore,
} from "./apiClientStore";

type ApiClientBoundStore = UseBoundStore<StoreApi<ApiClientStore>>;

const ApiClientStoreContext = createContext<ApiClientBoundStore | null>(null);

function getLegacyPresentationState() {
  if (typeof window === "undefined") return {};

  try {
    return getLegacyApiClientPresentationState(
      window.localStorage.getItem(LEGACY_API_CLIENT_STORAGE_KEY),
    );
  } catch {
    return {};
  }
}

export function ApiClientStoreProvider({
  tabId,
  children,
}: {
  tabId: number;
  children: ReactNode;
}) {
  const storeRef = useRef<ApiClientBoundStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createApiClientStore(
      `${LEGACY_API_CLIENT_STORAGE_KEY}:${tabId}`,
      getLegacyPresentationState(),
    );
  }
  return (
    <ApiClientStoreContext.Provider value={storeRef.current}>
      {children}
    </ApiClientStoreContext.Provider>
  );
}

export function useApiClientTabStore(): ApiClientStore {
  const store = useContext(ApiClientStoreContext);
  if (!store) throw new Error("ApiClientStoreProvider is required");
  return store();
}
