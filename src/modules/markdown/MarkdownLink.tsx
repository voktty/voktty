import { isExternalUrl, openExternalUrl } from "@/lib/external-link";
import type { ComponentProps, MouseEventHandler } from "react";
import { useMarkdownDoc } from "./lib/docContext";
import { resolveRelativeDocPath } from "./lib/pathUtils";

export type MarkdownLinkProps = ComponentProps<"a"> & {
  node?: unknown;
  onSettled?: () => void;
};

export function MarkdownLink({
  children,
  href,
  node: _node,
  onClick,
  onSettled,
  ...props
}: MarkdownLinkProps) {
  const { docPath } = useMarkdownDoc();

  const handleClick: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href) return;

    if (isExternalUrl(href)) {
      event.preventDefault();
      void openExternalUrl(href, onSettled);
      return;
    }

    if (href.startsWith("#")) {
      event.preventDefault();
      const targetId = href.slice(1);
      const element = document.getElementById(targetId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
      onSettled?.();
      return;
    }

    // Local relative file or directory link
    if (docPath) {
      event.preventDefault();
      const resolved = resolveRelativeDocPath(docPath, href);
      window.dispatchEvent(
        new CustomEvent("voktty:open-dropped-path", { detail: resolved }),
      );
      onSettled?.();
    }
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}
