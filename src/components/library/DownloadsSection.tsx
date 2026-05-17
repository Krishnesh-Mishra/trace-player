import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Download } from "lucide-react";

interface Props {
  onOpen: () => void;
}

export default function DownloadsSection({ onOpen }: Props) {
  const [count, setCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => {
      invoke<unknown[]>("list_downloads")
        .then((dls) => setCount(dls.length))
        .catch(() => {});
    };
    poll();
    intervalRef.current = setInterval(poll, 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <div className="px-3 pt-3 pb-2 mt-auto">
      <button
        onClick={onOpen}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px]
                   text-white/50 hover:text-white/70 hover:bg-white/5
                   cursor-pointer transition-colors duration-100"
      >
        <Download className="w-4 h-4 shrink-0" />
        Downloads
        {count > 0 && (
          <span className="ml-auto text-[10px] bg-white/15 text-white/80 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
