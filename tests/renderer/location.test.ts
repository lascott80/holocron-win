import { describe, expect, it } from "vitest";
import { shortLocation } from "../../src/renderer/src/lib/location";

describe("shortLocation", () => {
  it("drops the vault's own folder", () => {
    expect(shortLocation("~\\OneDrive\\Notes")).toBe("~\\OneDrive");
    expect(shortLocation("~/Notes")).toBe("~");
  });

  it("elides the middle of deep paths", () => {
    expect(shortLocation("~\\AppData\\Local\\Temp\\holocron-smoke-1\\Smoke Vault")).toBe("~\\…\\Temp\\holocron-smoke-1");
    expect(shortLocation("/Users/me/Library/Mobile Documents/Vault")).toBe("/…/Library/Mobile Documents");
  });

  it("handles a vault at the root", () => {
    expect(shortLocation("/Vault")).toBe("/");
    expect(shortLocation("D:\\Vault")).toBe("D:");
  });
});
