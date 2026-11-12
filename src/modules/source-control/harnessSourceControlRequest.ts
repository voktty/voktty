type Subscription = {
  live: boolean;
  receive: (projectPath: string, isCurrent: () => boolean) => void;
};

const subscriptions = new Set<Subscription>();

export function subscribeHarnessSourceControl(
  receive: Subscription["receive"],
): () => void {
  if (subscriptions.size >= 256)
    throw new Error("Source Control subscription capacity exceeded.");
  const subscription = { live: true, receive };
  subscriptions.add(subscription);
  return () => {
    subscription.live = false;
    subscriptions.delete(subscription);
  };
}

export function requestHarnessSourceControl(
  projectPath: string,
  isCurrent: () => boolean = () => true,
): boolean {
  if (
    !projectPath.trim() ||
    projectPath === "~" ||
    projectPath.length > 32768 ||
    /[\x00-\x1f\x7f]/.test(projectPath)
  )
    return false;
  let delivered = false;
  for (const subscription of [...subscriptions]) {
    const current = () => subscription.live && isCurrent();
    if (!current()) continue;
    delivered = true;
    subscription.receive(projectPath, current);
    if (!isCurrent()) break;
  }
  return delivered;
}
