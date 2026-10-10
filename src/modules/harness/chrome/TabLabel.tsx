import { useLayoutEffect, useRef, useState } from "react";

/** Fade the edge only when a tab label is clipped. */
export function TabLabel({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const label = ref.current;
    if (!label) return;
    const measure = () => {
      setOverflow(
        label.clientWidth > 0 && label.scrollWidth > label.clientWidth,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(label);
    return () => observer.disconnect();
  }, [children]);

  return (
    <span
      ref={ref}
      data-overflow={overflow || undefined}
      className={`tab-label min-w-0 truncate ${className}`}
    >
      {children}
    </span>
  );
}
