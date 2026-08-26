import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  isRtlLocale,
  getLocaleDirection,
  applyDocumentLocale,
} from "./direction";
import { SUPPORTED_LANGUAGES } from "./types";

describe("direction", () => {
  const fakeElement: Record<string, string> = {
    lang: "en",
    dir: "ltr",
  };
  const attributes: Record<string, string> = {};

  beforeEach(() => {
    fakeElement.lang = "en";
    fakeElement.dir = "ltr";
    for (const key of Object.keys(attributes)) {
      delete attributes[key];
    }

    vi.stubGlobal("document", {
      documentElement: {
        get lang() {
          return fakeElement.lang;
        },
        set lang(val: string) {
          fakeElement.lang = val;
        },
        get dir() {
          return fakeElement.dir;
        },
        set dir(val: string) {
          fakeElement.dir = val;
        },
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
        getAttribute(name: string) {
          return attributes[name] ?? null;
        },
        removeAttribute(name: string) {
          delete attributes[name];
        },
      },
    });
  });

  describe("isRtlLocale", () => {
    it("returns true for arabic ('ar')", () => {
      expect(isRtlLocale("ar")).toBe(true);
    });

    it("returns false for hindi ('hi') and all other supported languages", () => {
      expect(isRtlLocale("hi")).toBe(false);
      expect(isRtlLocale("en")).toBe(false);
      expect(isRtlLocale("es")).toBe(false);
      expect(isRtlLocale("pt")).toBe(false);
      expect(isRtlLocale("fr")).toBe(false);
      expect(isRtlLocale("de")).toBe(false);
      expect(isRtlLocale("it")).toBe(false);
      expect(isRtlLocale("zh")).toBe(false);
      expect(isRtlLocale("ja")).toBe(false);
      expect(isRtlLocale("ko")).toBe(false);
      expect(isRtlLocale("ru")).toBe(false);
    });

    it("returns false for empty, null, undefined or unknown locales", () => {
      expect(isRtlLocale("")).toBe(false);
      expect(isRtlLocale(null)).toBe(false);
      expect(isRtlLocale(undefined)).toBe(false);
      expect(isRtlLocale("unknown-lang")).toBe(false);
    });
  });

  describe("getLocaleDirection", () => {
    it("returns 'rtl' only for 'ar'", () => {
      expect(getLocaleDirection("ar")).toBe("rtl");
    });

    it("returns 'ltr' for all non-RTL locales", () => {
      for (const lang of SUPPORTED_LANGUAGES) {
        if (lang.id === "ar") {
          expect(getLocaleDirection(lang.id)).toBe("rtl");
        } else {
          expect(getLocaleDirection(lang.id)).toBe("ltr");
        }
      }
    });
  });

  describe("applyDocumentLocale", () => {
    it("sets document lang and dir to rtl for arabic", () => {
      applyDocumentLocale("ar");
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
      expect(document.documentElement.getAttribute("data-direction")).toBe(
        "rtl",
      );
    });

    it("sets document lang and dir to ltr for hindi", () => {
      applyDocumentLocale("hi");
      expect(document.documentElement.lang).toBe("hi");
      expect(document.documentElement.dir).toBe("ltr");
      expect(document.documentElement.getAttribute("data-direction")).toBe(
        "ltr",
      );
    });

    it("falls back to 'en' and 'ltr' when null or undefined", () => {
      applyDocumentLocale(undefined);
      expect(document.documentElement.lang).toBe("en");
      expect(document.documentElement.dir).toBe("ltr");
      expect(document.documentElement.getAttribute("data-direction")).toBe(
        "ltr",
      );
    });
  });
});
