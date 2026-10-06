import { describe, expect, it } from "vitest";
import {
  dailyNoteDate,
  dailyNotePath,
  formatDate,
  parseDate,
  renderPlaceholders,
} from "@core/dailyNotes";

/** Oct 5 2026, 14:30 local time. */
const date = new Date(2026, 9, 5, 14, 30);

describe("formatDate", () => {
  it("formats Moment formats", () => {
    expect(formatDate(date, "YYYY-MM-DD")).toBe("2026-10-05");
    expect(formatDate(date, "dddd, MMMM D YYYY")).toBe("Monday, October 5 2026");
    expect(formatDate(date, "[Week] ww")).toBe("Week 41");
  });

  it("covers every token", () => {
    const d = new Date(2026, 1, 3, 9, 7, 4); // Tue Feb 3 2026 09:07:04
    expect(formatDate(d, "YYYY YY MMMM MMM MM M DDDD DD D")).toBe("2026 26 February Feb 02 2 034 03 3");
    expect(formatDate(d, "dddd ddd HH H hh h mm m ss s A a")).toBe("Tuesday Tue 09 9 09 9 07 7 04 4 AM AM");
    expect(formatDate(d, "ww w gggg Q")).toBe("06 6 2026 1");
    expect(formatDate(new Date(2026, 9, 5, 0, 5), "h:mm A")).toBe("12:05 AM");
    expect(formatDate(new Date(2026, 9, 5, 12, 5), "hh:mm a")).toBe("12:05 PM");
    expect(formatDate(new Date(2026, 9, 5, 23, 5), "h A")).toBe("11 PM");
  });

  it("treats brackets and other letters as literal", () => {
    expect(formatDate(date, "[YYYY] YYYY")).toBe("YYYY 2026");
    expect(formatDate(date, "YYYY-[W]ww")).toBe("2026-W41");
    expect(formatDate(date, "Y x d")).toBe("Y x d");
    expect(formatDate(date, "YYYY [open")).toBe("2026 [open"); // "s" would be seconds
    expect(formatDate(date, "'YY'")).toBe("'26'");
  });

  it("writes Do with an ordinal suffix", () => {
    const day = (d: number) => formatDate(new Date(2026, 0, d), "Do");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 30, 31].map(day)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th", "30th", "31st",
    ]);
  });

  it("numbers weeks the US way", () => {
    // Jan 1 2026 is a Thursday: Dec 28 2025 – Jan 3 2026 is week 1 of 2026.
    expect(formatDate(new Date(2025, 11, 28), "gggg-ww")).toBe("2026-01");
    expect(formatDate(new Date(2026, 0, 3), "gggg-ww")).toBe("2026-01");
    expect(formatDate(new Date(2026, 0, 4), "gggg-ww")).toBe("2026-02");
    expect(formatDate(new Date(2026, 11, 31), "YYYY gggg-ww")).toBe("2026 2027-01");
    expect(formatDate(new Date(2026, 11, 26), "gggg-ww")).toBe("2026-52");
  });

  it("formats quarters", () => {
    expect([0, 2, 3, 6, 9, 11].map((m) => formatDate(new Date(2026, m, 1), "Q"))).toEqual(["1", "1", "2", "3", "4", "4"]);
  });
});

