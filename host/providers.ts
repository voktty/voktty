import * as codex from "@/modules/harness/lib/harness/codex";
import * as claude from "@/modules/harness/lib/harness/claude";
import * as cursor from "@/modules/harness/lib/harness/cursor";
import * as grok from "@/modules/harness/lib/harness/grok";
import * as opencode from "@/modules/harness/lib/harness/opencode";
import * as pi from "@/modules/harness/lib/harness/pi";
import * as omp from "@/modules/harness/lib/harness/omp";
import * as fx from "@/modules/harness/lib/harness/fx";
import * as hermes from "@/modules/harness/lib/harness/hermes";
import * as agy from "@/modules/harness/lib/harness/agy";
import type {
  SendTurnInput,
  CompactContextInput,
  ApprovalDecision,
} from "@/modules/harness/lib/harness/types";
import type { UserQuestionReply } from "@/modules/harness/lib/userQuestion";
import type { RemoteProvider } from "@/modules/connections/model/protocol";
import type { GeneratedSessionTitle } from "@/modules/harness/lib/sessionTitle";
import { generateCodexSessionTitle } from "@/modules/harness/lib/harness/codexTitle";
import { generateClaudeSessionTitle } from "@/modules/harness/lib/harness/claudeTitle";
import { generateCodexBranchName } from "@/modules/harness/lib/harness/codexGit";
import { generateClaudeBranchName } from "@/modules/harness/lib/harness/claudeGit";
import { generateCursorSessionTitle } from "@/modules/harness/lib/harness/cursorTitle";
import { generateGrokSessionTitle } from "@/modules/harness/lib/harness/grokTitle";
import { generateOpenCodeSessionTitle } from "@/modules/harness/lib/harness/opencodeTitle";
import {
  generatePiSessionTitle,
  generateOmpSessionTitle,
} from "@/modules/harness/lib/harness/piTitle";
import { PI_FLAVOR, OMP_FLAVOR } from "@/modules/harness/lib/harness/piFlavor";
import { respondQuestion as respondPiQuestion } from "@/modules/harness/lib/harness/piFamily";

export interface HostProvider {
  send(input: SendTurnInput): Promise<void>;
  compact?(input: CompactContextInput): Promise<void>;
  cancel(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  bind(id: string, providerId: string, cwd: string): void;
  approve(id: string, request: number, decision: ApprovalDecision): void;
  answer(id: string, request: number, reply: UserQuestionReply): void;
  generateTitle?(input: {
    sessionId: string;
    cwd: string;
    message: string;
  }): Promise<GeneratedSessionTitle | null>;
  generateBranchName?(cwd: string, message: string): Promise<string | null>;
}

export const hostProviders: Record<RemoteProvider, HostProvider> = {
  codex: {
    send: codex.sendCodexTurn,
    compact: codex.compactCodexContext,
    cancel: codex.cancelCodexTurn,
    stop: codex.forgetCodexSession,
    bind: codex.bindCodexSession,
    approve: codex.respondCodexApproval,
    answer: codex.respondCodexQuestion,
    generateTitle: generateCodexSessionTitle,
    generateBranchName: generateCodexBranchName,
  },
  claude: {
    send: claude.sendClaudeTurn,
    compact: claude.compactClaudeContext,
    cancel: claude.cancelClaudeTurn,
    stop: claude.forgetClaudeSession,
    bind: claude.bindClaudeSession,
    approve: claude.respondClaudeApproval,
    answer: claude.respondClaudeQuestion,
    generateTitle: generateClaudeSessionTitle,
    generateBranchName: generateClaudeBranchName,
  },
  cursor: {
    send: cursor.sendCursorTurn,
    cancel: cursor.cancelCursorTurn,
    stop: cursor.forgetCursorSession,
    bind: cursor.bindCursorSession,
    approve: cursor.respondCursorApproval,
    answer: cursor.respondCursorQuestion,
    generateTitle: generateCursorSessionTitle,
  },
  grok: {
    send: grok.sendGrokTurn,
    compact: grok.compactGrokContext,
    cancel: grok.cancelGrokTurn,
    stop: grok.forgetGrokSession,
    bind: grok.bindGrokSession,
    approve: grok.respondGrokApproval,
    answer: grok.respondGrokQuestion,
    generateTitle: generateGrokSessionTitle,
  },
  opencode: {
    send: opencode.sendOpenCodeTurn,
    compact: opencode.compactOpenCodeContext,
    cancel: opencode.cancelOpenCodeTurn,
    stop: opencode.forgetOpenCodeSession,
    bind: opencode.bindOpenCodeSession,
    approve: opencode.respondOpenCodeApproval,
    answer: opencode.respondOpenCodeQuestion,
    generateTitle: generateOpenCodeSessionTitle,
  },
  pi: {
    send: pi.sendPiTurn,
    compact: pi.compactPiContext,
    cancel: pi.cancelPiTurn,
    stop: pi.forgetPiSession,
    bind: pi.bindPiSession,
    approve: pi.respondPiApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(PI_FLAVOR, id, request, reply),
    generateTitle: generatePiSessionTitle,
  },
  omp: {
    send: omp.sendOmpTurn,
    compact: omp.compactOmpContext,
    cancel: omp.cancelOmpTurn,
    stop: omp.forgetOmpSession,
    bind: omp.bindOmpSession,
    approve: omp.respondOmpApproval,
    answer: (id, request, reply) =>
      respondPiQuestion(OMP_FLAVOR, id, request, reply),
    generateTitle: generateOmpSessionTitle,
  },
  fx: {
    send: fx.sendFxTurn,
    cancel: fx.cancelFxTurn,
    stop: fx.forgetFxSession,
    bind: fx.bindFxSession,
    approve: fx.respondFxApproval,
    answer: unsupportedQuestion,
  },
  hermes: {
    send: hermes.sendHermesTurn,
    cancel: hermes.cancelHermesTurn,
    stop: hermes.forgetHermesSession,
    bind: hermes.bindHermesSession,
    approve: hermes.respondHermesApproval,
    answer: unsupportedQuestion,
  },
  gemini: {
    send: agy.sendAgyTurn,
    cancel: agy.cancelAgyTurn,
    stop: agy.forgetAgySession,
    bind: agy.bindAgySession,
    approve: agy.respondAgyApproval,
    answer: unsupportedQuestion,
  },
};

function unsupportedQuestion(): never {
  throw new Error("This provider does not support questions");
}
