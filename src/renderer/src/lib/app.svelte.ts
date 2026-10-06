// The renderer's view of the app: the latest state snapshot pushed by the
// main process, plus UI-only state (palettes, sidebar mode, focus mode…).

import type { AppState, ContextMenuParams, EditAction, EditorMessage, TreeNode, UiRequest } from "@shared/ipc";
import { defaultSettings, type Settings } from "@shared/settings";
import { call, editor, host, run } from "./host";
import { buildContextMenu, FORMAT_COMMANDS, mermaidCodeAt, type ContextActions, type ContextTarget } from "./contextMenu";
import { commandById } from "./commands";
import { menu } from "./menu.svelte";

class AppStore {
  state = $state<AppState>({
    vault: null,
    recentVaults: [],
    settings: defaultSettings,
    errorMessage: null,
    version: "",
    isDark: true,
    update: { status: "idle", currentVersion: "", showPrompt: false },
    quickCapture: { registered: false, error: null },
  });
  tree = $state<TreeNode[]>([]);
  /** The UI has received its first state (avoid flashing the welcome view). */
  loaded = $state(false);

  // UI-only state
  quickOpen = $state<{ query: string; mode: "notes" | "commands" } | null>(null);
  templatePicker = $state<"insert" | "newNote" | null>(null);
  sidebarMode = $state<"files" | "search">("files");
  searchFocusRequest = $state(0);
  searchText = $state("");
  focusMode = $state(false);
  settingsOpen = $state(false);
  /** Cursor and selection in the editor (status bar). */
  cursor = $state({ line: 1, column: 1, selectedWords: 0, selectedCharacters: 0 });
  /** The editor's current text for the shown note (word counts). */
  text = $state("");
  editorReady = $state(false);

  get vault() {
    return this.state.vault;
  }

  get settings(): Settings {
    return this.state.settings;
  }

  get doc() {
    return this.state.vault?.doc ?? null;
  }

  get readingView() {
    return this.state.settings.editorMode === "reading";
  }

  start() {
    host.onState((state) => {
      this.state = state;
      this.loaded = true;
    });
    host.onTree((tree) => (this.tree = tree));
    host.onUi((request: UiRequest) => this.handleUi(request));
    // Capture phase, so it's seen even when a component stops propagation; whether
    // that component prevented the default is read later, from the event itself.
    window.addEventListener("contextmenu", (event) => (this.lastContextMenu = { event, time: performance.now() }), true);
    // Main → editor calls (setDocument, applyExternalEdits, …), REQUIREMENTS §2.1.
    host.onEditorCall(({ method, args }) => {
      const target = window.holocron?.[method];
      if (typeof target === "function") target.apply(window.holocron, args);
      // Loading a note or applying a disk change doesn't post "change"; keep word counts current.
      if (method === "setDocument") this.text = String(args[0] ?? "");
      else if (method === "applyExternalEdits") this.text = String(args[1] ?? "");
    });
    window.holocronEditorPost = (message: EditorMessage) => {
      this.tapEditor(message);
      if (message.type === "copy") {
        void navigator.clipboard.writeText(message.text);
        return;
      }
      if (message.type === "copyRich") {
        // Main only overwrites the clipboard if it still holds this copy's text.
        call("writeClipboard", message.text, message.html).catch((error: unknown) => console.error("[writeClipboard]", error));
        return;
      }
      host.postEditor(message);
    };
    void call<AppState>("getState").then((state) => {
      this.state = state;
      this.loaded = true;
    });
    void call<TreeNode[]>("getTree").then((tree) => (this.tree = tree));
  }

  /** Watches editor messages for the status bar. */
  private tapEditor(message: EditorMessage) {
    if (message.type === "change") this.text = message.text;
    else if (message.type === "selection") {
      this.cursor = {
        line: message.line,
        column: message.column,
        selectedWords: message.selectedWords ?? 0,
        selectedCharacters: message.selectedCharacters ?? 0,
      };
    } else if (message.type === "ready") this.editorReady = true;
  }

  private handleUi(request: UiRequest) {
    switch (request.type) {
      case "quickOpen":
        this.showQuickOpen(request.query);
        break;
      case "showSearch":
        this.showSearch(request.query);
        break;
      case "templatePicker":
        this.templatePicker = request.mode;
        break;
      case "contextMenu":
        this.showContextMenu(request);
        break;
      case "beep":
        break;
    }
  }

  /** The last DOM contextmenu event; main's context-menu request follows it. */
  private lastContextMenu: { event: MouseEvent; time: number } | null = null;

