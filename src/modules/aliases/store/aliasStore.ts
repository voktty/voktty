import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { AliasDefinition, AliasesStateDto, ResolvedAlias } from "../types";

export type AliasFilter = "all" | "factory" | "custom" | "enabled" | "disabled";

interface AliasStoreState {
  effective: ResolvedAlias[];
  configPath: string;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filter: AliasFilter;

  // Actions
  fetchAliases: () => Promise<void>;
  toggleAlias: (name: string, enabled: boolean) => Promise<void>;
  saveAlias: (name: string, definition: AliasDefinition) => Promise<void>;
  deleteAlias: (name: string) => Promise<void>;
  resetAlias: (name: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  setFilter: (filter: AliasFilter) => void;
}

export const useAliasStore = create<AliasStoreState>((set, get) => ({
  effective: [],
  configPath: "",
  isLoading: false,
  error: null,
  searchQuery: "",
  filter: "all",

  fetchAliases: async () => {
    set({ isLoading: true, error: null });
    try {
      const state = await invoke<AliasesStateDto>("aliases_get_state");
      set({
        effective: state.effective,
        configPath: state.configPath,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },

  toggleAlias: async (name: string, enabled: boolean) => {
    // Optimistic local update
    const previous = get().effective;
    set({
      effective: previous.map((alias) =>
        alias.name === name
          ? {
              ...alias,
              definition: { ...alias.definition, enabled },
            }
          : alias,
      ),
    });

    try {
      const updated = await invoke<AliasesStateDto>("aliases_toggle_alias", {
        name,
        enabled,
      });
      set({
        effective: updated.effective,
        configPath: updated.configPath,
      });
    } catch (err) {
      set({
        effective: previous,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  saveAlias: async (name: string, definition: AliasDefinition) => {
    set({ isLoading: true, error: null });
    try {
      const state = await invoke<AliasesStateDto>("aliases_get_state");
      const userFile = { ...state.user };
      userFile.aliases = { ...userFile.aliases, [name]: definition };

      const updated = await invoke<AliasesStateDto>("aliases_save_user", {
        user: userFile,
      });
      set({
        effective: updated.effective,
        configPath: updated.configPath,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
      throw err;
    }
  },

  deleteAlias: async (name: string) => {
    set({ isLoading: true, error: null });
    try {
      const state = await invoke<AliasesStateDto>("aliases_get_state");
      const userFile = { ...state.user };
      delete userFile.aliases[name];

      const updated = await invoke<AliasesStateDto>("aliases_save_user", {
        user: userFile,
      });
      set({
        effective: updated.effective,
        configPath: updated.configPath,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
      throw err;
    }
  },

  resetAlias: async (name: string) => {
    set({ isLoading: true, error: null });
    try {
      const updated = await invoke<AliasesStateDto>("aliases_reset_alias", {
        name,
      });
      set({
        effective: updated.effective,
        configPath: updated.configPath,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        isLoading: false,
      });
    }
  },

  setSearchQuery: (searchQuery: string) => set({ searchQuery }),
  setFilter: (filter: AliasFilter) => set({ filter }),
}));
