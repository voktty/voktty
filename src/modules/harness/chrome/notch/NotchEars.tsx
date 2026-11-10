import type { SVGProps } from "react";

interface NotchEarProps extends SVGProps<SVGSVGElement> {
  side: "left" | "right";
}

/**
 * Curved inverted fillets (ears) connecting the top of the Notch
 * to the top frame of the window, inspired by ReUI's notch geometry.
 */
export function NotchEar({ side, className = "", ...props }: NotchEarProps) {
  // 14px wide, 12px high ear curve
  return (
    <svg
      width="14"
      height="12"
      viewBox="0 0 14 12"
      fill="currentColor"
      aria-hidden="true"
      className={`shrink-0 pointer-events-none ${side === "right" ? "-scale-x-100 -ml-px" : "-mr-px"} ${className}`}
      {...props}
    >
      <path d="M0,0 Q0,12 14,12 L14,0 Z" />
    </svg>
  );
}
