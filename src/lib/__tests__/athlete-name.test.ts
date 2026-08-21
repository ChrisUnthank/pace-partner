import { describe, it, expect } from "vitest";
import { athleteDisplayName } from "../athlete-name";

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
