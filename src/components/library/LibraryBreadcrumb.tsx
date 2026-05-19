import { ChevronRight } from "lucide-react";
import type { BreadcrumbEntry } from "./types";

interface Props {
  entries: BreadcrumbEntry[];
  onNavigate: (id: number | null) => void;
}

export default function LibraryBreadcrumb({ entries, onNavigate }: Props) {
  return (
    <div className="flex items-center gap-1 px-4 py-2 text-[11px] text-[var(--np-text-tertiary)]">
      {entries.map((entry, i) => (
        <span key={entry.id ?? "root"} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--np-text-muted)]" />}
          <button
            onClick={() => onNavigate(entry.id)}
            className={`hover:text-[var(--np-text)] transition-colors duration-100 cursor-pointer ${
              i === entries.length - 1
                ? "text-[var(--np-text)] font-medium"
                : "text-[var(--np-text-tertiary)]"
            }`}
          >
            {entry.name}
          </button>
        </span>
      ))}
    </div>
  );
}
