import type { FileAttachment } from "@/modules/ai/lib/composer";

export const MAX_TEXT_INLINE = 200_000;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_BATCH_FILES = 32;
const MAX_PENDING_READS = 16;
let pendingReads = 0;

export async function readBrowserAttachments(
  list: FileList,
  isCurrent: () => boolean,
  publish: (files: FileAttachment[]) => void,
): Promise<void> {
  if (
    !isCurrent() ||
    pendingReads >= MAX_PENDING_READS ||
    list.length > MAX_BATCH_FILES
  )
    return;
  const files = Array.from(list);
  let bytes = 0;
  for (const file of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) return;
    bytes += file.size;
    if (bytes > MAX_BATCH_BYTES) return;
  }
  pendingReads++;
  try {
    const next: FileAttachment[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      if (!isCurrent()) return;
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const image = file.type.startsWith("image/");
      if (file.size > (image ? MAX_IMAGE_BYTES : MAX_TEXT_INLINE)) continue;
      const content = image ? await readAsDataURL(file) : await file.text();
      if (!isCurrent()) return;
      if (
        content.length >
        (image ? Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024 : MAX_TEXT_INLINE)
      )
        continue;
      next.push({
        id,
        name: file.name,
        kind: image ? "image" : "text",
        mediaType: file.type || "text/plain",
        ...(image ? { url: content } : { text: content }),
        size: file.size,
      });
    }
    if (next.length && isCurrent()) publish(next);
  } catch {
    // FileReader and Blob errors must not expose file contents or paths.
  } finally {
    pendingReads--;
  }
}

function readAsDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error("Attachment read aborted"));
    reader.readAsDataURL(file);
  });
}
