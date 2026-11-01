import { describe, expect, it } from "vitest";
import {
  effectiveHotkeys,
  hotkeyConflicts,
  hotkeyLabel,
  hotkeyMatches,
  normalizeHotkey,
  recordHotkey,
  resolveBindings,
  resolveHotkey,
  sanitizeHotkeys,
  toCodeMirrorKey,
  type KeyLike,
} from "@shared/hotkeys";
import { defaultSettings, sanitizeSettings } from "@shared/settings";

function key(overrides: Partial<KeyLike> & { key: string }): KeyLike {
  return { code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...overrides };
}

describe("normalizeHotkey", () => {
  it("puts modifiers in canonical order and upper-cases the key", () => {
    expect(normalizeHotkey("shift+ctrl+n")).toBe("Ctrl+Shift+N");
    expect(normalizeHotkey("Alt+Ctrl+Shift+ArrowUp")).toBe("Ctrl+Alt+Shift+Up");
    expect(normalizeHotkey("CmdOrCtrl+,")).toBe("Ctrl+,");
    expect(normalizeHotkey("Ctrl+\\")).toBe("Ctrl+\\");
    expect(normalizeHotkey("Ctrl++")).toBe("Ctrl+Plus");
    expect(normalizeHotkey("Ctrl+Shift++")).toBe("Ctrl+Shift+Plus");
  });

  it("allows function keys on their own or with Shift", () => {
    expect(normalizeHotkey("F3")).toBe("F3");
    expect(normalizeHotkey("Shift+F3")).toBe("Shift+F3");
    expect(normalizeHotkey("f12")).toBe("F12");
  });

  it("refuses the keys the editor needs for typing", () => {
    for (const bad of ["Enter", "Tab", "Backspace", "Up", "Shift+Down", "N", "Shift+N", "Space", "Escape", "Ctrl+Escape"]) {
      expect(normalizeHotkey(bad), bad).toBeNull();
    }
  });

  it("refuses the Windows key, repeats, several keys and junk", () => {
    expect(normalizeHotkey("Super+Alt+N")).toBeNull();
    expect(normalizeHotkey("Ctrl+Ctrl+N")).toBeNull();
    expect(normalizeHotkey("Ctrl+N+M")).toBeNull();
    expect(normalizeHotkey("Ctrl+")).toBeNull();
    expect(normalizeHotkey("Ctrl+Hyper")).toBeNull();
    expect(normalizeHotkey(42)).toBeNull();
  });

  it("labels Plus as +", () => {
    expect(hotkeyLabel("Ctrl+Plus")).toBe("Ctrl++");
    expect(hotkeyLabel("Ctrl+Shift+N")).toBe("Ctrl+Shift+N");
  });
});

describe("sanitizeHotkeys", () => {
  it("keeps valid overrides and unbound entries, drops the rest", () => {
    expect(sanitizeHotkeys({ newNote: "ctrl+shift+1", bold: null, bad: "N", worse: 3, "sortFiles:name": "Alt+S" })).toEqual({
      newNote: "Ctrl+Shift+1",
      bold: null,
      "sortFiles:name": "Alt+S",
    });
    expect(sanitizeHotkeys(null)).toEqual({});
    expect(sanitizeHotkeys(["Ctrl+N"])).toEqual({});
  });

  it("is applied by sanitizeSettings", () => {
    expect(sanitizeSettings({ hotkeys: { newNote: "alt+n", nope: "Enter" } }).hotkeys).toEqual({ newNote: "Alt+N" });
    expect(sanitizeSettings({ hotkeys: "Ctrl+N" as never }).hotkeys).toEqual({});
    expect(sanitizeSettings({}).hotkeys).toEqual(defaultSettings.hotkeys);
  });
});

const defaults = { newNote: "Ctrl+N", newFolder: "Ctrl+Alt+N", bold: "Ctrl+B", about: null };

