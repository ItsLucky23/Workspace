import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useState } from "react";

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

interface DropdownSelectMeta {
  value: DropdownValue;
  index: number;
  label: string;
}

interface DropdownProps {
  items: DropdownItem[];
  onChange?: (item: DropdownItem) => void;
  onSelect?: (meta: DropdownSelectMeta) => void;
  placeholder?: ReactNode;
  value?: DropdownItem;
  defaultValue?: DropdownItem;
  className?: string;
  menuClassName?: string;
  size?: DropdownSize;
  showSearch?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
}

export default function Dropdown({
  items,
  onChange,
  onSelect,
  placeholder,
  value,
  defaultValue,
  className,
  menuClassName,
  size,
  showSearch = false,
  searchPlaceholder,
  noResultsText,
}: DropdownProps) {
  const controller = useDropdownMenu({ showSearch });
  const [internalSelectedItem, setInternalSelectedItem] = useState<DropdownItem | undefined>(defaultValue);

  const isControlled = value !== undefined;
  const selectedItem = isControlled ? value : internalSelectedItem;
  const selectedId = selectedItem?.id;

  const options = normalizeOptions(items);
  if (options.length === 0) return null;

  const filtered = showSearch ? filterOptions(options, controller.searchValue) : options;
  const selectedOption = selectedId === undefined
    ? undefined
    : options.find((option) => option.sourceItem.id === selectedId);

  const handleSelect = (option: NormalizedOption) => {
    if (option.disabled) return;
    if (!isControlled) setInternalSelectedItem(option.sourceItem);
    onChange?.(option.sourceItem);
    onSelect?.({ value: option.value, index: option.index, label: option.label });
    controller.closeDropdown();
  };

  return (
    <DropdownMenuShell
      controller={controller}
      size={size}
      className={className}
      menuClassName={menuClassName}
      showSearch={showSearch}
      searchPlaceholder={searchPlaceholder}
      noResultsText={noResultsText}
      triggerLabel={selectedOption?.selectedItem ?? placeholder}
      hasSelection={selectedOption !== undefined}
      filteredOptions={filtered}
      onActivate={handleSelect}
      initialFocusKey={selectedOption?.key}
    >
      {(option, optionClass, isFocused) => {
        const isSelected = selectedId !== undefined && option.sourceItem.id === selectedId;

        return (
          <div
            key={option.key}
            role="option"
            tabIndex={isFocused ? 0 : -1}
            aria-selected={isSelected}
            aria-disabled={option.disabled}
            data-focus-key={option.key}
            onMouseEnter={() => { if (!option.disabled) controller.setFocusedKey(option.key); }}
            className={`flex w-full items-center justify-between gap-2 rounded-sm text-left transition-colors
              border border-transparent ${optionClass}
              ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
              ${isSelected ? "bg-container2 border-container2-border text-title font-medium" : "text-title"}
              ${isFocused && !isSelected ? "bg-container1-hover" : ""}
              ${isFocused ? "outline-none ring-1 ring-primary/40" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              handleSelect(option);
            }}
          >
            <span className="flex-1 min-w-0">{option.item}</span>
            {isSelected && <FontAwesomeIcon icon={faCheck} className="ml-2 text-xs" />}
          </div>
        );
      }}
    </DropdownMenuShell>
  );
}
