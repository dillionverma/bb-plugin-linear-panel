// Status glyphs in the style of the Tasks plugin: a dashed ring for backlog,
// an empty ring for todo, a filling ring for in progress / in review, and a
// solid disc with a tick or cross for done / canceled.
import type { TaskStatus } from "@/lib/today";
import { cn } from "@/lib/utils";

const TONE: Record<TaskStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  in_progress: "text-amber-500",
  in_review: "text-sky-500",
  done: "text-emerald-500",
  canceled: "text-muted-foreground",
};

export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const ring = (dashed: boolean) => (
    <circle
      cx="7"
      cy="7"
      r="5.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeDasharray={dashed ? "1.8 2" : undefined}
    />
  );
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn("size-3.5 shrink-0", TONE[status], className)}>
      {status === "backlog" ? ring(true) : null}
      {status === "todo" ? ring(false) : null}
      {status === "in_progress" ? (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z" fill="currentColor" />
        </>
      ) : null}
      {status === "in_review" ? (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 1 1 6.99 2.4 Z" fill="currentColor" />
        </>
      ) : null}
      {status === "done" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.4 7.2 l1.8 1.8 3.4-3.8" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
      {status === "canceled" ? (
        <>
          <circle cx="7" cy="7" r="6" fill="currentColor" />
          <path d="M4.8 4.8 l4.4 4.4 M9.2 4.8 l-4.4 4.4" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}
