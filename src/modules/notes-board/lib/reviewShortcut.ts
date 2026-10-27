type ReviewShortcut = Pick<
  KeyboardEvent,
  | "key"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "isComposing"
  | "defaultPrevented"
>;

export function isReviewShortcut(event: ReviewShortcut): boolean {
  return (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented &&
    event.key.toLowerCase() === "d"
  );
}
