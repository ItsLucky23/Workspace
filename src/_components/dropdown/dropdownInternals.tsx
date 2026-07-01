/* eslint-disable react-refresh/only-export-components -- shared internals colocated with helpers */
import { faCaretDown } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type DropdownValue = string | number;
export type DropdownSize = "sm" | "md" | "lg" | "xl";
export type DropdownDirection = "up" | "down";

export interface DropdownItem {
  id: string | number;
  value: DropdownValue;
  item?: ReactNode;
  placeholder?: string;
  selectedItem?: ReactNode;
  searchText?: string;
  disabled?: boolean;
}

export interface NormalizedOption {
  key: string;
  value: DropdownValue;
  label: string;
  item: ReactNode;
  selectedItem: ReactNode;
  searchText: string;
  disabled: boolean;
  index: number;
  sourceItem: DropdownItem;
}

const ANIMATION_MS = 200;
const LIST_MAX_HEIGHT = 320;
const SEARCH_SECTION_HEIGHT = 56;
const MENU_VERTICAL_PADDING = 8;
const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 4;

const SIZE_CONFIG: Record<DropdownSize, { minWidthPx: number; triggerWidth: string; option: string; icon: string }> = {
  sm: { minWidthPx: 160, triggerWidth: "w-40", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
  md: { minWidthPx: 220, triggerWidth: "w-[220px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
  lg: { minWidthPx: 320, triggerWidth: "w-80", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
  xl: { minWidthPx: 420, triggerWidth: "w-[420px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
};

const DEFAULT_OPTION_CLASS = SIZE_CONFIG.md.option;
const DEFAULT_ICON_CLASS = SIZE_CONFIG.md.icon;

const isPrimitiveItem = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

export const normalizeOptions = (items: DropdownItem[]): NormalizedOption[] =>
  items.map((item, index) => {
    const rawItem = item.item ?? item.placeholder ?? String(item.value);
    const label = item.placeholder ?? (isPrimitiveItem(rawItem) ? String(rawItem) : String(item.value));

    return {
      key: String(item.id),
      value: item.value,
      label,
      item: rawItem,
      selectedItem: item.selectedItem ?? (isPrimitiveItem(rawItem) ? rawItem : label),
      searchText: item.searchText ?? label,
      disabled: item.disabled ?? false,
      index,
      sourceItem: item,
    };
  });

export const filterOptions = (options: NormalizedOption[], searchValue: string): NormalizedOption[] => {
  const query = searchValue.trim().toLowerCase();
  if (query.length === 0) return options;
  return options.filter((option) =>
    `${option.label} ${option.searchText} ${String(option.value)}`.toLowerCase().includes(query),
  );
};

const hiddenMenuStateClass = (direction: DropdownDirection) =>
  direction === "up"
    ? "opacity-0 scale-95 translate-y-2 pointer-events-none"
    : "opacity-0 scale-95 -translate-y-2 pointer-events-none";

const findFocusableIndex = (options: NormalizedOption[], from: number, direction: 1 | -1): number => {
  if (options.length === 0) return -1;
  for (let step = 0; step < options.length; step++) {
    const idx = (from + direction * step + options.length) % options.length;
    if (!options[idx].disabled) return idx;
  }
  return -1;
};

interface UseDropdownMenuArgs {
  showSearch: boolean;
}

interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

export interface DropdownMenuController {
  isOpen: boolean;
  isMenuMounted: boolean;
  isMenuVisible: boolean;
  isMenuPositionReady: boolean;
  menuDirection: DropdownDirection;
  menuPosition: DropdownPosition;
  listViewportMaxHeight: number;
  searchValue: string;
  setSearchValue: (value: string) => void;
  focusedKey: string | null;
  setFocusedKey: (key: string | null) => void;
  triggerRef: RefObject<HTMLDivElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  toggleDropdown: () => void;
  openDropdown: () => void;
  closeDropdown: () => void;
}

export function useDropdownMenu({ showSearch }: UseDropdownMenuArgs): DropdownMenuController {
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isMenuPositionReady, setIsMenuPositionReady] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [menuDirection, setMenuDirection] = useState<DropdownDirection>("down");
  const [listViewportMaxHeight, setListViewportMaxHeight] = useState(LIST_MAX_HEIGHT);
  const [menuPosition, setMenuPosition] = useState<DropdownPosition>({ top: 0, left: 0, width: 0 });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showAnimationFrameRef = useRef<number | null>(null);

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const searchHeight = showSearch ? SEARCH_SECTION_HEIGHT : 0;
    const listContentHeight = listRef.current?.scrollHeight ?? LIST_MAX_HEIGHT;
    const desiredListHeight = Math.min(LIST_MAX_HEIGHT, listContentHeight);
    const desiredMenuHeight = searchHeight + desiredListHeight + MENU_VERTICAL_PADDING;
    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_PADDING;
    const spaceAbove = rect.top - VIEWPORT_PADDING;

    const direction: DropdownDirection = spaceBelow >= desiredMenuHeight
      ? "down"
      : (spaceAbove >= desiredMenuHeight ? "up" : "down");

    const availableSpace = direction === "up" ? spaceAbove : spaceBelow;
    const availableListHeight = Math.max(1, availableSpace - TRIGGER_GAP - searchHeight - MENU_VERTICAL_PADDING);
    const nextListMaxHeight = Math.min(LIST_MAX_HEIGHT, availableListHeight);
    const maxRenderedMenuHeight = searchHeight + MENU_VERTICAL_PADDING + nextListMaxHeight;
    const measuredHeight = menuRef.current?.offsetHeight;
    const renderedHeight = measuredHeight ? Math.min(measuredHeight, maxRenderedMenuHeight) : maxRenderedMenuHeight;
    const maxTop = viewportHeight - VIEWPORT_PADDING - renderedHeight;

    const top = direction === "up"
      ? Math.max(VIEWPORT_PADDING, rect.top - TRIGGER_GAP - renderedHeight)
      : Math.min(rect.bottom + TRIGGER_GAP, Math.max(VIEWPORT_PADDING, maxTop));

    setMenuDirection(direction);
    setListViewportMaxHeight(nextListMaxHeight);
    setMenuPosition({ top, left: rect.left, width: rect.width });
  }, [showSearch]);

  const cancelPendingFrames = useCallback(() => {
    if (showAnimationFrameRef.current !== null) {
      cancelAnimationFrame(showAnimationFrameRef.current);
      showAnimationFrameRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      globalThis.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const openDropdown = useCallback(() => {
    cancelPendingFrames();
    setSearchValue("");
    setFocusedKey(null);
    setIsMenuMounted(true);
    setIsMenuPositionReady(false);
    setIsOpen(true);
    setIsMenuVisible(false);
  }, [cancelPendingFrames]);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setIsMenuVisible(false);
    setFocusedKey(null);

    if (showAnimationFrameRef.current !== null) {
      cancelAnimationFrame(showAnimationFrameRef.current);
      showAnimationFrameRef.current = null;
    }
    if (closeTimeoutRef.current !== null) {
      globalThis.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = globalThis.setTimeout(() => {
      setIsMenuMounted(false);
      setIsMenuPositionReady(false);
      closeTimeoutRef.current = null;
    }, ANIMATION_MS);
  }, []);

  const toggleDropdown = useCallback(() => {
    if (isOpen) closeDropdown();
    else openDropdown();
  }, [isOpen, openDropdown, closeDropdown]);

  // Outside-click closes — only listen while open.
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeDropdown();
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => { document.removeEventListener("mousedown", handleMouseDown); };
  }, [isOpen, closeDropdown]);

  // Reposition on scroll/resize while menu is mounted.
  useEffect(() => {
    if (!isMenuMounted) return;
    updateMenuPosition();

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isMenuMounted, updateMenuPosition]);

  // First-mount position calc, before paint.
  useLayoutEffect(() => {
    if (!isMenuMounted || !isOpen || isMenuPositionReady) return;
    updateMenuPosition();
    setIsMenuPositionReady(true);
  }, [isMenuMounted, isOpen, isMenuPositionReady, updateMenuPosition]);

  // Trigger the visibility transition once positioned.
  useEffect(() => {
    if (!isMenuMounted || !isOpen || !isMenuPositionReady || isMenuVisible) return;

    showAnimationFrameRef.current = requestAnimationFrame(() => {
      showAnimationFrameRef.current = requestAnimationFrame(() => {
        setIsMenuVisible(true);
        showAnimationFrameRef.current = null;
      });
    });

    return () => {
      if (showAnimationFrameRef.current !== null) {
        cancelAnimationFrame(showAnimationFrameRef.current);
        showAnimationFrameRef.current = null;
      }
    };
  }, [isMenuMounted, isOpen, isMenuPositionReady, isMenuVisible]);

  // Auto-focus the search input.
  useEffect(() => {
    if (!showSearch || !isMenuVisible) return;
    searchInputRef.current?.focus();
  }, [showSearch, isMenuVisible]);

  // Reposition when the rendered list height changes (e.g. after filtering).
  useEffect(() => {
    if (!isMenuMounted) return;
    updateMenuPosition();
  }, [isMenuMounted, searchValue, updateMenuPosition]);

  // Cleanup pending timers/frames on unmount.
  useEffect(() => cancelPendingFrames, [cancelPendingFrames]);

  return {
    isOpen,
    isMenuMounted,
    isMenuVisible,
    isMenuPositionReady,
    menuDirection,
    menuPosition,
    listViewportMaxHeight,
    searchValue,
    setSearchValue,
    focusedKey,
    setFocusedKey,
    triggerRef,
    menuRef,
    listRef,
    searchInputRef,
    toggleDropdown,
    openDropdown,
    closeDropdown,
  };
}

interface DropdownMenuShellProps {
  controller: DropdownMenuController;
  size?: DropdownSize;
  className?: string;
  menuClassName?: string;
  showSearch?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
  triggerLabel: ReactNode;
  hasSelection: boolean;
  filteredOptions: NormalizedOption[];
  /** Called when the user activates an option via Enter or Space. Mouse activation is handled by the wrapper's option click. */
  onActivate?: (option: NormalizedOption) => void;
  /** Key of the option to highlight when the menu opens (e.g. the currently selected option). Falls back to the first focusable option. */
  initialFocusKey?: string | null;
  ariaMultiselectable?: boolean;
  children: (option: NormalizedOption, optionClass: string, isFocused: boolean) => ReactNode;
}

export function DropdownMenuShell({
  controller,
  size,
  className = "",
  menuClassName = "",
  showSearch = false,
  searchPlaceholder = "Search...",
  noResultsText = "No results",
  triggerLabel,
  hasSelection,
  filteredOptions,
  onActivate,
  initialFocusKey,
  ariaMultiselectable,
  children,
}: DropdownMenuShellProps) {
  const sizeConfig = size ? SIZE_CONFIG[size] : undefined;
  const containerWidthClass = sizeConfig ? "inline-flex" : "flex w-full";
  const triggerWidthClass = sizeConfig?.triggerWidth ?? "w-full";
  const optionClass = sizeConfig?.option ?? DEFAULT_OPTION_CLASS;
  const iconClass = sizeConfig?.icon ?? DEFAULT_ICON_CLASS;

  const stateClass = controller.isMenuPositionReady
    ? (controller.isMenuVisible
      ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
      : hiddenMenuStateClass(controller.menuDirection))
    : hiddenMenuStateClass(controller.menuDirection);

  const focusableOptions = useMemo(() => filteredOptions.filter((o) => !o.disabled), [filteredOptions]);

  // Set initial focus when the menu opens.
  useEffect(() => {
    if (!controller.isMenuMounted) return;
    if (controller.focusedKey !== null) return;
    if (focusableOptions.length === 0) return;

    const initial = initialFocusKey
      ? focusableOptions.find((o) => o.key === initialFocusKey)
      : undefined;
    controller.setFocusedKey(initial?.key ?? focusableOptions[0].key);
  }, [controller, focusableOptions, initialFocusKey]);

  // Reset focus when filtering removes the focused option.
  useEffect(() => {
    if (controller.focusedKey === null) return;
    if (filteredOptions.some((o) => o.key === controller.focusedKey)) return;
    controller.setFocusedKey(focusableOptions[0]?.key ?? null);
  }, [controller, filteredOptions, focusableOptions]);

  // Auto-scroll the focused option into view.
  useEffect(() => {
    if (controller.focusedKey === null) return;
    const list = controller.listRef.current;
    if (!list) return;

    const target = list.querySelector(`[data-focus-key="${controller.focusedKey}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [controller.focusedKey, controller.listRef]);

  const moveFocus = useCallback((direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;

    const currentIndex = controller.focusedKey
      ? filteredOptions.findIndex((o) => o.key === controller.focusedKey)
      : -1;

    const startFrom = currentIndex === -1
      ? (direction === 1 ? 0 : filteredOptions.length - 1)
      : currentIndex + direction;

    const next = findFocusableIndex(filteredOptions, startFrom, direction);
    if (next === -1) return;
    controller.setFocusedKey(filteredOptions[next].key);
  }, [controller, filteredOptions]);

  const focusEdge = useCallback((edge: "start" | "end") => {
    if (filteredOptions.length === 0) return;
    const from = edge === "start" ? 0 : filteredOptions.length - 1;
    const direction: 1 | -1 = edge === "start" ? 1 : -1;
    const next = findFocusableIndex(filteredOptions, from, direction);
    if (next === -1) return;
    controller.setFocusedKey(filteredOptions[next].key);
  }, [controller, filteredOptions]);

  const handleMenuKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.closeDropdown();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusEdge("start");
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusEdge("end");
      return;
    }
    if (event.key === "Enter") {
      const focusedOption = filteredOptions.find((o) => o.key === controller.focusedKey);
      if (focusedOption && !focusedOption.disabled) {
        event.preventDefault();
        onActivate?.(focusedOption);
      }
    }
  };

  return (
    <div
      ref={controller.triggerRef}
      className={`relative max-w-full ${containerWidthClass} ${className}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={controller.isOpen}
        aria-haspopup="listbox"
        onClick={controller.toggleDropdown}
        onKeyDown={(event) => {
          if (event.key === "Escape" && controller.isOpen) {
            event.preventDefault();
            controller.closeDropdown();
            return;
          }
          if (controller.isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End" || event.key === "Enter")) {
            handleMenuKeyDown(event);
            return;
          }
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            if (!controller.isOpen) controller.openDropdown();
          }
        }}
        className={`flex min-w-0 items-center justify-between gap-3 rounded-md border border-container1-border
          bg-container1 transition-colors hover:bg-container1-hover cursor-pointer select-none
          px-2.5 py-2 text-sm ${size ? triggerWidthClass : "w-full"}`}
      >
        <div className={`min-w-0 truncate ${hasSelection ? "text-title font-medium" : "text-common"}`}>
          {triggerLabel}
        </div>
        <FontAwesomeIcon
          icon={faCaretDown}
          className={`${iconClass} text-common transition-transform duration-300 ${controller.isOpen ? "rotate-180" : ""}`}
        />
      </div>

      {controller.isMenuMounted && createPortal(
        <div
          ref={controller.menuRef}
          style={{
            top: controller.menuPosition.top,
            left: controller.menuPosition.left,
            width: sizeConfig?.minWidthPx ?? controller.menuPosition.width,
          }}
          className={`fixed z-[9999] rounded-md border border-container1-border bg-container1 shadow-lg
            ${controller.isMenuPositionReady ? "transition duration-200 ease-out" : ""}
            ${controller.menuDirection === "up" ? "origin-bottom" : "origin-top"}
            ${menuClassName} ${stateClass}`}
          onMouseDown={(event) => { event.stopPropagation(); }}
          onClick={(event) => { event.stopPropagation(); }}
          onKeyDown={handleMenuKeyDown}
        >
          {showSearch && (
            <div className="p-2 border-b border-container1-border">
              <input
                ref={controller.searchInputRef}
                value={controller.searchValue}
                onChange={(event) => { controller.setSearchValue(event.target.value); }}
                placeholder={searchPlaceholder}
                className="w-full h-9 rounded-md border border-container2-border bg-container2 px-3 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
                onClick={(event) => { event.stopPropagation(); }}
              />
            </div>
          )}

          <div
            ref={controller.listRef}
            className="flex flex-col overflow-y-auto p-1"
            style={{ maxHeight: controller.listViewportMaxHeight }}
            role="listbox"
            aria-multiselectable={ariaMultiselectable}
          >
            {filteredOptions.map((option) => children(option, optionClass, option.key === controller.focusedKey))}

            {filteredOptions.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-common">{noResultsText}</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