describe("effectiveHotkeys", () => {
  it("overlays overrides on the defaults", () => {
    expect(effectiveHotkeys(defaults, { newFolder: "Ctrl+Shift+F", about: "F1", bold: null })).toEqual({
      newNote: "Ctrl+N",
      newFolder: "Ctrl+Shift+F",
      bold: null,
      about: "F1",
    });
  });

  it("ignores unknown commands and keeps the default for an unusable override", () => {
    expect(effectiveHotkeys(defaults, { ghost: "Ctrl+G", bold: "Enter" })).toEqual(defaults);
    expect(effectiveHotkeys(defaults, undefined)).toEqual(defaults);
  });
});

describe("hotkeyConflicts", () => {
  it("names the other commands on the same key", () => {
    const map = effectiveHotkeys(defaults, { newFolder: "Ctrl+N", about: "Ctrl+N" });
    expect(hotkeyConflicts(map, "newNote")).toEqual(["newFolder", "about"]);
    expect(hotkeyConflicts(map, "bold")).toEqual([]);
    expect(hotkeyConflicts({ ...map, bold: null }, "bold")).toEqual([]);
  });
});

describe("resolveBindings", () => {
  it("binds every default once", () => {
    expect(resolveBindings(defaults, {})).toEqual([
      { id: "newNote", key: "Ctrl+N" },
      { id: "newFolder", key: "Ctrl+Alt+N" },
      { id: "bold", key: "Ctrl+B" },
    ]);
  });

  it("the command bound last wins a conflict", () => {
    const bindings = resolveBindings(defaults, { newFolder: "Ctrl+N" });
    expect(bindings.find((b) => b.key === "Ctrl+N")?.id).toBe("newFolder");
    expect(bindings.some((b) => b.id === "newNote")).toBe(false);
    expect(bindings.some((b) => b.key === "Ctrl+Alt+N")).toBe(false);
    const later = resolveBindings(defaults, { newFolder: "Ctrl+N", about: "Ctrl+N" });
    expect(later.find((b) => b.key === "Ctrl+N")?.id).toBe("about");
  });

  it("unbinding frees the key", () => {
    expect(resolveBindings(defaults, { newNote: null }).some((b) => b.key === "Ctrl+N")).toBe(false);
  });

  it("extra keys apply only while the command keeps its default and the key is free", () => {
    const extras = { newNote: ["Ctrl+F4", "Ctrl+B"] };
    expect(resolveBindings(defaults, {}, extras)).toContainEqual({ id: "newNote", key: "Ctrl+F4" });
    expect(resolveBindings(defaults, {}, extras).find((b) => b.key === "Ctrl+B")?.id).toBe("bold");
    expect(resolveBindings(defaults, { newNote: "Alt+N" }, extras).some((b) => b.key === "Ctrl+F4")).toBe(false);
  });
});