describe("parseDate", () => {
  it("round-trips and rejects anything else", () => {
    expect(parseDate("2026-10-05", "YYYY-MM-DD")).toEqual(new Date(2026, 9, 5));
    expect(parseDate("2026-13-45", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("2026-1-05", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("2026-10-05 ", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("Meeting notes", "YYYY-MM-DD")).toBeNull();
  });

  it("parses names, weekdays and times", () => {
    expect(parseDate("Monday, October 5 2026", "dddd, MMMM D YYYY")).toEqual(new Date(2026, 9, 5));
    expect(parseDate("Tuesday, October 5 2026", "dddd, MMMM D YYYY")).toBeNull();
    expect(parseDate("monday, October 5 2026", "dddd, MMMM D YYYY")).toBeNull();
    expect(parseDate("Oct 5 26 2:30 PM", "MMM D YY h:mm A")).toEqual(new Date(2026, 9, 5, 14, 30));
    expect(parseDate("12:05 AM", "hh:mm A")).toEqual(new Date(1970, 0, 1, 0, 5));
  });

  it("accepts ordinal days only with the right suffix", () => {
    expect(parseDate("October 1st, 2026", "MMMM Do, YYYY")).toEqual(new Date(2026, 9, 1));
    expect(parseDate("October 22nd, 2026", "MMMM Do, YYYY")).toEqual(new Date(2026, 9, 22));
    expect(parseDate("October 13th, 2026", "MMMM Do, YYYY")).toEqual(new Date(2026, 9, 13));
    expect(parseDate("October 1th, 2026", "MMMM Do, YYYY")).toBeNull();
    expect(parseDate("October 1, 2026", "MMMM Do, YYYY")).toBeNull();
  });

  it("handles adjacent unpadded numbers by trying each width", () => {
    expect(parseDate("2026111", "YYYYMD")).toEqual(new Date(2026, 10, 1)); // 11/1, not 1/11: formatting 1/11 gives "2026111" too
    expect(parseDate("2026105", "YYYYMD")).toEqual(new Date(2026, 9, 5));
  });

  it("parses day of year, weeks and quarters", () => {
    expect(parseDate("2026-278", "YYYY-DDDD")).toEqual(new Date(2026, 9, 5));
    expect(parseDate("2026-W41", "gggg-[W]ww")).toEqual(new Date(2026, 9, 4));
    expect(parseDate("2027-W01", "gggg-[W]ww")).toEqual(new Date(2026, 11, 27));
    expect(parseDate("2026 Q4", "YYYY [Q]Q")).toEqual(new Date(2026, 9, 1));
  });
});

describe("daily note paths", () => {
  it("builds paths", () => {
    expect(dailyNotePath(date, "Daily", "YYYY-MM-DD")).toBe("Daily/2026-10-05.md");
    expect(dailyNotePath(date, "", "YYYY-MM-DD")).toBe("2026-10-05.md");
    expect(dailyNotePath(date, "Journal/", "YYYY/MM/YYYY-MM-DD dddd")).toBe("Journal/2026/10/2026-10-05 Monday.md");
    expect(dailyNotePath(date, "Daily", "")).toBe("Daily/2026-10-05.md");
    expect(dailyNotePath(date, "./Daily/../Days", "YYYY-MM-DD")).toBe("Days/2026-10-05.md");
  });

  it("recognises daily note paths", () => {
    expect(dailyNoteDate("Daily/2026-10-05.md", "Daily", "YYYY-MM-DD")).toEqual(new Date(2026, 9, 5));
    expect(dailyNoteDate("Daily/Meeting notes.md", "Daily", "YYYY-MM-DD")).toBeNull();
    expect(dailyNoteDate("Other/2026-10-05.md", "Daily", "YYYY-MM-DD")).toBeNull();
    expect(dailyNoteDate("Daily/2026-13-45.md", "Daily", "YYYY-MM-DD")).toBeNull();
    expect(dailyNoteDate("Journal/2026/10/2026-10-05.md", "Journal", "YYYY/MM/YYYY-MM-DD")).not.toBeNull();
    expect(dailyNoteDate("Journal/2026/11/2026-10-05.md", "Journal", "YYYY/MM/YYYY-MM-DD")).toBeNull();
    expect(dailyNoteDate("2026-10-05.md", "", "")).toEqual(new Date(2026, 9, 5));
  });

  it("returns local midnight for formats with a time", () => {
    expect(dailyNoteDate("Daily/2026-10-05 1430.md", "Daily", "YYYY-MM-DD HHmm")).toEqual(new Date(2026, 9, 5));
  });

  it("recognises notes written with ordinal days", () => {
    const path = dailyNotePath(new Date(2026, 9, 22), "Daily", "MMMM Do YYYY");
    expect(path).toBe("Daily/October 22nd 2026.md");
    expect(dailyNoteDate(path, "Daily", "MMMM Do YYYY")).toEqual(new Date(2026, 9, 22));
  });
});

describe("renderPlaceholders", () => {
  it("renders templates", () => {
    const template = "# {{title}}\nWritten {{date:dddd, MMMM D}} at {{time}}.\n← [[{{yesterday}}]] | [[{{tomorrow}}]] →\n{{ date }}\n";
    expect(renderPlaceholders(template, date, "2026-10-05", "YYYY-MM-DD")).toBe(
      "# 2026-10-05\nWritten Monday, October 5 at 14:30.\n← [[2026-10-04]] | [[2026-10-06]] →\n2026-10-05\n",
    );
  });

  it("leaves other braces alone", () => {
    expect(renderPlaceholders("{{weather}} {{date}} {{Title}} {{cursor}}", date, "x", "YYYY-MM-DD")).toBe(
      "{{weather}} 2026-10-05 {{Title}} {{cursor}}",
    );
  });

  it("uses the last path segment of the daily format for note names", () => {
    expect(renderPlaceholders("{{date}} {{yesterday}} {{tomorrow}}", date, "x", "YYYY/MM/YYYY-MM-DD")).toBe(
      "2026-10-05 2026-10-04 2026-10-06",
    );
  });

  it("honours formats for time, yesterday and tomorrow", () => {
    expect(renderPlaceholders("{{time:h:mm A}} {{ time : HH[h] }}", date, "x", "")).toBe("2:30 PM 14h");
    expect(renderPlaceholders("{{yesterday:dddd}} / {{tomorrow: MMM Do }}", date, "x", "")).toBe("Sunday / Oct 6th");
    expect(renderPlaceholders("{{tomorrow:YYYY-MM-DD}}", new Date(2026, 11, 31, 9), "x", "")).toBe("2027-01-01");
  });
});
