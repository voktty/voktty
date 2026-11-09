import { create } from "zustand";

export interface CompanionPairingRequestedPayload {
  id: string;
  deviceName: string;
  fingerprint: string;
  expiresAtMs: number;
}

interface CompanionPairingState {
  pendingRequest: CompanionPairingRequestedPayload | null;
  setPendingRequest: (req: CompanionPairingRequestedPayload | null) => void;
  clearPendingRequest: () => void;
}

export const useCompanionPairingStore = create<CompanionPairingState>((set) => ({
  pendingRequest: null,
  setPendingRequest: (pendingRequest) => set({ pendingRequest }),
  clearPendingRequest: () => set({ pendingRequest: null }),
}));
