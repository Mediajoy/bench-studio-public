import React, { useEffect, useRef, useState } from "react";

// Extracted from PromptBar.jsx (was a local, unexported function) so
// TopBar's client selector can reuse the same trigger/popover/keyboard-nav
// behavior instead of a second implementation. Pure move — no behavior
// change from the original.
export default function MenuSelect({ value, options, onChange, placeholder, ariaLabel, className = "" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => String(option.value) === String(value)));
  const selected = options.find((option) => String(option.value) === String(value));

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  function toggle() {
    setActive(selectedIndex);
    setOpen((current) => !current);
  }

  function choose(option) {
    onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + options.length) % options.length;
      });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && open) {
      event.preventDefault();
      choose(options[active]);
    }
  }

  return (
    <div ref={rootRef} className={`menu-select${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="menu-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label ?? placeholder}</span>
        <i className="menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-popover" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={String(option.value) === String(value)}
              className={`menu-option${String(option.value) === String(value) ? " selected" : ""}${active === index ? " active" : ""}`}
              key={String(option.value)}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {String(option.value) === String(value) && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
