import type { TranslationParams } from "./types";

function findClosingBrace(value: string, start: number): number {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "{") depth += 1;
    if (value[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parsePluralOptions(value: string): Record<string, string> {
  const options: Record<string, string> = {};
  let index = 0;

  while (index < value.length) {
    while (/\s/.test(value[index] ?? "")) index += 1;
    const selectorStart = index;
    while (index < value.length && !/[\s{]/.test(value[index] ?? "")) {
      index += 1;
    }
    const selector = value.slice(selectorStart, index);
    while (/\s/.test(value[index] ?? "")) index += 1;
    if (!selector || value[index] !== "{") break;

    const closingIndex = findClosingBrace(value, index);
    if (closingIndex === -1) break;
    options[selector] = value.slice(index + 1, closingIndex);
    index = closingIndex + 1;
  }

  return options;
}

function interpolatePlural(
  token: string,
  params: TranslationParams,
): string | undefined {
  const match = token.match(/^([\w]+)\s*,\s*plural\s*,([\s\S]*)$/);
  if (!match) return undefined;

  const countValue = params[match[1]];
  const count = Number(countValue);
  if (!Number.isFinite(count)) return undefined;

  const options = parsePluralOptions(match[2]);
  const selected =
    options[`=${count}`] ??
    (count === 1 ? options.one : options.other) ??
    options.other;
  if (selected === undefined) return undefined;

  return interpolate(
    selected.replace(/#/g, String(countValue)),
    params,
  );
}

export function interpolate(
  template: string,
  params?: TranslationParams,
): string {
  if (!params) return template;

  let result = "";
  let index = 0;
  while (index < template.length) {
    if (template[index] !== "{") {
      result += template[index];
      index += 1;
      continue;
    }

    const closingIndex = findClosingBrace(template, index);
    if (closingIndex === -1) {
      result += template.slice(index);
      break;
    }

    const token = template.slice(index + 1, closingIndex);
    const pluralValue = interpolatePlural(token, params);
    if (pluralValue !== undefined) {
      result += pluralValue;
    } else if (
      /^\w+$/.test(token) &&
      Object.prototype.hasOwnProperty.call(params, token)
    ) {
      result += String(params[token]);
    } else {
      result += template.slice(index, closingIndex + 1);
    }
    index = closingIndex + 1;
  }

  return result;
}
