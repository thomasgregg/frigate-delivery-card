import { describe, expect, it } from "vitest";
import {
  getTranslations,
  localize,
  resolveLanguage,
  resolveLocale,
} from "./localize";

describe("localization", () => {
  it("maps German regional variants and falls back to English", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale("de-AT")).toBe("de");
    expect(resolveLocale("de-DE")).toBe("de");
    expect(resolveLocale("fr-FR")).toBe("en");
  });

  it("falls back safely when a language tag is invalid", () => {
    expect(resolveLanguage("not_a_language")).toBe("en");
    expect(resolveLocale("not_a_language")).toBe("en");
  });

  it("keeps the English and German catalogs in sync", () => {
    expect(Object.keys(getTranslations("de")).sort()).toEqual(
      Object.keys(getTranslations("en")).sort(),
    );
  });

  it("replaces values in complete translated messages", () => {
    expect(localize("noMatchingLastHours", "en-GB", { hours: 24 }))
      .toBe("No matching events in the last 24 hours.");
    expect(localize("noMatchingLastHours", "de-AT", { hours: 24 }))
      .toBe("Keine passenden Ereignisse in den letzten 24 Stunden.");
  });
});
