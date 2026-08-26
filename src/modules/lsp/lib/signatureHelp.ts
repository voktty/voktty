export const MAX_SIGNATURES = 20;
const MAX_PARAMETERS = 50;
const MAX_LABEL_LENGTH = 2_000;
const MAX_DOCUMENTATION_LENGTH = 4_000;

export type SignatureParameter = {
  label: string;
  start: number;
  end: number;
  documentation: string | null;
};

export type NormalizedSignature = {
  label: string;
  documentation: string | null;
  parameters: SignatureParameter[];
  activeParameter: number | null;
};

export type NormalizedSignatureHelp = {
  signatures: NormalizedSignature[];
  activeSignature: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function documentationText(value: unknown): string | null {
  const raw =
    typeof value === "string" ? value : asRecord(value)?.value;
  return typeof raw === "string" && raw.trim()
    ? raw.trim().slice(0, MAX_DOCUMENTATION_LENGTH)
    : null;
}

function clampIndex(value: unknown, length: number): number {
  if (length <= 1 || !Number.isInteger(value)) return 0;
  return Math.max(0, Math.min(Number(value), length - 1));
}

function normalizeParameter(
  value: unknown,
  signatureLabel: string,
): SignatureParameter | null {
  const parameter = asRecord(value);
  if (!parameter) return null;
  let start: number;
  let end: number;
  let label: string;
  if (
    Array.isArray(parameter.label) &&
    parameter.label.length === 2 &&
    Number.isInteger(parameter.label[0]) &&
    Number.isInteger(parameter.label[1])
  ) {
    start = Number(parameter.label[0]);
    end = Number(parameter.label[1]);
    if (start < 0 || end < start || end > signatureLabel.length) return null;
    label = signatureLabel.slice(start, end);
  } else if (typeof parameter.label === "string" && parameter.label) {
    label = parameter.label.slice(0, MAX_LABEL_LENGTH);
    start = signatureLabel.indexOf(label);
    if (start < 0) return null;
    end = start + label.length;
  } else {
    return null;
  }
  return {
    label,
    start,
    end,
    documentation: documentationText(parameter.documentation),
  };
}

export function normalizeSignatureHelp(
  value: unknown,
): NormalizedSignatureHelp | null {
  const help = asRecord(value);
  if (!help || !Array.isArray(help.signatures)) return null;
  const signatures: NormalizedSignature[] = [];
  for (const value of help.signatures) {
    if (signatures.length >= MAX_SIGNATURES) break;
    const signature = asRecord(value);
    if (!signature || typeof signature.label !== "string") continue;
    const label = signature.label.trim().slice(0, MAX_LABEL_LENGTH);
    if (!label) continue;
    const rawParameters = Array.isArray(signature.parameters)
      ? signature.parameters.slice(0, MAX_PARAMETERS)
      : [];
    const parameters = rawParameters
      .map((parameter) => normalizeParameter(parameter, label))
      .filter((parameter): parameter is SignatureParameter => !!parameter);
    const requestedParameter =
      signature.activeParameter ?? help.activeParameter;
    signatures.push({
      label,
      documentation: documentationText(signature.documentation),
      parameters,
      activeParameter:
        parameters.length > 0
          ? clampIndex(requestedParameter, parameters.length)
          : null,
    });
  }
  if (signatures.length === 0) return null;
  return {
    signatures,
    activeSignature: clampIndex(help.activeSignature, signatures.length),
  };
}
