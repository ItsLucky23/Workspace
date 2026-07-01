import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useMemo, useState } from "react";

import {
  DropdownMenuShell,
  filterOptions,
  normalizeOptions,
  useDropdownMenu,
  type DropdownItem,
  type DropdownSize,
  type DropdownValue,
  type NormalizedOption,
} from "./dropdownInternals";

export type { DropdownItem } from "./dropdownInternals";

interface MultiSelectToggleMeta {
  value: DropdownValue;
  index: number;
  label: string;
  item: DropdownItem;
  selected: boolean;
  selectedValues: DropdownValue[];
  selectedItems: DropdownItem[];
}

interface MultiSelectDropdownProps {
  items: DropdownItem[];
  onChange?: (items: DropdownItem[]) => void;
  onToggle?: (meta: MultiSelectToggleMeta) => void;
  placeholder?: ReactNode;
  value?: DropdownItem[];
  defaultValue?: DropdownItem[];
  className?: string;
  menuClassName?: string;
  size?: DropdownSize;
  showSearch?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
  selectedCountText?: (count: number) => ReactNode;
  closeOnSelect?: boolean;
}

export default function MultiSelectDropdown({
  items,
  onChange,
  onToggle,
  placeholder,
  value,
  defaultValue,
  className,
  menuClassName,
  size,
  showSearch = false,
  searchPlaceholder,
  noResultsText,
  selectedCountText,
  closeOnSelect = false,
}: MultiSelectDropdownProps) {
  const controller = useDropdownMenu({ showSearch });
  const [internalSelected, setInternalSelected] = useState<DropdownItem[]>(defaultValue ?? []);

  const isControlled = value !== undefined;
  const selectedItems = isControlled ? value : internalSelected;
  const selectedIdSet = useMemo(() => new Set(selectedItems.map((item) => item.id)), [selectedItems]);

  const options = normalizeOptions(items);
  if (options.length === 0) return null;

  const filtered = showSearch ? filterOptions(options, controller.searchValue) : options;

  const handleToggle = (option: NormalizedOption) => {
    if (option.disabled) return;

    const alreadySelected = selectedIdSet.has(option.sourceItem.id);
    const next = alreadySelected
      ? selectedItems.filter((item) => item.id !== option.sourceItem.id)
      : [...selectedItems, option.sourceItem];

    if (!isControlled) setInternalSelected(next);
    onChange?.(next);
    onToggle?.({
      value: option.value,
      index: option.index,
      label: option.label,
      item: option.sourceItem,
      selected: !alreadySelected,
      selectedValues: next.map((item) => item.value),
      selectedItems: next,
    });

    if (closeOnSelect) controller.closeDropdown();
  };

  const selectedCount = selectedItems.length;
  let triggerLabel: ReactNode = placeholder;
  if (selectedCount === 1) {
    const option = options.find((o) => o.sourceItem.id === selectedItems[0].id);
    triggerLabel = option?.selectedItem ?? placeholder;
  } else if (selectedCount > 1) {
    triggerLabel = selectedCountText?.(selectedCount) ?? `${String(selectedCount)} selected`;
  }

  const firstSelectedKey = selectedItems.length > 0 ? String(selectedItems[0].id) : undefined;

  return (
    <DropdownMenuShell
      controller={controller}
      size={size}
      className={className}
      menuClassName={menuClassName}
      showSearch={showSearch}
      searchPlaceholder={searchPlaceholder}
      noResultsText={noResultsText}
      triggerLabel={triggerLabel}
      hasSelection={selectedCount > 0}
      filteredOptions={filtered}
      onActivate={handleToggle}
      initialFocusKey={firstSelectedKey}
      ariaMultiselectable
    >
      {(option, optionClass, isFocused) => {
        const isSelected = selectedIdSet.has(option.sourceItem.id);

        return (
          <div
            key={option.key}
            role="option"
            tabIndex={isFocused ? 0 : -1}
            aria-selected={isSelected}
            aria-disabled={option.disabled}
            data-focus-key={option.key}
            onMouseEnter={() => { if (!option.disabled) controller.setFocusedKey(option.key); }}
            className={`flex w-full items-center gap-2 rounded-sm text-left transition-colors
              border border-transparent ${optionClass}
              ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
              ${isSelected ? "bg-container2 border-container2-border text-title font-medium" : "text-title"}
              ${isFocused && !isSelected ? "bg-container1-hover" : ""}
              ${isFocused ? "outline-none ring-1 ring-primary/40" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              handleToggle(option);
            }}
          >
            <span
              aria-hidden
              className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px]
                transition-colors duration-150
                ${isSelected
                  ? "border-primary-border bg-primary text-title-primary"
                  : "border-container2-border bg-container2"}`}
            >
              <FontAwesomeIcon
                icon={faCheck}
                className={isSelected ? "" : "opacity-0"}
              />
            </span>
            <span className="flex-1 min-w-0">{option.item}</span>
          </div>
        );
      }}
    </DropdownMenuShell>
  );
}
