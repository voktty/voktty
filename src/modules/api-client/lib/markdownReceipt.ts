import type { ApiScenarioResult, ApiWebhookResult } from "../types";

export function generateScenarioMarkdownReceipt(result: ApiScenarioResult): string {
  const dateStr = new Date(result.timestamp).toISOString();
  const statusBadge = result.passed ? "PASSED (VERIFIED)" : "FAILED (FIX NEEDED)";

  const lines: string[] = [
    `# Integration Validation Receipt: ${result.scenarioName}`,
    ``,
    `> **Service**: \`${result.service}\`  `,
    `> **Status**: **${statusBadge}**  `,
    `> **Executed At**: \`${dateStr}\`  `,
    `> **Total Duration**: \`${result.totalDurationMs.toFixed(1)}ms\`  `,
    `> **Summary**: \`${result.passedSteps}/${result.totalSteps}\` steps passed.`,
    ``,
    `## Execution Breakdown`,
    ``,
    `| Step | Type | Status | Latency | Invariants / Assertions |`,
    `| :--- | :--- | :---: | :---: | :--- |`,
  ];

  for (const step of result.stepResults) {
    const stepStatus = step.passed ? "✅ Pass" : "❌ Fail";
    const assertsSummary =
      step.assertions.length > 0
        ? step.assertions.map((a) => (a.passed ? `✓ ${a.message}` : `✗ ${a.message}`)).join("<br>")
        : step.webhookResult
          ? step.webhookResult.summary
          : step.response
            ? `HTTP ${step.response.status} ${step.response.statusText}`
            : "No assertions";

    lines.push(
      `| **${step.stepName}** | \`${step.stepKind}\` | ${stepStatus} | \`${step.durationMs.toFixed(1)}ms\` | ${assertsSummary} |`,
    );
  }

  lines.push(``);
  lines.push(`## Detailed Payload & Diagnostics`);
  lines.push(``);

  for (const step of result.stepResults) {
    lines.push(`### ${step.stepName}`);
    if (step.webhookResult) {
      lines.push(`- **Target URL**: \`${step.webhookResult.targetUrl}\``);
      lines.push(`- **Event Type**: \`${step.webhookResult.eventType}\``);
      lines.push(`- **Idempotency Status**: ${step.webhookResult.isIdempotent ? "**Idempotent**" : "**Failed Idempotency**"}`);
      lines.push(``);
      lines.push(`#### Attempts:`);
      for (const att of step.webhookResult.attempts) {
        lines.push(`- Attempt #${att.attempt}: HTTP ${att.status} (${att.durationMs.toFixed(1)}ms)`);
        lines.push(`\`\`\`json`);
        lines.push(att.responseBody.slice(0, 500));
        lines.push(`\`\`\``);
      }
    } else if (step.response) {
      lines.push(`- **Status**: \`HTTP ${step.response.status} ${step.response.statusText}\``);
      lines.push(`- **Duration**: \`${step.response.timings.totalDurationMs.toFixed(1)}ms\``);
      lines.push(``);
      lines.push(`\`\`\`json`);
      lines.push(step.response.body.slice(0, 1000));
      lines.push(`\`\`\``);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Generated natively by Voktty API Sandbox Engine.*`);

  return lines.join("\n");
}

export function generateWebhookMarkdownReceipt(result: ApiWebhookResult): string {
  const dateStr = new Date().toISOString();
  const statusBadge = result.isIdempotent ? "IDEMPOTENT (PASSED)" : "NON-IDEMPOTENT (FAILED)";

  return `# Webhook Validation Receipt: ${result.service} - ${result.eventType}

> **Target**: \`${result.targetUrl}\`  
> **Service**: \`${result.service}\`  
> **Event**: \`${result.eventType}\`  
> **Status**: **${statusBadge}**  
> **Timestamp**: \`${dateStr}\`  

## Summary
${result.summary}

## Delivery Attempts
${result.attempts
  .map(
    (a) => `### Attempt #${a.attempt}
- **Status**: \`HTTP ${a.status}\`
- **Latency**: \`${a.durationMs.toFixed(1)}ms\`
- **Success**: ${a.success ? "✅ Yes" : "❌ No"}
- **Response**:
\`\`\`json
${a.responseBody.slice(0, 600)}
\`\`\`
`,
  )
  .join("\n")}

---
*Generated natively by Voktty API Sandbox Engine.*
`;
}
