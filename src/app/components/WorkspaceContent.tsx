import type { ReactNode } from "react";

export function WorkspaceContent({
  overlay,
  children,
}: {
  overlay: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <div className="h-full min-h-0" hidden={overlay != null}>
        {children}
      </div>
      {overlay != null && <div className="absolute inset-0">{overlay}</div>}
    </>
  );
}
