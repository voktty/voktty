import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import type { HarnessId } from "@/modules/harness/lib/session";
import {
  hasNativeCommands,
  loadSkills,
  rankSkills,
  replaceSlashToken,
  skillTextParts,
  slashTokenAt,
  type Skill,
  type SlashToken,
} from "../model/skills";
import { SkillPicker } from "./SkillPicker";

type Props = {
  value: string;
  harness: HarnessId;
  cwd: string;
  onChange: (value: string) => void;
};

export function SkillPromptField({ value, harness, cwd, onChange }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const slashAnchorRef = useRef<HTMLSpanElement>(null);
  const slashRef = useRef<SlashToken | null>(null);
  const [slash, setSlash] = useState<SlashToken | null>(null);
  const [active, setActive] = useState(0);
  const [skills, setSkills] = useState<Skill[]>([]);
  slashRef.current = slash;

  useEffect(() => {
    let cancelled = false;
    loadSkills({ harness, cwd })
      .then((items) => {
        if (!cancelled) setSkills(items);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [harness, cwd]);

  const rankedSkills = useMemo(
    () =>
      rankSkills(
        skills,
        slash?.query ?? "",
        hasNativeCommands(harness) ? Number.POSITIVE_INFINITY : undefined,
      ),
    [harness, skills, slash?.query],
  );

  const skillNames = useMemo(
    () => new Set(skills.map((skill) => skill.invocation)),
    [skills],
  );

  useEffect(() => {
    setActive(0);
  }, [cwd, harness, slash?.query]);

  useEffect(() => {
    setActive((index) =>
      rankedSkills.length === 0 ? 0 : Math.min(index, rankedSkills.length - 1),
    );
  }, [rankedSkills.length]);

  const syncSlashToken = useCallback(
    (field: HTMLTextAreaElement) => {
      const cursor = field.selectionStart ?? 0;
      setSlash(slashTokenAt(field.value, cursor, hasNativeCommands(harness)));
    },
    [harness],
  );

  const pickSkill = useCallback(
    (skill: Skill) => {
      const field = fieldRef.current;
      const token = slashRef.current;
      if (!field || !token) {
        setSlash(null);
        return;
      }

      const next = replaceSlashToken(field.value, token, skill.invocation);
      field.value = next;
      let cursor = token.start + skill.invocation.length + 1;
      if (next[cursor] === " ") cursor += 1;
      field.setSelectionRange(cursor, cursor);
      onChange(next);
      setSlash(null);
      field.focus();
    },
    [onChange],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slash) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rankedSkills.length > 0) {
        setActive((index) => (index + 1) % rankedSkills.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rankedSkills.length > 0) {
        setActive(
          (index) => (index - 1 + rankedSkills.length) % rankedSkills.length,
        );
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlash(null);
      return;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      const skill = rankedSkills[active];
      if (!skill) return;
      event.preventDefault();
      pickSkill(skill);
    }
  };

  return (
    <div className="relative">
      {slash ? (
        <div
          data-skill-suggestions
          className="absolute z-50 bottom-full mb-1 left-0 w-80 shadow-2xl"
        >
          <SkillPicker
            skills={rankedSkills}
            query={slash.query}
            active={active}
            creating={false}
            cwd={cwd}
            compact
            showCreate={false}
            onActive={setActive}
            onPick={pickSkill}
            onStartCreate={() => undefined}
            onCancelCreate={() => undefined}
            onCreate={() => undefined}
          />
        </div>
      ) : null}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 min-h-28 overflow-hidden whitespace-pre-wrap break-words px-3 py-3 font-sans text-sm leading-5.5 text-neutral-200"
      >
        <SkillPromptHighlight
          text={value}
          names={skillNames}
          slash={slash}
          anchorRef={slashAnchorRef}
        />
      </div>
      <textarea
        ref={fieldRef}
        rows={3}
        spellCheck={false}
        aria-label="Instructions"
        aria-haspopup="listbox"
        aria-expanded={slash !== null}
        value={value}
        onBlur={() => {
          // slight delay so mouse click in picker can register
          setTimeout(() => setSlash(null), 150);
        }}
        onChange={(event) => {
          const field = event.currentTarget;
          onChange(field.value);
          syncSlashToken(field);
        }}
        onClick={(event) => syncSlashToken(event.currentTarget)}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.key !== "Escape") syncSlashToken(event.currentTarget);
        }}
        onSelect={(event) => syncSlashToken(event.currentTarget)}
        placeholder="Tell the agent what to do when this automation runs…"
        className="relative min-h-28 w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-white/5 px-3 py-3 font-sans text-sm leading-5.5 text-white outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 placeholder:text-neutral-500"
      />
    </div>
  );
}

function SkillPromptHighlight({
  text,
  names,
  slash,
  anchorRef,
}: {
  text: string;
  names: ReadonlySet<string>;
  slash: SlashToken | null;
  anchorRef: Ref<HTMLSpanElement>;
}) {
  const parts = skillTextParts(text, names);
  let offset = 0;

  return (
    <>
      {parts.map((part, index) => {
        const start = offset;
        const end = start + part.text.length;
        offset = end;
        const anchorAt = slash?.start;
        const anchorInside =
          anchorAt !== undefined && anchorAt >= start && anchorAt < end;
        const localAnchor = anchorInside ? anchorAt - start : -1;
        const content = anchorInside ? (
          <>
            {part.text.slice(0, localAnchor)}
            <span ref={anchorRef} data-skill-anchor className="inline-block">
              {part.text[localAnchor]}
            </span>
            {part.text.slice(localAnchor + 1)}
          </>
        ) : (
          part.text
        );

        return part.skill ? (
          <span key={index} className="text-purple-400 font-medium">
            {content}
          </span>
        ) : (
          <span key={index}>{content}</span>
        );
      })}
      {text.endsWith("\n") ? "\n" : null}
    </>
  );
}
