import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onClick: () => void;
}

interface Props {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ open, x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const parent = menu.closest(".relative.w-\\[90vw\\]") || document.body;
    const parentRect = parent.getBoundingClientRect();

    if (rect.right > parentRect.right) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > parentRect.bottom) {
      menu.style.top = `${y - rect.height}px`;
    }
  }, [open, x, y]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          className="fixed z-[100] min-w-[180px] py-1 bg-[#1a1a1a]  
                     rounded-lg shadow-xl shadow-black/50 backdrop-blur-sm origin-top-left"
          style={{ left: x, top: y }}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.1  }}
        >
          {items.map((item, i) =>
            item.separator ? (
              <div key={i} className="h-px bg-white/8 my-1 mx-2" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick();
                    onClose();
                  }
                }}
                disabled={item.disabled}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px]
                           transition-colors duration-75 cursor-pointer
                           ${item.disabled ? "text-white/20 cursor-default" : ""}
                           ${item.danger && !item.disabled ? "text-red-400 hover:bg-red-500/15" : ""}
                           ${!item.danger && !item.disabled ? "text-white/80 hover:bg-white/10" : ""}`}
              >
                {item.icon && (
                  <span className="w-4 h-4 flex items-center justify-center shrink-0 opacity-70">
                    {item.icon}
                  </span>
                )}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="text-[10px] text-white/30 ml-4">{item.shortcut}</span>
                )}
              </button>
            ),
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
