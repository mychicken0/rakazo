import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./timestamp";

const now = new Date(2026, 10, 12, 15, 0);
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).toISOString();

describe("formatTimestamp", () => {
  it("shows only the time today", () => {
    expect(formatTimestamp(at(2026, 10, 12, 14, 36), now)).toBe("2:36 PM");
  });

  it("names yesterday and tomorrow", () => {
    expect(formatTimestamp(at(2026, 10, 11, 9, 5), now)).toBe("Yesterday 9:05 AM");
    expect(formatTimestamp(at(2026, 10, 13, 0, 0), now)).toBe("Tomorrow 12:00 AM");
  });

  it("gives the date when older, and the year when it is another year", () => {
    expect(formatTimestamp(at(2026, 10, 3, 8, 0), now)).toBe("Nov 3, 8:00 AM");
    expect(formatTimestamp(at(2025, 11, 31, 23, 59), now)).toBe("Dec 31, 2025, 11:59 PM");
  });

  it("is empty for a bad date", () => {
    expect(formatTimestamp("not a date", now)).toBe("");
  });
});
