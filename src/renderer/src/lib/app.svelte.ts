// The renderer's view of the app: the latest state snapshot pushed by the
// main process, plus UI-only state (palettes, sidebar mode, focus mode…).

import type { AppState, EditorMessage, TreeNode, UiRequest } from "@shared/ipc";
import { defaultSettings, type Settings } from "@shared/settings";
import { call, host, run } from "./host";

class AppStore {
  state = $state<AppState>({
    vault: null,
    recentVaults: [],
    settings: defaultSettings,
    errorMessage: null,
    version: "",
    isDark: true,
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
      case "beep":
        break;
    }
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
