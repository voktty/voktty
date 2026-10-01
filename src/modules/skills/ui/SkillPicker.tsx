import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  isValidSkillName,
  slugSkillName,
  type Skill,
} from "../model/skills";

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

type Props = {
  skills: Skill[];
  query: string;
  active: number;
  creating: boolean;
  cwd: string;
  compact?: boolean;
  showCreate?: boolean;
  error?: string | null;
  busy?: boolean;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
};

export function SkillPicker({
  skills,
  query,
  active,
  creating,
  cwd,
  compact = false,
  showCreate = true,
  error,
  busy,
  onActive,
  onPick,
  onStartCreate,
  onCancelCreate,
  onCreate,
}: Props) {
  return (
    <div
      data-skill-picker
      className={
        compact
          ? "overflow-hidden"
          : "overflow-hidden rounded-lg border border-white/10 bg-neutral-900/95 shadow-2xl backdrop-blur-xl"
      }
    >
      {creating ? (
        <CreateSkillForm
          query={query}
          cwd={cwd}
          error={error}
          busy={busy}
          onCancel={onCancelCreate}
          onCreate={onCreate}
        />
      ) : (
        <>
          <SkillList
            skills={skills}
            query={query}
            active={active}
            compact={compact}
            onActive={onActive}
            onPick={onPick}
          />
          {showCreate ? (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onStartCreate}
              className="flex w-full items-center gap-2 border-t border-white/10 px-2.5 py-2 text-left text-[12px] text-neutral-300 hover:bg-white/10 hover:text-white transition-colors"
            >
              <PlusIcon className="size-3.5 shrink-0" />
              New skill
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function SkillList({
  skills,
  query,
  active,
  compact,
  onActive,
  onPick,
}: {
  skills: Skill[];
  query: string;
  active: number;
  compact?: boolean;
  onActive: (index: number) => void;
  onPick: (skill: Skill) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef({ x: Number.NaN, y: Number.NaN, allow: false });
  const fromPointer = useRef(false);

  useEffect(() => {
    pointer.current.allow = false;
  }, [skills]);

  useEffect(() => {
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    pointer.current.allow = false;
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onListMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) {
      return;
    }
    pointer.current = { x: e.clientX, y: e.clientY, allow: true };
  };

  const onRowEnter = (index: number) => {
    if (!pointer.current.allow) return;
    fromPointer.current = true;
    onActive(index);
  };

  if (skills.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[12px] text-neutral-400">
        {query.trim() ? "No matching commands or skills" : "No commands yet"}
      </p>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Commands and skills"
      onMouseMove={onListMouseMove}
      className={`${compact ? "max-h-48" : "max-h-[min(240px,40vh)]"} overflow-y-auto overscroll-none px-1 py-1`}
    >
      {skills.map((skill, index) => {
        const highlighted = index === active;
        return (
          <button
            key={`${skill.kind}:${skill.source}:${skill.invocation}`}
            ref={highlighted ? activeRef : undefined}
            type="button"
            role="option"
            aria-selected={highlighted}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onRowEnter(index)}
            onClick={() => onPick(skill)}
            className={`flex w-full rounded-md px-2 text-left ${
              compact ? "h-8 items-center" : "flex-col gap-0.5 py-1.5"
            } ${
              highlighted ? "bg-white/10 text-white" : "text-neutral-200 hover:bg-white/5"
            } transition-colors`}
          >
            <span className="flex min-w-0 w-full items-baseline gap-2">
              <span className="truncate text-[13px] font-medium">
                /{skill.invocation}
              </span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-neutral-400">
                {scopeLabel(skill)}
              </span>
            </span>
            {!compact && skill.description ? (
              <span className="line-clamp-2 text-[11px] leading-4 text-neutral-400">
                {skill.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Shared starter-skill form for the composer picker and Settings. */
export function CreateSkillForm({
  query,
  cwd,
  monospace = true,
  error,
  busy,
  onCancel,
  onCreate,
}: {
  query: string;
  cwd: string;
  monospace?: boolean;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onCreate: (name: string, scope: "project" | "user") => void;
}): ReactNode {
  const input = useRef<HTMLInputElement>(null);
  const project = Boolean(cwd);
  const [name, setName] = useState(() => slugSkillName(query));
  const [scope, setScope] = useState<"project" | "user">(
    project ? "project" : "user",
  );

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const slug = slugSkillName(name);
  const valid = isValidSkillName(slug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    onCreate(slug, project ? scope : "user");
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onCancel();
      }}
      className="px-2.5 py-2"
    >
      <p className="mb-2 text-[11px] text-neutral-400">
        Writes a starter SKILL.md you can edit.
      </p>
      <input
        ref={input}
        value={name}
        spellCheck={false}
        placeholder="skill-name"
        aria-label="Skill name"
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        className={`mb-2 w-full rounded-md bg-white/10 px-2 py-1.5 text-[13px] text-white outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-purple-500 ${monospace ? "font-mono" : "font-sans"}`}
      />
      <div className="mb-2 flex gap-1">
        <ScopeButton
          label="Project"
          hint=".agents/skills"
          monospace={monospace}
          selected={scope === "project"}
          disabled={!project || busy}
          onClick={() => setScope("project")}
        />
        <ScopeButton
          label="Personal"
          hint="~/.agents/skills"
          monospace={monospace}
          selected={scope === "user"}
          disabled={busy}
          onClick={() => setScope("user")}
        />
      </div>
      {error ? (
        <p className="mb-2 text-[12px] text-red-400">{error}</p>
      ) : !name.trim() || valid ? null : (
        <p className="mb-2 text-[12px] text-neutral-400">
          Use lowercase letters, numbers, and hyphens.
        </p>
      )}
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] text-neutral-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!valid || busy}
          className="rounded-md bg-purple-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-purple-500 disabled:opacity-40 transition-colors"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function ScopeButton({
  label,
  hint,
  monospace,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  monospace: boolean;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left border ${
        selected
          ? "border-purple-500/50 bg-purple-500/20 text-white"
          : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
      } disabled:opacity-40 transition-colors`}
    >
      <span className="text-[12px] font-medium">{label}</span>
      <span
        className={`truncate text-[10px] text-neutral-400 ${monospace ? "font-mono" : "font-sans"}`}
      >
        {hint}
      </span>
    </button>
  );
}

function scopeLabel(skill: Skill): string {
  if (skill.kind === "native") {
    return skill.source || "native";
  }
  if (skill.kind === "builtin") return "voktty";
  if (skill.scope === "user") return "personal";
  if (skill.source !== "agents" && skill.source !== "voktty") return skill.source;
  return "project";
}
