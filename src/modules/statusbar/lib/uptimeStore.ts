import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DailyMetrics = {
  seconds: number;
  paths: Record<string, number>;
};

export type DayStat = {
  date: string;
  dayLabel: string;
  shortDate: string;
  seconds: number;
  hoursFormatted: string;
  percentage: number;
  isToday: boolean;
};

export type PathStat = {
  path: string;
  name: string;
  seconds: number;
  hoursFormatted: string;
  percentage: number;
};

export type UptimeColorLevel = "emerald" | "cyan" | "amber" | "orange" | "rose";

export type UptimeState = {
  sessionStart: number;
  history: Record<string, DailyMetrics>;
  tick: (cwd?: string | null, deltaSeconds?: number) => void;
  resetSession: () => void;
};

function getTodayKey(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const useUptimeStore = create<UptimeState>()(
  persist(
    (set, get) => ({
      sessionStart: Date.now(),
      history: {},
      tick: (cwd = null, deltaSeconds = 10) => {
        const todayKey = getTodayKey();
        const state = get();
        const currentToday = state.history[todayKey] || {
          seconds: 0,
          paths: {},
        };

        const updatedSeconds = currentToday.seconds + deltaSeconds;
        const updatedPaths = { ...currentToday.paths };

        if (cwd && typeof cwd === "string" && cwd.trim().length > 0) {
          const normCwd = cwd.trim().replace(/\\/g, "/");
          updatedPaths[normCwd] = (updatedPaths[normCwd] || 0) + deltaSeconds;
        }

        // Clean up history older than 30 days to avoid bloat
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const cutoffKey = cutoffDate.toISOString().slice(0, 10);

        const newHistory: Record<string, DailyMetrics> = {};
        for (const [k, v] of Object.entries(state.history)) {
          if (k >= cutoffKey) {
            newHistory[k] = v;
          }
        }
        newHistory[todayKey] = {
          seconds: updatedSeconds,
          paths: updatedPaths,
        };

        set({ history: newHistory });
      },
      resetSession: () => set({ sessionStart: Date.now() }),
    }),
    {
      name: "voktty-console-uptime-stats",
      partialize: (state) => ({ history: state.history }),
    },
  ),
);

export function getSessionHours(sessionStart: number): number {
  const elapsedMs = Math.max(0, Date.now() - sessionStart);
  return Math.floor(elapsedMs / (1000 * 60 * 60));
}

export function getSessionDurationFormatted(sessionStart: number): string {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - sessionStart) / 1000));
  const hrs = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  if (hrs === 0) {
    return `${Math.max(1, mins)}m`;
  }
  return `${hrs}h ${mins}m`;
}

export function getUptimeColorLevel(hours: number): {
  level: UptimeColorLevel;
  badgeClass: string;
  dotClass: string;
} {
  if (hours < 2) {
    return {
      level: "emerald",
      badgeClass:
        "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20",
      dotClass: "bg-emerald-500",
    };
  }
  if (hours < 5) {
    return {
      level: "cyan",
      badgeClass:
        "text-cyan-600 dark:text-cyan-400 bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20",
      dotClass: "bg-cyan-500",
    };
  }
  if (hours < 8) {
    return {
      level: "amber",
      badgeClass:
        "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20",
      dotClass: "bg-amber-500",
    };
  }
  if (hours < 11) {
    return {
      level: "orange",
      badgeClass:
        "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20",
      dotClass: "bg-orange-500",
    };
  }
  return {
    level: "rose",
    badgeClass:
      "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20 animate-pulse",
    dotClass: "bg-rose-500",
  };
}

export function formatHoursDecimal(seconds: number): string {
  const h = seconds / 3600;
  if (h < 0.1) return "<0.1h";
  return `${h.toFixed(1)}h`;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function getWeeklyBreakdown(
  history: Record<string, DailyMetrics>,
): {
  days: DayStat[];
  totalWeekSeconds: number;
  dailyAvgSeconds: number;
  todaySeconds: number;
} {
  const days: DayStat[] = [];
  const today = new Date();
  const todayKey = getTodayKey();

  let totalWeekSeconds = 0;
  let maxSecondsInWeek = 3600; // at least 1h scale baseline

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const key = `${yyyy}-${mm}-${dd}`;

    const metrics = history[key] || { seconds: 0, paths: {} };
    totalWeekSeconds += metrics.seconds;
    if (metrics.seconds > maxSecondsInWeek) {
      maxSecondsInWeek = metrics.seconds;
    }

    days.push({
      date: key,
      dayLabel: DAY_NAMES[d.getDay()],
      shortDate: `${d.getDate()}/${d.getMonth() + 1}`,
      seconds: metrics.seconds,
      hoursFormatted: formatHoursDecimal(metrics.seconds),
      percentage: 0, // computed below
      isToday: key === todayKey,
    });
  }

  for (const day of days) {
    day.percentage = Math.min(
      100,
      Math.max(day.seconds > 0 ? 8 : 2, Math.round((day.seconds / maxSecondsInWeek) * 100)),
    );
  }

  const todayMetrics = history[todayKey] || { seconds: 0, paths: {} };
  const dailyAvgSeconds = Math.round(totalWeekSeconds / 7);

  return {
    days,
    totalWeekSeconds,
    dailyAvgSeconds,
    todaySeconds: todayMetrics.seconds,
  };
}

export function getTopActivePaths(
  history: Record<string, DailyMetrics>,
  limit = 4,
): PathStat[] {
  const aggregated: Record<string, number> = {};
  let totalPathSeconds = 0;

  // Aggregate last 7 days
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const metrics = history[key];
    if (metrics && metrics.paths) {
      for (const [path, secs] of Object.entries(metrics.paths)) {
        aggregated[path] = (aggregated[path] || 0) + secs;
        totalPathSeconds += secs;
      }
    }
  }

  const entries = Object.entries(aggregated).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0 || totalPathSeconds === 0) return [];

  return entries.slice(0, limit).map(([path, seconds]) => {
    const segments = path.split("/").filter(Boolean);
    const name = segments[segments.length - 1] || path;
    const percentage = Math.min(100, Math.max(5, Math.round((seconds / totalPathSeconds) * 100)));
    return {
      path,
      name,
      seconds,
      hoursFormatted: formatHoursDecimal(seconds),
      percentage,
    };
  });
}
