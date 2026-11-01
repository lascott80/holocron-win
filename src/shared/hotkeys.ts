// Custom hotkeys (REQUIREMENTS §12 HK-01, §13 Hotkeys): the canonical form of
// an in-app shortcut, the effective map (defaults overlaid by the user's
// overrides), conflict detection and key matching. Pure: shared by the
// renderer (menu bar, palette, keydown matcher) and tests.
//
// An accelerator is written like Electron's, in the canonical order
// Ctrl, Alt, Shift, then one key: "Ctrl+Shift+N", "Alt+PageUp", "F3",
// "Ctrl+\\". The Windows key is never used in-app (quick capture's
// system-wide shortcut has its own rules in settings.ts).

/** Command id → accelerator, or null for "no shortcut". */
export type HotkeyMap = Record<string, string | null>;

/** One key that runs one command, after conflicts are settled. */
export interface HotkeyBinding {
  id: string;
  key: string;
}

/** The bits of a KeyboardEvent the matcher reads. */
export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIERS: Record<string, "Ctrl" | "Alt" | "Shift" | "Super"> = {
  ctrl: "Ctrl", control: "Ctrl", cmdorctrl: "Ctrl", commandorcontrol: "Ctrl", mod: "Ctrl",
  alt: "Alt", option: "Alt",
  shift: "Shift",
  super: "Super", meta: "Super", win: "Super", windows: "Super", cmd: "Super", command: "Super",
};

const NAMED_KEYS = [
  "Space", "Tab", "Backspace", "Delete", "Insert", "Enter", "Up", "Down", "Left", "Right", "Home", "End", "PageUp", "PageDown", "Plus",
  "num0", "num1", "num2", "num3", "num4", "num5", "num6", "num7", "num8", "num9", "numdec", "numadd", "numsub", "nummult", "numdiv",
];
const KEY_ALIASES: Record<string, string> = {
  return: "Enter", esc: "Escape", escape: "Escape", del: "Delete", ins: "Insert", pgup: "PageUp", pgdn: "PageDown",
  arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", " ": "Space", "+": "Plus",
};
const PUNCTUATION = new Set([..."`-=[]\\;',./"]);

/** The key part in canonical spelling, or null if it isn't one Holocron can bind. */
function canonicalKey(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (KEY_ALIASES[raw] ?? KEY_ALIASES[lower]) return KEY_ALIASES[raw] ?? KEY_ALIASES[lower]!;
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (PUNCTUATION.has(raw)) return raw;
  return NAMED_KEYS.find((name) => name.toLowerCase() === lower) ?? null;
}

const isFunctionKey = (key: string) => /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

/**
 * An in-app shortcut in canonical form ("Ctrl+Alt+Shift+Up", "Shift+F3",
 * "Ctrl+Plus"), or null if it can't be bound: it needs Ctrl or Alt unless the
 * key is a function key, so the keys CodeMirror uses for typing (Enter, Tab,
 * Backspace, plain or shifted arrows and letters) are never taken. The
 * Windows key and Escape are never allowed.
 */
export function normalizeHotkey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split("+").map((part) => part.trim());
  // "Ctrl++": the key was "+" itself.
  if (parts.length >= 3 && parts[parts.length - 1] === "" && parts[parts.length - 2] === "") parts.splice(-2, 2, "Plus");
  if (parts.length === 0 || parts.some((part) => part === "")) return null;
  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier) {
      if (modifier === "Super" || modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      continue;
    }
    if (key !== null) return null; // one key only
    key = canonicalKey(part);
    if (key === null) return null;
  }
  if (key === null || key === "Escape") return null;
  if (!isFunctionKey(key) && !modifiers.has("Ctrl") && !modifiers.has("Alt")) return null;
  return [...(["Ctrl", "Alt", "Shift"] as const).filter((m) => modifiers.has(m)), key].join("+");
}

/** How a hotkey reads in menus, tooltips and Settings. */
export function hotkeyLabel(hotkey: string): string {
  return hotkey.replace(/\bPlus$/, "+");
}

/** The stored overrides, cleaned: known-looking ids with a valid accelerator or null (unbound). */
export function sanitizeHotkeys(raw: unknown): HotkeyMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: HotkeyMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[\w:.-]{1,80}$/.test(id)) continue;
    if (value === null) result[id] = null;
    else {
      const hotkey = normalizeHotkey(value);
      if (hotkey) result[id] = hotkey;
    }
  }
  return result;
}

/**
 * The shortcut every command has now: the defaults with the user's overrides
 * laid over them. Overrides for unknown commands are ignored; an override
 * that isn't a valid accelerator leaves the default in place.
 */
export function effectiveHotkeys(defaults: HotkeyMap, overrides: HotkeyMap | undefined): HotkeyMap {
  const result: HotkeyMap = { ...defaults };
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (!(id in defaults)) continue;
    result[id] = value === null ? null : (normalizeHotkey(value) ?? defaults[id] ?? null);
  }
  return result;
}

/** Commands other than `id` bound to the same key as `id` (in map order). */
export function hotkeyConflicts(map: HotkeyMap, id: string): string[] {
  const key = map[id];
  if (!key) return [];
  return Object.entries(map)
    .filter(([other, otherKey]) => other !== id && otherKey === key)
    .map(([other]) => other);
}

/**
 * Which command each key runs. When two commands share a key the one bound
 * last wins: an override beats a default, and a later override beats an
 * earlier one (overrides keep the order they were made in). `extras` are
 * unlisted alternative keys (e.g. Ctrl+F4 for Close Tab) that apply only
 * while their command keeps its default and nothing else uses the key.
 */
