import { createContext, useContext, useRef, type ReactNode } from "react";
import type { UseBoundStore, StoreApi } from "zustand";
import { createApiClientStore, type ApiClientStore } from "./apiClientStore";

type ApiClientBoundStore = UseBoundStore<StoreApi<ApiClientStore>>;

const ApiClientStoreContext = createContext<ApiClientBoundStore | null>(null);

export function ApiClientStoreProvider({
  tabId,
  children,
}: {
  tabId: number;
  children: ReactNode;
}) {
  const storeRef = useRef<ApiClientBoundStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createApiClientStore(`voktty-api-client-storage:${tabId}`);
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
