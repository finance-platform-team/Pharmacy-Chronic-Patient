import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface PopoverPosition {
  top: number;
  left: number;
}

/**
 * Open/close + positioning for a portal-rendered popover anchored under a
 * trigger element — same approach as ComboBox/LookupInput's portal menus
 * (fixed-position, follows scroll/resize), plus closing on outside click or
 * Escape. `width` is the popover's expected width, used to keep it on screen.
 */
export function usePopover(width: number) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    function update() {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxLeft = window.innerWidth - Math.min(width, window.innerWidth - 16) - 8;
      setPosition({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, maxLeft)) });
    }

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, width]);

  return { open, setOpen, position, triggerRef, popoverRef };
}
