// Popup menus: context menus, dropdowns and the menu bar all open one
// shared `PopupMenu` (components/PopupMenu.svelte), so only one is ever open.

export interface MenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** A submenu instead of an action. */
  items?: MenuEntry[];
  run?: () => void;
}

/** An item, or "-" for a separator. */
export type MenuEntry = MenuItem | "-";

interface OpenMenu {
  entries: MenuEntry[];
  x: number;
  y: number;
  /** For menu-bar menus: lets ←/→ move to the neighbouring menu. */
  onNavigate?: (direction: -1 | 1) => void;
  onClose?: () => void;
}

class MenuStore {
  current = $state<OpenMenu | null>(null);

  open(entries: MenuEntry[], x: number, y: number, options: Pick<OpenMenu, "onNavigate" | "onClose"> = {}) {
    this.current?.onClose?.();
    this.current = { entries, x, y, ...options };
  }

  /** Opens below an element (dropdowns, menu-bar titles). */
  openBelow(element: Element, entries: MenuEntry[], options: Pick<OpenMenu, "onNavigate" | "onClose"> = {}) {
    const rect = element.getBoundingClientRect();
    this.open(entries, rect.left, rect.bottom + 2, options);
  }

  /** Opens at the pointer for a contextmenu event. */
  openAt(event: MouseEvent, entries: MenuEntry[]) {
    event.preventDefault();
    event.stopPropagation();
    this.open(entries, event.clientX, event.clientY);
  }

  close() {
    const menu = this.current;
    this.current = null;
    menu?.onClose?.();
  }
}

export const menu = new MenuStore();
