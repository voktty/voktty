import { useState } from "react";
import { useTranslation } from "@/modules/i18n";
import { X } from "./icons";
import { attachmentPreviewSrc } from "../lib/attachments";
import type { Attachment } from "../lib/session";
import { FileTypeIcon } from "./FileTypeIcon";
import { ImageLightbox } from "./ImageLightbox";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
};

export function AttachmentChip({ attachment, onRemove }: Props) {
  const { t } = useTranslation();
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = attachmentPreviewSrc(attachment);
  const image = attachment.kind === "image" && preview;

  return (
    <>
      <div
        className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
          image ? "" : "bg-content/10 py-0.5 pl-1 pr-1"
        }`}
        title={attachment.path ?? attachment.name}
      >
        {image ? (
          <button
            type="button"
            aria-label={t("lightbox.openFullScreen", { name: attachment.name })}
            title={t("lightbox.openFullScreen", { name: attachment.name })}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className="shrink-0 cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <img
              src={preview}
              alt=""
              draggable={false}
              className="size-9 rounded-lg object-cover"
            />
          </button>
        ) : (
          <>
            <span className="grid size-5 shrink-0 place-items-center">
              <FileTypeIcon name={attachment.name} isDir={false} size={16} />
            </span>
            <span className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-content/80">
              {attachment.name}
            </span>
          </>
        )}
        {onRemove ? (
          <button
            type="button"
            title={t("common.remove")}
            aria-label={t("harness.chrome.removeNamed", { name: attachment.name })}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className={`grid shrink-0 place-items-center rounded-full text-content/70 hover:bg-content/15 hover:text-content cursor-pointer ${
              image
                ? "absolute -right-1 -top-1 size-5 bg-content/20 opacity-100 shadow-sm backdrop-blur-sm"
                : "size-4 text-content/40"
            }`}
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {image && previewOpen ? (
        <ImageLightbox
          src={preview}
          alt={attachment.name}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}