describe("hotkeyMatches", () => {
  it("matches on the typed character", () => {
    expect(hotkeyMatches("Ctrl+Shift+N", key({ key: "N", code: "KeyN", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+N", key({ key: "n", code: "KeyN", ctrlKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+N", key({ key: "n", code: "KeyN", ctrlKey: true, altKey: true }))).toBe(false);
    expect(hotkeyMatches("Ctrl+N", key({ key: "n", code: "KeyN", ctrlKey: true, metaKey: true }))).toBe(false);
    expect(hotkeyMatches("Alt+Left", key({ key: "ArrowLeft", code: "ArrowLeft", altKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+Plus", key({ key: "+", code: "Equal", ctrlKey: true, shiftKey: false }))).toBe(true);
    expect(hotkeyMatches("F3", key({ key: "F3", code: "F3" }))).toBe(true);
    expect(hotkeyMatches("Shift+F3", key({ key: "F3", code: "F3", shiftKey: true }))).toBe(true);
  });

  it("never fires a Ctrl+Alt shortcut for an AltGr character", () => {
    // AltGr+Q on a German layout types "@": Chromium reports Ctrl+Alt with key "@".
    expect(hotkeyMatches("Ctrl+Alt+Q", key({ key: "@", code: "KeyQ", ctrlKey: true, altKey: true }))).toBe(false);
    // AltGr+2 types "²".
    expect(hotkeyMatches("Ctrl+Alt+2", key({ key: "²", code: "Digit2", ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("falls back to the physical key for shifted digits and punctuation", () => {
    expect(hotkeyMatches("Ctrl+Shift+1", key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+Shift+[", key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+Shift+Plus", key({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("tells numpad digits from the top row", () => {
    expect(hotkeyMatches("Ctrl+num1", key({ key: "1", code: "Numpad1", ctrlKey: true }))).toBe(true);
    expect(hotkeyMatches("Ctrl+num1", key({ key: "1", code: "Digit1", ctrlKey: true }))).toBe(false);
  });
});

describe("resolveHotkey", () => {
  const ctrlN = key({ key: "n", code: "KeyN", ctrlKey: true });
  const ctrlAltN = key({ key: "n", code: "KeyN", ctrlKey: true, altKey: true });

  it("a custom binding changes which command a key runs", () => {
    expect(resolveHotkey(resolveBindings(defaults, {}), ctrlN)).toBe("newNote");
    expect(resolveHotkey(resolveBindings(defaults, {}), ctrlAltN)).toBe("newFolder");
    const rebound = resolveBindings(defaults, { newFolder: "Ctrl+N" });
    expect(resolveHotkey(rebound, ctrlN)).toBe("newFolder");
    expect(resolveHotkey(rebound, ctrlAltN)).toBeNull();
  });

  it("an unbound command no longer answers its key", () => {
    expect(resolveHotkey(resolveBindings(defaults, { newNote: null }), ctrlN)).toBeNull();
  });

  it("a command with no default can be given a key", () => {
    expect(resolveHotkey(resolveBindings(defaults, { about: "F1" }), key({ key: "F1", code: "F1" }))).toBe("about");
  });
});

describe("recordHotkey", () => {
  it("waits for a key after a modifier", () => {
    expect(recordHotkey(key({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
    expect(recordHotkey(key({ key: "Shift", code: "ShiftLeft", shiftKey: true }))).toBeNull();
  });

  it("records letters as typed and other keys by their physical key", () => {
    expect(recordHotkey(key({ key: "z", code: "KeyY", ctrlKey: true }))).toBe("Ctrl+Z"); // German layout
    expect(recordHotkey(key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+1");
    expect(recordHotkey(key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+[");
    expect(recordHotkey(key({ key: "PageUp", code: "PageUp", altKey: true }))).toBe("Alt+PageUp");
    expect(recordHotkey(key({ key: "F5", code: "F5" }))).toBe("F5");
  });

  it("reports a combination that can't be bound as empty", () => {
    expect(recordHotkey(key({ key: "Enter", code: "Enter" }))).toBe("");
    expect(recordHotkey(key({ key: "a", code: "KeyA", shiftKey: true }))).toBe("");
    expect(recordHotkey(key({ key: "n", code: "KeyN", metaKey: true, altKey: true }))).toBe("");
  });
});

describe("toCodeMirrorKey", () => {
  it("spells hotkeys the way CodeMirror keymaps do", () => {
    expect(toCodeMirrorKey("Ctrl+B")).toBe("Ctrl-b");
    expect(toCodeMirrorKey("Ctrl+Alt+Shift+Up")).toBe("Ctrl-Alt-Shift-ArrowUp");
    expect(toCodeMirrorKey("Alt+Shift+Backspace")).toBe("Alt-Shift-Backspace");
    expect(toCodeMirrorKey("Shift+F3")).toBe("Shift-F3");
    expect(toCodeMirrorKey("Ctrl+Shift+[")).toBe("Ctrl-Shift-[");
    expect(toCodeMirrorKey("Ctrl+Plus")).toBe("Ctrl-+");
  });
});
