import { useEffect, useState } from "react";
import type { InboxItem } from "./githubTasks";

type Listener = () => void;

let selected: InboxItem | null = null;
const listeners = new Set<Listener>();

export function setInboxSelection(item: InboxItem | null) {
  selected = item;
  for (const listener of listeners) listener();
}

export function peekInboxSelection(): InboxItem | null {
  return selected;
}

export function useInboxSelection(): InboxItem | null {
  const [item, setItem] = useState<InboxItem | null>(selected);
  useEffect(() => {
    const onChange = () => setItem(selected);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return item;
}
