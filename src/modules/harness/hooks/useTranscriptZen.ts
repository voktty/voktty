import { useEffect, useState } from "react";
import {
  loadTranscriptZen,
  TRANSCRIPT_ZEN_CHANGE_EVENT,
} from "../lib/appearance";

/** Subscribes to zen mode changes triggered by saveTranscriptZen(). */
export function useTranscriptZen(): boolean {
  const [zen, setZen] = useState<boolean>(loadTranscriptZen);
  useEffect(() => {
    const onChange = (event: Event) => {
      setZen((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onChange);
    return () =>
      window.removeEventListener(TRANSCRIPT_ZEN_CHANGE_EVENT, onChange);
  }, []);
  return zen;
}
