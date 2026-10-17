<!-- The vault's folders and notes (UI-10…UI-13): the "Files" header, the visible
     rows as a flat list, keyboard navigation, inline rename, context menus and
     drag and drop (UI-12). Expanded folders are remembered per vault. -->
<script lang="ts">
  import { tick, untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { ArrowUpDown } from "@lucide/svelte";
  import type { TreeNode } from "@shared/ipc";
  import type { FileSort } from "@shared/settings";
  import { naturalCompare } from "@core/paths";
  import { app } from "../../lib/app.svelte";
  import { run } from "../../lib/host";
  import { menu, type MenuEntry } from "../../lib/menu.svelte";
  import { FILE_SORTS } from "../../lib/commands";
  import FileRow from "./FileRow.svelte";

  const PATHS_TYPE = "application/x-holocron-paths";

  interface Row {
    node: TreeNode;
    depth: number;
  }

  let list = $state<HTMLDivElement>();
  let expanded = $state<Set<string>>(loadExpanded(app.vault?.root ?? ""));
  /** Selection the user just made, shown until main confirms it. */
  let pendingSelection = $state<string | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let contextPath = $state<string | null>(null);
  /** The folder a drop would land in ("" = vault root), or null. */
  let dropFolder = $state<string | null>(null);
  /** Paths being dragged from this tree (data can't be read during dragover). */
  let dragged: string[] | null = null;
  let expandTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverFolder: string | null = null;
  /** Row index the Shift+arrow selection currently reaches, or null. */
  let rangeEdge: number | null = null;

  const root = $derived(app.vault?.root ?? "");
  const noteCount = $derived(app.vault?.noteCount ?? 0);
  const serverSelection = $derived(app.vault?.selection ?? null);
  const renaming = $derived(app.vault?.renaming ?? null);
  const selection = $derived(pendingSelection ?? serverSelection);

  /** Rows in the chosen order (UI-10a); folders stay first, as main sends them. */
  const sort = $derived(app.settings.fileSort);
  const rows = $derived.by(() => {
    const out: Row[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of sorted(nodes, sort)) {
        out.push({ node, depth });
        if (node.isDir && node.children && expanded.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(app.tree, 0);
    return out;
  });

  function sorted(nodes: TreeNode[], order: FileSort): TreeNode[] {
    if (order === "name") return nodes;
    const byName = (a: TreeNode, b: TreeNode) => naturalCompare(a.name, b.name);
    const byTime = (key: "modified" | "created") => (a: TreeNode, b: TreeNode) => (b[key] ?? 0) - (a[key] ?? 0) || byName(a, b);
    const compare = order === "nameDesc" ? (a: TreeNode, b: TreeNode) => byName(b, a) : byTime(order);
    return [...nodes].sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : compare(a, b)));
  }

  function openSortMenu(event: MouseEvent) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    menu.open(
      FILE_SORTS.map(({ value, label }) => ({ label, checked: sort === value, run: () => app.setSetting("fileSort", value) })),
      rect.left,
      rect.bottom + 2,
    );
  }

  // MARK: Multi-selection (UI-10b)
  //
  // Main knows one selected item (the note it opens); the tree adds a set of
  // extra items for Ctrl/Shift clicks, so several can be moved or deleted at
  // once. Any plain click or a change of vault clears it.
  const extra = new SvelteSet<string>();
  /** Where a Shift range starts: the last item clicked without Shift. */
  let anchor: string | null = null;
  const selectedPaths = $derived.by(() => {
    const all = new Set(extra);
    if (selection) all.add(selection);
    return all;
  });
  const multiple = $derived(selectedPaths.size > 1);

  $effect(() => {
    void root;
    void app.tree;
    untrack(() => {
      // Items that vanished (moved, deleted) drop out of the selection.
      const present = new Set(rows.map((row) => row.node.path));
      for (const path of extra) if (!present.has(path)) extra.delete(path);
    });
  });

  function clearExtra() {
    if (extra.size) extra.clear();
  }

  function selectOnly(path: string) {
    clearExtra();
    anchor = path;
    select(path);
  }

  function toggleExtra(path: string) {
    anchor = path;
    if (path === selection) {
      // Unselecting the primary item: keep the others, main keeps showing the note.
      if (extra.size) {
        const [next] = extra;
        extra.delete(next!);
        for (const other of [...extra]) if (other === next) extra.delete(other);
        pendingSelection = next!;
        run("select", next!);
      }
      return;
    }
    if (extra.has(path)) extra.delete(path);
    else extra.add(path);
  }

  function selectRange(to: string) {
    const from = anchor ?? selection;
    const a = rows.findIndex((row) => row.node.path === from);
    const b = rows.findIndex((row) => row.node.path === to);
    if (a < 0 || b < 0) return selectOnly(to);
    clearExtra();
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      const path = rows[i]!.node.path;
      if (path !== selection) extra.add(path);
    }
  }

  /** What a command from a row acts on: the whole selection when the row is part of it. */
  function targets(path: string): string[] {
    return selectedPaths.has(path) && multiple ? [...selectedPaths] : [path];
  }

  const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

  // MARK: Expanded folders

  function storageKey(vaultRoot: string) {
    return `holocron.expandedFolders:${vaultRoot}`;
  }

  function loadExpanded(vaultRoot: string): Set<string> {
    if (!vaultRoot) return new Set();
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey(vaultRoot)) ?? "[]");
      return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  }

  function setExpanded(next: Set<string>) {
    expanded = next;
    try {
      const folders = new Set<string>();
      const collect = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (!node.isDir) continue;
          folders.add(node.path);
          if (node.children) collect(node.children);
        }
      };
      collect(app.tree);
      localStorage.setItem(storageKey(root), JSON.stringify([...next].filter((path) => folders.has(path))));
    } catch {
      // Not important.
    }
  }

  function setFolderExpanded(path: string, open: boolean) {
    if (expanded.has(path) === open) return;
    const next = new Set(expanded);
    if (open) next.add(path);
    else next.delete(path);
    setExpanded(next);
  }

  $effect(() => {
    const vaultRoot = root;
    untrack(() => (expanded = loadExpanded(vaultRoot)));
  });

  /** Expands the folders above `path` and scrolls its row into view. */
  function reveal(path: string | null) {
    if (!path) return;
    const parts = path.split("/");
    const missing: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      const ancestor = parts.slice(0, i).join("/");
      if (!expanded.has(ancestor)) missing.push(ancestor);
    }
    if (missing.length) setExpanded(new Set([...expanded, ...missing]));
    void tick().then(() => rowElement(path)?.scrollIntoView({ block: "nearest" }));
  }

  function rowElement(path: string) {
    return list?.querySelector<HTMLElement>(`.row[data-path="${CSS.escape(path)}"]`) ?? null;
  }

  $effect(() => {
    const path = serverSelection;
    untrack(() => {
      if (pendingSelection === path) pendingSelection = null;
      reveal(path);
    });
  });

  $effect(() => {
    const path = renaming;
    untrack(() => reveal(path));
  });

  $effect(() => () => {
    clearTimeout(pendingTimer);
    clearTimeout(expandTimer);
  });

  // MARK: Selection and keys

  function select(path: string) {
    if (path === selection) return;
    pendingSelection = path;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => (pendingSelection = null), 1000);
    run("select", path);
  }

  function onRowClick(event: MouseEvent, node: TreeNode) {
    if (renaming === node.path) return;
    if (event.ctrlKey) {
      toggleExtra(node.path);
      return;
    }
    if (event.shiftKey) {
      selectRange(node.path);
      return;
    }
    selectOnly(node.path);
    if (node.isDir) setFolderExpanded(node.path, !expanded.has(node.path));
  }

  function onRowAuxClick(event: MouseEvent, node: TreeNode) {
    // Middle-click opens a note in a new tab.
    if (event.button === 1 && !node.isDir) {
      event.preventDefault();
      run("open", node.path, true);
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if ((event.target as Element).closest("input") || renaming || event.altKey || event.metaKey) return;
    if (event.ctrlKey) {
      // Ctrl+A selects every visible row.
      if (event.key.toLowerCase() === "a" && !event.shiftKey) {
        event.preventDefault();
        clearExtra();
        for (const row of rows) if (row.node.path !== selection) extra.add(row.node.path);
      }
      return;
    }
    const index = rows.findIndex((row) => row.node.path === selection);
    const current = index >= 0 ? rows[index] : null;
    const go = (i: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!row) return;
      // Shift+arrows grow the selection from the anchor (the primary item stays put).
      if (event.shiftKey && current) {
        const a = rows.findIndex((r) => r.node.path === (anchor ?? selection));
        const edge = rangeEdge ?? index;
        const next = Math.max(0, Math.min(rows.length - 1, i === index + 1 ? edge + 1 : i === index - 1 ? edge - 1 : i));
        rangeEdge = next;
        clearExtra();
        for (let j = Math.min(a, next); j <= Math.max(a, next); j++) {
          const path = rows[j]!.node.path;
          if (path !== selection) extra.add(path);
        }
        rowElement(rows[next]!.node.path)?.scrollIntoView({ block: "nearest" });
        return;
      }
      rangeEdge = null;
      selectOnly(row.node.path);
    };
    switch (event.key) {
      case "ArrowDown":
        go(index < 0 ? 0 : index + 1);
        break;
      case "ArrowUp":
        go(index < 0 ? rows.length - 1 : index - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(rows.length - 1);
        break;
      case "Escape":
        if (!multiple) return;
        clearExtra();
        rangeEdge = null;
        break;
      case "ArrowRight":
        if (current?.node.isDir) {
          if (!expanded.has(current.node.path)) setFolderExpanded(current.node.path, true);
          else if (current.node.children?.length) go(index + 1);
        }
        break;
      case "ArrowLeft":
        if (current?.node.isDir && expanded.has(current.node.path)) setFolderExpanded(current.node.path, false);
        else if (current && current.depth > 0) select(parentOf(current.node.path));
        break;
      case "Enter":
      case "F2":
        if (!current) return;
        run("startRenaming", current.node.path);
        break;
      case "Delete":
        if (!current && !multiple) return;
        run("requestDeletion", [...selectedPaths]);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  function commitRename(node: TreeNode, name: string) {
    if (name === node.name) run("startRenaming", null);
    else run("commitRename", node.path, name);
    list?.focus();
  }

  function cancelRename() {
    run("startRenaming", null);
    list?.focus();
  }

  // MARK: Context menus

  function openContextMenu(event: MouseEvent, entries: MenuEntry[], path: string | null) {
    event.preventDefault();
    event.stopPropagation();
    contextPath = path;
    menu.open(entries, event.clientX, event.clientY, {
      onClose: () => {
        if (contextPath === path) contextPath = null;
      },
    });
  }

  function rowMenu(node: TreeNode): MenuEntry[] {
    const path = node.path;
    const items = targets(path);
    if (items.length > 1) {
      return [
        { label: `Move ${items.length} Items to Recycle Bin`, destructive: true, run: () => run("requestDeletion", items) },
      ];
    }
    const trash: MenuEntry[] = [
      { label: "Show in File Explorer", run: () => run("showInFolder", path) },
      "-",
      { label: "Move to Recycle Bin", destructive: true, run: () => run("requestDeletion", [path]) },
    ];
    if (node.isDir) {
      return [
        { label: "Rename", shortcut: "F2", run: () => run("startRenaming", path) },
        "-",
        {
          label: "New Note in Folder",
          run: () => {
            setFolderExpanded(path, true);
            run("createNote", path);
          },
        },
        {
          label: "New Folder Inside",
          run: () => {
            setFolderExpanded(path, true);
            run("createFolder", path);
          },
        },
        "-",
        ...trash,
      ];
    }
    return [
      { label: "Open in New Tab", run: () => run("open", path, true) },
      "-",
      { label: "Rename", shortcut: "F2", run: () => run("startRenaming", path) },
      { label: "Duplicate", run: () => run("duplicate", path) },
      "-",
      ...trash,
    ];
  }

  const headerMenu: MenuEntry[] = [
    { label: "New Note", run: () => run("createNote", "") },
    { label: "New Folder", run: () => run("createFolder", "") },
  ];

  // MARK: Drag and drop

  function onDragStart(event: DragEvent, node: TreeNode) {
    if (!event.dataTransfer) return;
    // Dragging one of several selected items drags them all (an item inside a selected folder isn't repeated).
    const all = targets(node.path);
    dragged = all.filter((path) => !all.some((other) => other !== path && path.startsWith(other + "/")));
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData(PATHS_TYPE, JSON.stringify(dragged));
    if (dragged.length === 1 && !node.isDir) event.dataTransfer.setData("text/plain", `[[${node.path.replace(/\.(md|markdown)$/i, "")}]]`);
  }

  /** The folder a drop on `target` moves into, or null if it isn't a drop target. */
  function folderFor(target: EventTarget | null): string | null {
    const element = (target as Element | null)?.closest?.<HTMLElement>("[data-path]");
    if (!element) return "";
    const path = element.dataset.path ?? "";
    return element.dataset.dir ? path : parentOf(path);
  }

  /** Dropping our own items here would do nothing (or is impossible). */
  function isPointless(folder: string): boolean {
    if (!dragged) return false;
    return dragged.every((path) => folder === path || folder.startsWith(path + "/") || parentOf(path) === folder);
  }

  function setDropFolder(folder: string | null) {
    if (dropFolder === folder) return;
    dropFolder = folder;
  }

  function scheduleAutoExpand(target: EventTarget | null) {
    const element = (target as Element | null)?.closest?.<HTMLElement>(".row[data-dir]");
    const path = element?.dataset.path ?? null;
    if (path === hoverFolder) return;
    hoverFolder = path;
    clearTimeout(expandTimer);
    if (path && !expanded.has(path)) expandTimer = setTimeout(() => setFolderExpanded(path, true), 650);
  }

  function onDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types ?? [];
    const internal = types.includes(PATHS_TYPE);
    if (!internal && !types.includes("Files")) return;
    scheduleAutoExpand(event.target);
    const folder = folderFor(event.target);
    if (folder === null || (internal && isPointless(folder))) {
      event.dataTransfer!.dropEffect = "none";
      setDropFolder(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer!.dropEffect = internal ? "move" : "copy";
    setDropFolder(folder);
  }

  function onDragLeave(event: DragEvent) {
    // Only leaving the whole tree clears the highlight, so moving between rows never flickers.
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget instanceof Node && event.currentTarget.contains(next)) return;
    endDrag();
  }

  function onDrop(event: DragEvent) {
    const folder = dropFolder;
    const transfer = event.dataTransfer;
    endDrag();
    if (folder === null || !transfer) return;
    event.preventDefault();
    let paths: string[] = [];
    const internal = transfer.getData(PATHS_TYPE);
    if (internal) {
      try {
        const value: unknown = JSON.parse(internal);
        if (Array.isArray(value)) paths = value.filter((item): item is string => typeof item === "string");
      } catch {
        return;
      }
    } else {
      paths = [...transfer.files].map((file) => window.holocronHost.pathForFile(file)).filter(Boolean);
    }
    if (paths.length) run("move", paths, folder);
  }

  function endDrag() {
    setDropFolder(null);
    clearTimeout(expandTimer);
    hoverFolder = null;
  }
</script>

<svelte:window ondragend={() => ((dragged = null), endDrag())} />

<div class="file-tree" role="presentation" ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
  <div
    class="header"
    class:drop={dropFolder === ""}
    data-path=""
    data-dir="true"
    title="Drop here to move to the top of the vault"
    role="presentation"
    oncontextmenu={(event) => openContextMenu(event, headerMenu, null)}
  >
    <span class="section-label">Files</span>
    <span class="header-right">
      {#if multiple}<span class="count selected-count">{selectedPaths.size} selected</span>{/if}
      <span class="count">{noteCount.toLocaleString()}</span>
      <button class="sort" class:on={sort !== "name"} title="Sort files" aria-label="Sort files" aria-haspopup="menu" onclick={openSortMenu}>
        <ArrowUpDown size={13} strokeWidth={2} />
      </button>
    </span>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="tree" role="tree" aria-label="Files" tabindex="0" bind:this={list} onkeydown={onKeydown}>
    {#each rows as row (row.node.path)}
      <FileRow
        node={row.node}
        depth={row.depth}
        selected={selectedPaths.has(row.node.path)}
        expanded={row.node.isDir && expanded.has(row.node.path)}
        dropTarget={row.node.isDir && dropFolder === row.node.path}
        contextActive={contextPath === row.node.path}
        renaming={renaming === row.node.path}
        onclick={(event) => onRowClick(event, row.node)}
        onauxclick={(event) => onRowAuxClick(event, row.node)}
        oncontextmenu={(event) => openContextMenu(event, rowMenu(row.node), row.node.path)}
        ondragstart={(event) => onDragStart(event, row.node)}
        oncommit={(name) => commitRename(row.node, name)}
        oncancel={cancelRename}
      />
    {/each}
  </div>
</div>

<style>
  .file-tree {
    display: flex;
    flex-direction: column;
    padding-bottom: 6px;
  }
  .header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin: 2px 6px 2px;
    padding: 0 10px 0 8px;
    border-radius: 6px;
  }
  .header::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 6px;
    border: 1.5px solid rgba(var(--ui-accent-rgb), 0.7);
    background: rgba(var(--ui-accent-rgb), 0.18);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease-out;
  }
  .header.drop::after {
    opacity: 1;
  }
  .count {
    font-size: 11px;
    color: var(--ui-text-3);
    font-variant-numeric: tabular-nums;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .selected-count {
    color: var(--ui-accent);
  }
  .sort {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    margin-right: -4px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-3);
  }
  .sort:hover {
    background: color-mix(in srgb, var(--ui-strong-border) 55%, transparent);
    color: var(--ui-text);
  }
  .sort.on {
    color: var(--ui-accent);
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
    outline: none;
  }
</style>
