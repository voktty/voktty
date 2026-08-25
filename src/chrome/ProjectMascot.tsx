import { MASCOT_GRID, projectMascot } from "../lib/projectMascots";

type Props = {
  project: string;
  color: string;
  className?: string;
  /** Cycles the mascot's two frames while a turn is in flight. */
  active?: boolean;
};

/** Pixel mascot standing in for the project's color dot. */
export function ProjectMascot({
  project,
  color,
  className = "size-3 shrink-0",
  active = false,
}: Props) {
  const mascot = projectMascot(project);
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      shapeRendering="crispEdges"
      className={`${className} ${active ? "mascot-active" : ""}`}
      style={{ fill: color }}
    >
      {active ? (
        <>
          <path className="mascot-rest" d={mascot.restPath} />
          <path className="mascot-talk" d={mascot.talkPath} />
        </>
      ) : (
        <path d={mascot.restPath} />
      )}
    </svg>
  );
}