export function resolveBindings(defaults: HotkeyMap, overrides: HotkeyMap | undefined, extras: Record<string, string[]> = {}): HotkeyBinding[] {
  const winners = new Map<string, string>();
  for (const [id, key] of Object.entries(defaults)) if (key && !winners.has(key)) winners.set(key, id);
  const effective = effectiveHotkeys(defaults, overrides);
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (!(id in defaults)) continue;
    const key = effective[id];
    // Unbinding (or a bad override) frees the default key for whoever else has it.
    for (const [boundKey, boundId] of winners) if (boundId === id && boundKey !== key) winners.delete(boundKey);
    if (key && value !== null) winners.set(key, id);
  }
  for (const [id, keys] of Object.entries(extras)) {
    if (!(id in defaults) || effective[id] !== defaults[id]) continue;
    for (const raw of keys) {
      const key = normalizeHotkey(raw);
      if (key && !winners.has(key)) winners.set(key, id);
    }
  }
  return [...winners].map(([key, id]) => ({ id, key }));
}

// MARK: Matching keyboard events

/** What `KeyboardEvent.key` reports for a named key. */
const EVENT_KEYS: Record<string, string> = {
  Up: "arrowup", Down: "arrowdown", Left: "arrowleft", Right: "arrowright", Space: " ", Plus: "+",
  numdec: ".", numadd: "+", numsub: "-", nummult: "*", numdiv: "/",
};
/** Punctuation by physical key, for shifted presses ("{" for Ctrl+Shift+[). */
const PUNCTUATION_CODES: Record<string, string> = {
  Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
};

interface KeySpec {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
  numpad: string | null;
}

const specCache = new Map<string, KeySpec>();

function parseHotkey(hotkey: string): KeySpec {
  let spec = specCache.get(hotkey);
  if (!spec) {
    const parts = hotkey.split("+");
    const key = parts.pop()!;
    const numpad = key.match(/^num([0-9])$/)?.[1] ?? null;
    spec = {
      ctrl: parts.includes("Ctrl"),
      alt: parts.includes("Alt"),
      shift: parts.includes("Shift"),
      key: numpad ?? (EVENT_KEYS[key] ?? key).toLowerCase(),
      numpad,
    };
    specCache.set(hotkey, spec);
  }
  return spec;
}

/**
 * Whether a key event is this hotkey. Matched on the character typed
 * (`event.key`), so AltGr combinations on international keyboards — which
 * Chromium reports as Ctrl+Alt plus the character they produce — never
 * trigger a Ctrl+Alt shortcut. Shift changes what digits and punctuation
 * report ("!" for Shift+1), so those fall back to the physical key when Shift
 * is held.
 */
export function hotkeyMatches(hotkey: string, event: KeyLike): boolean {
  const spec = parseHotkey(hotkey);
  if (spec.ctrl !== event.ctrlKey || spec.alt !== event.altKey || spec.shift !== event.shiftKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (spec.numpad !== null) return event.code === `Numpad${spec.numpad}`;
  if (key === spec.key) return true;
  if (!event.shiftKey) return false;
  if (/^[0-9]$/.test(spec.key)) return event.code === `Digit${spec.key}`;
  return PUNCTUATION_CODES[event.code] === spec.key;
}

/** The command a key event runs under these bindings, or null. */
export function resolveHotkey(bindings: HotkeyBinding[], event: KeyLike): string | null {
  for (const binding of bindings) if (hotkeyMatches(binding.key, event)) return binding.id;
  return null;
}

/** The key part of a hotkey being recorded: letters as typed, everything else by physical key; null for a lone modifier. */
export function recordedKey(event: Pick<KeyLike, "key" | "code">): string | null {
  if (["Control", "Alt", "Shift", "Meta", "OS", "AltGraph", "Dead", "Unidentified"].includes(event.key)) return null;
  if (/^[a-zA-Z]$/.test(event.key)) return event.key.toUpperCase();
  let match: RegExpMatchArray | null;
  if ((match = event.code.match(/^Key([A-Z])$/))) return match[1]!;
  if ((match = event.code.match(/^Digit([0-9])$/))) return match[1]!;
  if ((match = event.code.match(/^Numpad([0-9])$/))) return `num${match[1]}`;
  if (isFunctionKey(event.code)) return event.code;
  if (PUNCTUATION_CODES[event.code]) return PUNCTUATION_CODES[event.code]!;
  const named: Record<string, string> = {
    Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Enter", NumpadEnter: "Enter", Escape: "Escape",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
    NumpadDecimal: "numdec", NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv",
  };
  return named[event.code] ?? (event.key.length === 1 ? event.key : null);
}

/** The hotkey a recorder keydown describes: null for a lone modifier, "" for a combination that can't be bound. */
export function recordHotkey(event: KeyLike): string | null {
  const key = recordedKey(event);
  if (key === null) return null;
  const parts = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super", key].filter(Boolean) as string[];
  return normalizeHotkey(parts.join("+")) ?? "";
}

// MARK: CodeMirror

const CODEMIRROR_KEYS: Record<string, string> = {
  Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Plus: "+",
  numdec: ".", numadd: "+", numsub: "-", nummult: "*", numdiv: "/",
};

/** The same hotkey in CodeMirror's keymap spelling ("Ctrl-Shift-ArrowUp"), for the editor's own keymap. */
export function toCodeMirrorKey(hotkey: string): string {
  const parts = hotkey.split("+");
  const key = parts.pop()!;
  const name = CODEMIRROR_KEYS[key] ?? key.replace(/^num([0-9])$/, "$1");
  return [...parts, /^[A-Z]$/.test(name) ? name.toLowerCase() : name].join("-");
}