  /** Right-click in the editor or a text field (main's context-menu event). */
  private showContextMenu(params: ContextMenuParams) {
    const last = this.lastContextMenu && performance.now() - this.lastContextMenu.time < 2000 ? this.lastContextMenu.event : null;
    this.lastContextMenu = null;
    // A component already showed its own menu (file tree, tabs, tables…).
    if (last?.defaultPrevented) return;
    const element = last?.target instanceof Element ? last.target : null;
    const target = describeTarget(element);
    const focused = document.activeElement;
    const restoreFocus = () => {
      if (focused instanceof HTMLElement && focused.isConnected && focused !== document.body) focused.focus({ preventScroll: true });
    };
    const diagram = element?.closest(".cm-mermaid") as (HTMLElement & { expand?: (() => void) | null }) | null;
    const edit = (action: EditAction) => run("editAction", action);
    const actions: ContextActions = {
      replaceMisspelling: (word) => run("replaceMisspelling", word),
      addToDictionary: (word) => {
        void call("addToDictionary", word).then(() => {
          // Chromium only re-checks text it's told to: toggling spellcheck clears the stale underline.
          if (!(focused instanceof HTMLElement)) return;
          const wasOn = focused.spellcheck;
          focused.spellcheck = false;
          requestAnimationFrame(() => (focused.spellcheck = wasOn));
        });
      },
      openLink: (link, newTab) => run("openLink", link, newTab),
      openUrl: (url) => host.postEditor({ type: "openURL", url }),
      copyText: (text) => void navigator.clipboard.writeText(text),
      searchTag: (tag) => this.showQuickOpen(`#${tag}`),
      expandDiagram: () => diagram?.expand?.(),
      copyDiagram: () => void copyDiagram(diagram),
      copyImage: () => run("copyImageAt", params.x, params.y),
      openImage: (src) => run("openImage", src),
      edit,
      copyMarkdown: () => editor()?.run("copyMarkdown"),
      pastePlainText: () => {
        if (!editor()?.run("pastePlainText")) edit("pasteAndMatchStyle");
      },
      selectAll: () => {
        const content = element?.closest(".cm-content");
        if (target.inEditor && !params.isEditable && content) window.getSelection()?.selectAllChildren(content);
        else edit("selectAll");
      },
    };
    const format = FORMAT_COMMANDS.flatMap(({ id, label }) => {
      const command = commandById.get(id);
      return command ? [{ label, shortcut: command.shortcut, run: command.run }] : [];
    });
    const entries = buildContextMenu(params, target, actions, format);
    if (!entries.length) return;
    menu.open(entries, last?.clientX ?? params.x, last?.clientY ?? params.y, { onClose: restoreFocus });
  }

  showQuickOpen(query = "") {
    if (!this.vault && !query.startsWith(">")) return;
    this.quickOpen = { query, mode: query.startsWith(">") ? "commands" : "notes" };
  }

  showCommandPalette() {
    this.quickOpen = { query: ">", mode: "commands" };
  }

  showSearch(query?: string) {
    if (!this.vault) return;
    this.sidebarMode = "search";
    if (!this.settings.showSidebar) this.setSetting("showSidebar", true);
    if (query !== undefined) this.searchText = query;
    this.searchFocusRequest++;
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    // Optimistic, so toggles feel instant; main pushes the sanitized result.
    this.state.settings = { ...this.state.settings, [key]: value };
    run("setSetting", key, value);
  }

  toggleReadingView() {
    const s = this.settings;
    this.setSetting("editorMode", s.editorMode === "reading" ? s.lastEditingMode : "reading");
  }

  toggleSourceMode() {
    this.setSetting("editorMode", this.settings.editorMode === "source" ? "livePreview" : "source");
  }
}

export const app = new AppStore();

/** What a right-click landed on, read from the DOM (see contextMenu.ts). */
function describeTarget(element: Element | null): ContextTarget {
  // The editor's text, not its find panel or a field inside it.
  if (!element || element.closest("input, textarea, select") || !element.closest("#editor .cm-content")) return { inEditor: false };
  const target: ContextTarget = { inEditor: true };
  const data = (selector: string, key: string) => (element.closest(selector) as HTMLElement | null)?.dataset[key] || undefined;
  const wikilink = data(".cm-wikilink[data-target]", "target");
  const url = data(".cm-md-link[data-href]", "href");
  const tag = data(".cm-tag[data-tag]", "tag");
  if (wikilink) target.wikilink = wikilink;
  if (url) target.url = url;
  if (tag) target.tag = tag;
  const diagram = element.closest(".cm-mermaid") as (HTMLElement & { expand?: (() => void) | null }) | null;
  // Copy Image needs the diagram's source, which only the main editor's text has (not an embed's).
  if (diagram?.expand) target.diagram = { canCopy: diagram.dataset.pos !== undefined && diagram.closest(".cm-editor")?.parentElement?.id === "editor" };
  else if (element instanceof HTMLImageElement && element.src) target.image = element.src;
  return target;
}

/** Puts a Mermaid diagram on the clipboard as a PNG (like the diagram viewer's Copy Image). */
async function copyDiagram(diagram: HTMLElement | null) {
  const draw = (window as { holocronDiagramImage?: (code: string, options: { theme: string }) => Promise<{ dataUrl: string }> }).holocronDiagramImage;
  const code = diagram && mermaidCodeAt(editor()?.getText() ?? "", Number(diagram.dataset.pos));
  if (!draw || !code) return;
  try {
    const { dataUrl } = await draw(code, { theme: document.documentElement.classList.contains("hc-light") ? "light" : "dark" });
    const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  } catch (error) {
    console.warn("Copy image failed:", error);
  }
}
