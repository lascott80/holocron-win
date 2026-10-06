// Platform differences for the editor: which modifier opens links and shows
// hover previews (⌘ on the Mac, Ctrl elsewhere), and the font stacks.

export const isMac = /Mac/.test(globalThis.navigator?.platform ?? "");

/** Whether the platform's "command" modifier is held (⌘ on Mac, Ctrl on Windows/Linux). */
export function modKey(event) {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** `KeyboardEvent.key` of that modifier. */
export const MOD_KEY_NAME = isMac ? "Meta" : "Control";

export const UI_FONT = isMac
  ? "-apple-system, BlinkMacSystemFont, sans-serif"
  : "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif";

export const MONO_FONT = isMac
  ? "ui-monospace, 'SF Mono', Menlo, monospace"
  : "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, monospace";
