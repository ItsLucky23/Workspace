import { faCaretDown, faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useEffect } from "react";

interface DropdownProps {
  items: any[];
  itemsPlaceholder?: string[]; // The nice text (e.g., "Open")
  onChange?: (value: any) => void;
  placeholder?: string; // The text to show when nothing is selected
  value?: any;    // The actual code value (e.g., "OPEN")
  className?: string; // Allow custom classes from parent
}

export default function Dropdown({
  items,
  itemsPlaceholder,
  onChange = () => {},
  placeholder,
  value,
  className = "",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownRef]);

  if (!items || items.length === 0) return null;

  const getDisplayLabel = (val: any) => {
    const index = items.indexOf(val);
    if (index !== -1 && itemsPlaceholder && itemsPlaceholder[index]) {
      return itemsPlaceholder[index];
    }
    return val;
  };

  const isValueSelected = value !== undefined && value !== null && items.includes(value);
  const currentLabel = isValueSelected ? getDisplayLabel(value) : placeholder;

  return (
    <div
      ref={dropdownRef}
      className={`
        dropdown
        relative flex items-center justify-between gap-3 
        p-2 min-w-[140px] cursor-pointer select-none rounded-md 
        bg-background2 transition-colors hover:bg-accent/10
        ${className}
      `}
      onClick={() => setIsOpen((prev) => !prev)}
    >
      {/* Current Selection / Title */}
      <span className={`text-sm ${!isValueSelected ? "text-muted-foreground" : "font-medium"}`}>
        {currentLabel}
      </span>

      <FontAwesomeIcon
        icon={faCaretDown}
        className={`text-xs text-muted-foreground transition-transform duration-300 ${
          isOpen ? "rotate-180" : ""
        }`}
      />

      {/* Dropdown Menu */}
      <div
        className={`
          absolute left-0 top-full z-50 mt-1 w-full min-w-[140px] origin-top rounded-md 
          border border-border2 bg-background2 shadow-lg 
          transition-all duration-200 ease-out
          ${isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-2 pointer-events-none"}
        `}
      >
        <div className="flex flex-col p-1 max-h-60 overflow-y-auto">
          {items.map((item, index) => {
            const isSelected = item === value;
            const label = itemsPlaceholder ? itemsPlaceholder[index] : item;

            return (
              <div
                key={index}
                className={`
                  dropdown
                  flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors
                  cursor-pointer
                  ${isSelected ? "bg-accent/20 text-primary font-medium" : "hover:bg-accent/10 text-foreground"}
                `}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(item);
                  setIsOpen(false);
                }}
              >
                <span>{label}</span>
                {/* Optional: Add a checkmark for the selected item */}
                {isSelected && <FontAwesomeIcon icon={faCheck} className="text-xs ml-2" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}