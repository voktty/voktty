export type MediaKind = "image" | "video" | "audio" | "pdf";

export function getMediaMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "ico":
      return "image/x-icon";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "tiff":
    case "tif":
      return "image/tiff";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "m4a":
      return "audio/mp4";
    case "pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

export function classifyMediaExtension(ext: string): MediaKind | null {
  const normalized = ext.toLowerCase();
  if (
    [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "ico",
      "bmp",
      "avif",
      "tiff",
      "tif",
    ].includes(normalized)
  ) {
    return "image";
  }
  if (["mp4", "webm", "ogg", "mov"].includes(normalized)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a"].includes(normalized)) {
    return "audio";
  }
  if (normalized === "pdf") return "pdf";
  return null;
}
