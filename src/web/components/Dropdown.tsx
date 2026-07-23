import { ChevronDown } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface DropdownOption<T extends string | null> {
  value: T;
  label: string;
}

export interface DropdownProps<T extends string | null> {
  label: string;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}

const DROPDOWN_VIEWPORT_MARGIN = 8;
const DROPDOWN_GAP = 4;
const DROPDOWN_MIN_WIDTH = 160;
const DROPDOWN_MAX_HEIGHT = 280;
const DROPDOWN_FLIP_THRESHOLD = 160;

/** 展示可复用、可键盘操作且不受父级裁剪的自定义下拉。 */
export function Dropdown<T extends string | null>({
  label,
  value,
  options,
  onChange,
  className,
}: DropdownProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const valueId = `${baseId}-value`;
  const listId = `${baseId}-list`;
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [listStyle, setListStyle] = useState<CSSProperties | null>(null);
  const selectedOption = options.find((option) => Object.is(option.value, value));
  const activeOption = options[activeIndex];
  const displayLabel = options.length === 0
    ? "暂无选项"
    : (selectedOption?.label ?? "暂无匹配项");
  const rootClassName = className === undefined ? "dropdown" : `dropdown ${className}`;

  /** 打开列表，并将键盘活动项定位到当前选中值。 */
  const openDropdown = useCallback(() => {
    if (options.length === 0) {
      return;
    }
    const selectedIndex = options.findIndex((option) => Object.is(option.value, value));
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setListStyle(null);
    setIsOpen(true);
  }, [options, value]);

  /** 关闭列表，并按交互来源决定是否恢复触发器焦点。 */
  const closeDropdown = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    setListStyle(null);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  /** 根据触发器和视口空间计算 Portal 列表位置。 */
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (trigger === null || list === null) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN,
    );
    const availableAbove = Math.max(
      0,
      rect.top - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN,
    );
    const contentHeight = Math.min(list.scrollHeight, DROPDOWN_MAX_HEIGHT);
    const openAbove = availableBelow < Math.min(contentHeight, DROPDOWN_FLIP_THRESHOLD)
      && availableAbove > availableBelow;
    const availableHeight = openAbove ? availableAbove : availableBelow;
    const maxHeight = Math.max(0, Math.min(DROPDOWN_MAX_HEIGHT, availableHeight));
    const renderedHeight = Math.min(contentHeight, maxHeight);
    const width = Math.min(
      Math.max(rect.width, DROPDOWN_MIN_WIDTH),
      Math.max(0, window.innerWidth - DROPDOWN_VIEWPORT_MARGIN * 2),
    );
    const left = Math.max(
      DROPDOWN_VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - DROPDOWN_VIEWPORT_MARGIN - width),
    );
    const top = openAbove
      ? Math.max(DROPDOWN_VIEWPORT_MARGIN, rect.top - DROPDOWN_GAP - renderedHeight)
      : rect.bottom + DROPDOWN_GAP;

    setListStyle({ left, top, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, options, updatePosition]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    /** 点击触发器和 Portal 列表之外的区域时关闭列表。 */
    const handleOutsideMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        rootRef.current?.contains(event.target) === true
        || listRef.current?.contains(event.target) === true
      ) {
        return;
      }
      closeDropdown(false);
    };

    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () => document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [closeDropdown, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (options.length === 0) {
      closeDropdown(false);
      return;
    }
    const selectedIndex = options.findIndex((option) => Object.is(option.value, value));
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [closeDropdown, isOpen, options, value]);

  useLayoutEffect(() => {
    if (!isOpen || listStyle === null || activeOption === undefined) {
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-dropdown-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, activeOption, isOpen, listStyle]);

  /** 循环移动键盘活动项。 */
  function moveActiveIndex(offset: number) {
    if (options.length === 0) {
      return;
    }
    setActiveIndex((currentIndex) => {
      const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
      return (normalizedIndex + offset + options.length) % options.length;
    });
  }

  /** 提交键盘活动项，并恢复触发器焦点。 */
  function selectActiveOption() {
    const option = options[activeIndex];
    if (option === undefined) {
      return;
    }
    onChange(option.value);
    closeDropdown(true);
  }

  /** 处理触发器上的完整键盘交互。 */
  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    switch (event.key) {
      case "Enter":
      case " ":
        event.preventDefault();
        if (isOpen) {
          selectActiveOption();
        } else {
          openDropdown();
        }
        break;
      case "ArrowDown":
        event.preventDefault();
        if (isOpen) {
          moveActiveIndex(1);
        } else {
          openDropdown();
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (isOpen) {
          moveActiveIndex(-1);
        } else {
          openDropdown();
        }
        break;
      case "Home":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (isOpen) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeDropdown(true);
        }
        break;
      case "Tab":
        if (isOpen) {
          closeDropdown(false);
        }
        break;
    }
  }

  return (
    <div ref={rootRef} className={rootClassName}>
      <span id={labelId} className="dropdown-label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="dropdown-trigger"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="none"
        aria-readonly="true"
        aria-activedescendant={isOpen && activeOption !== undefined
          ? `${listId}-option-${activeIndex}`
          : undefined}
        disabled={options.length === 0}
        onClick={() => {
          if (isOpen) {
            closeDropdown(false);
          } else {
            openDropdown();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span id={valueId} className="dropdown-value">{displayLabel}</span>
        <ChevronDown
          size={14}
          className={isOpen ? "dropdown-chevron dropdown-chevron--open" : "dropdown-chevron"}
          aria-hidden="true"
        />
      </button>

      {isOpen ? createPortal(
        <div
          ref={listRef}
          id={listId}
          className="dropdown-list"
          role="listbox"
          aria-labelledby={labelId}
          style={listStyle ?? { visibility: "hidden" }}
        >
          {options.map((option, index) => {
            const isSelected = Object.is(option.value, value);
            const isActive = index === activeIndex;
            const optionClassName = [
              "dropdown-option",
              isActive ? "dropdown-option--active" : "",
              isSelected ? "dropdown-option--selected" : "",
            ].filter(Boolean).join(" ");
            return (
              <button
                key={option.value === null ? "value:null" : `value:string:${option.value}`}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                className={optionClassName}
                aria-selected={isSelected}
                data-dropdown-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option.value);
                  closeDropdown(true);
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
