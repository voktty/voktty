import type React from "react";

type ContextMeterProps = {
  used?: number;
  window?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

export const ContextMeter: React.FC<ContextMeterProps> = ({
  used = 0,
  window: maxWindow = 200_000,
  size = 28,
  strokeWidth = 3,
  className = "",
}) => {
  const ratio = Math.min(1, Math.max(0, used / (maxWindow || 1)));
  const percentage = Math.round(ratio * 100);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ratio * circumference;

  let strokeColor = "var(--voktty-accent, #3b82f6)";
  if (ratio > 0.85) {
    strokeColor = "#ef4444"; // Danger Red
  } else if (ratio > 0.7) {
    strokeColor = "#f59e0b"; // Warning Yellow
  }

  const formatNumber = (num: number) => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(0)}k`;
    }
    return String(num);
  };

  const tooltipText = `Context: ${formatNumber(used)} / ${formatNumber(maxWindow)} tokens (${percentage}%)`;

  return (
    <div
      className={`inline-flex items-center gap-1.5 cursor-help select-none ${className}`}
      title={tooltipText}
    >
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="transparent"
            className="text-white/10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-300 ease-out"
          />
        </svg>
      </div>
      <span className="text-[11px] font-mono text-white/60 font-medium">
        {percentage}%
      </span>
    </div>
  );
};
