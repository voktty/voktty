import {
  AiBrowserIcon,
  ChatGptIcon,
  ClaudeIcon,
  DeepseekIcon,
  CodeIcon,
  GoogleGeminiIcon,
  Grok02Icon,
  GravityIcon,
  KimiAiIcon,
  MistralIcon,
  PerplexityAiIcon,
  QwenIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

// Pi mark, from github.com/earendil-works pi-website logo.svg (MIT).
function PiIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 800 800"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path fill="currentColor" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

export type AgentIconKind =
  | "claude"
  | "gemini"
  | "opencode"
  | "grok"
  | "codex"
  | "antigravity"
  | "kimi"
  | "deepseek"
  | "qwen"
  | "mistral"
  | "perplexity"
  | "generic";

export function agentIconKind(agent: string): AgentIconKind {
  const a = agent.toLowerCase();
  if (a.includes("claude")) return "claude";
  if (a.includes("gemini")) return "gemini";
  if (a.includes("opencode")) return "opencode";
  if (a.includes("grok")) return "grok";
  if (a.includes("antigravity")) return "antigravity";
  if (a.includes("kimi")) return "kimi";
  if (a.includes("deepseek")) return "deepseek";
  if (a.includes("qwen")) return "qwen";
  if (a.includes("mistral")) return "mistral";
  if (a.includes("perplexity")) return "perplexity";
  if (a.includes("codex") || a.includes("gpt") || a.includes("openai"))
    return "codex";
  return "generic";
}

function iconFor(agent: string): IconSvgElement {
  switch (agentIconKind(agent)) {
    case "claude":
      return ClaudeIcon;
    case "gemini":
      return GoogleGeminiIcon;
    case "opencode":
      return CodeIcon;
    case "grok":
      return Grok02Icon;
    case "antigravity":
      return GravityIcon;
    case "kimi":
      return KimiAiIcon;
    case "deepseek":
      return DeepseekIcon;
    case "qwen":
      return QwenIcon;
    case "mistral":
      return MistralIcon;
    case "perplexity":
      return PerplexityAiIcon;
    case "codex":
      return ChatGptIcon;
    default:
      return AiBrowserIcon;
  }
}

export function AgentIcon({
  agent,
  size = 15,
  className,
}: {
  agent: string;
  size?: number;
  className?: string;
}) {
  if (agent.toLowerCase() === "pi") {
    return <PiIcon size={size} className={className} />;
  }
  if (agent.toLowerCase().includes("voktty")) {
    return (
      <img
        src="/voktty.svg"
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={iconFor(agent)}
      size={size}
      strokeWidth={1.75}
      className={className}
    />
  );
}
