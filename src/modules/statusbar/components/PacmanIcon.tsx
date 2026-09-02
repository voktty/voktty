import type { SVGProps } from "react";

export function PacmanIcon({
  size = 14,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      {...props}
    >
      {/* Classic Pac-Man wedge with eye and pellet */}
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c2.85 0 5.43-1.19 7.27-3.11l-7.27-6.89 7.27-6.89C17.43 3.19 14.85 2 12 2z" />
      <circle cx="11.5" cy="6.5" r="1.5" fill="var(--background, #141619)" />
      <circle cx="20.5" cy="12" r="1.75" />
    </svg>
  );
}
