import { describe, it, expect } from "vitest";
import { athleteDisplayName, greetingName, derivedGreetingName } from "../athlete-name";

describe("athleteDisplayName", () => {
  it("a real name wins", () => {
    expect(athleteDisplayName("Poppy Nivarovich", "poppy@example.com")).toBe("Poppy Nivarovich");
  });

  it("never writes the whole email address", () => {
    // The bug this replaces: app.account.tsx used `email || "Athlete"`, which
    // is why athlete records exist named "amanda@unthank.me". An address in
    // the name column is a record nobody recognises down a roster — and it
    // hid duplicates, because a search for two athletes with the same name
    // never matched "Amanda Unthank" against "amanda@unthank.me".
    const out = athleteDisplayName(null, "amanda@unthank.me");
    expect(out).not.toContain("@");
    expect(out).toBe("Amanda");
  });

  it("tidies separators in the local part", () => {
    expect(athleteDisplayName(null, "poppy.nivarovich@example.com")).toBe("Poppy Nivarovich");
    expect(athleteDisplayName(null, "josh_unthank@example.com")).toBe("Josh Unthank");
    expect(athleteDisplayName(null, "jackson-u@example.com")).toBe("Jackson U");
  });

  it("falls back rather than producing an empty name", () => {
    expect(athleteDisplayName(null, null)).toBe("Athlete");
    expect(athleteDisplayName("", "")).toBe("Athlete");
    expect(athleteDisplayName("   ", "   ")).toBe("Athlete");
    expect(athleteDisplayName(undefined, undefined)).toBe("Athlete");
  });

  it("handles an address with no local part", () => {
    expect(athleteDisplayName(null, "@example.com")).toBe("Athlete");
  });

  it("trims a padded name rather than storing the padding", () => {
    expect(athleteDisplayName("  Josh Unthank  ", null)).toBe("Josh Unthank");
  });
});


describe("greetingName", () => {
  it("a chosen preferred name wins over the full name", () => {
    expect(greetingName("Mike", "Michael Unthank")).toBe("Mike");
  });

  it("falls back to the first word of the full name", () => {
    expect(greetingName(null, "Chris Unthank")).toBe("Chris");
    expect(greetingName("", "Poppy Nivarovich")).toBe("Poppy");
    expect(greetingName("   ", "Josh Unthank")).toBe("Josh");
  });

  it("never greets someone by their email address", () => {
    // Older profiles can be named after one. "Hello chris@unthank.me" reads
    // as a mail-merge that went wrong, and is worse than no name at all.
    expect(greetingName(null, "chris@unthank.me")).toBe("");
    expect(greetingName("amanda@unthank.me", "Amanda Unthank")).toBe("Amanda");
  });

  it("returns empty rather than a placeholder when there is nothing usable", () => {
    // Lets the caller choose a greeting that needs no name at all.
    expect(greetingName(null, null)).toBe("");
    expect(greetingName(undefined, undefined)).toBe("");
    expect(greetingName("", "")).toBe("");
  });

  it("keeps a multi-word preferred name intact", () => {
    // Someone who types "Coach Chris" means it.
    expect(greetingName("Coach Chris", "Chris Unthank")).toBe("Coach Chris");
  });

  it("handles padded and multi-space names", () => {
    expect(greetingName(null, "  Poppy   Nivarovich  ")).toBe("Poppy");
    expect(greetingName("  Pop  ", "Poppy Nivarovich")).toBe("Pop");
  });

  it("derivedGreetingName is the no-preference case", () => {
    expect(derivedGreetingName("Chris Unthank")).toBe("Chris");
    expect(derivedGreetingName("chris@unthank.me")).toBe("");
    expect(derivedGreetingName(null)).toBe("");
  });
});
