// Installed font names from the Windows registry (src/main/fonts.ts, REQUIREMENTS §16.11).

import { describe, expect, it } from "vitest";
import { familyName, parseFontNames } from "../../src/main/fonts";

const REG_OUTPUT = `
HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Arial (TrueType)    REG_SZ    arial.ttf
    Arial Bold (TrueType)    REG_SZ    arialbd.ttf
    Arial Bold Italic (TrueType)    REG_SZ    arialbi.ttf
    Cascadia Mono (TrueType)    REG_SZ    CascadiaMono.ttf
    Segoe UI Variable (TrueType)    REG_SZ    SegUIVar.ttf
    Segoe UI Semibold (TrueType)    REG_SZ    seguisb.ttf
    MS Gothic & MS UI Gothic & MS PGothic (TrueType)    REG_SZ    msgothic.ttc
    @MS Gothic & @MS UI Gothic (TrueType)    REG_SZ    msgothic.ttc
    Courier 10,12,15 (VGA res)    REG_SZ    COURE.FON
    Noto Sans (OpenType)    REG_SZ    NotoSans.otf

HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts
    Inter (TrueType)    REG_SZ    C:\\Users\\x\\AppData\\Local\\Microsoft\\Windows\\Fonts\\Inter.ttf
    arial (TrueType)    REG_SZ    C:\\Users\\x\\AppData\\Local\\Microsoft\\Windows\\Fonts\\arial.ttf
    ERROR: The system was unable to find the specified registry key or value.
`;

describe("parseFontNames", () => {
  it("strips the type suffix and style words, splits families, de-duplicates and sorts", () => {
    expect(parseFontNames(REG_OUTPUT)).toEqual([
      "Arial",
      "Cascadia Mono",
      "Courier 10,12,15",
      "Inter",
      "MS Gothic",
      "MS PGothic",
      "MS UI Gothic",
      "Noto Sans",
      "Segoe UI Semibold",
      "Segoe UI Variable",
    ]);
  });

  it("is empty for no output or an error message", () => {
    expect(parseFontNames("")).toEqual([]);
    expect(parseFontNames("ERROR: The system was unable to find the specified registry key or value.")).toEqual([]);
  });
});

describe("familyName", () => {
  it("drops trailing face-style words only, keeping weight and width families", () => {
    expect(familyName("Arial Bold Italic")).toBe("Arial");
    expect(familyName("Segoe UI Semibold Italic")).toBe("Segoe UI Semibold");
    expect(familyName("Bahnschrift SemiBold Condensed")).toBe("Bahnschrift SemiBold Condensed");
    expect(familyName("Bold")).toBe("Bold");
    expect(familyName("Arial Black")).toBe("Arial Black");
    expect(familyName("Franklin Gothic Medium")).toBe("Franklin Gothic Medium");
  });
});
