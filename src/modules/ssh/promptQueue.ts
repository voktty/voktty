type PromptRequest = {
  id: string;
  message: string;
  confirm: boolean;
  respond: (answer: string | null) => void;
};

let requests: PromptRequest[] = [];
const listeners = new Set<() => void>();

export function currentSshPrompts(): PromptRequest[] {
  return requests;
}

export function subscribeSshPrompts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestSshPrompt(message: string, confirm: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timeout = globalThis.setTimeout(() => respond(null), 120_000);
    const respond = (answer: string | null) => {
      globalThis.clearTimeout(timeout);
      requests = requests.filter((request) => request.id !== id);
      for (const listener of listeners) listener();
      resolve(answer);
    };
    requests = [...requests, { id, message, confirm, respond }];
    for (const listener of listeners) listener();
  });
}
