// One task in the list view: status glyph (click to change), title, meta
// line, and hover actions. Clicking the title opens the original issue.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import type { PanelTask } from "@/lib/tasks-view";
import type { TaskPriority, TaskStatus } from "@/lib/today";
import { cn } from "@/lib/utils";
import { PriorityDot, PriorityMenu, StatusMenu } from "./TaskMenus";

export interface TaskActions {
  onStatus: (status: TaskStatus) => void;
  onPriority: (priority: TaskPriority) => void;
  onPin: (pinned: boolean) => void;
  onTomorrow: () => void;
  onUnschedule: () => void;
}

export function openTask(navigate: ReturnType<typeof useBbNavigate>, task: Pick<PanelTask, "key" | "href">): void {
  // Linear supplies its original URL; Tasks uses its in-app route.
  navigate.openUrl(task.href ?? `/plugins/tasks/tasks/task/${encodeURIComponent(task.key)}`);
}

export function IconButton({
  label,
  onClick,
  icon,
  active,
}: {
  label: string;
  onClick: () => void;
  icon: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground",
        active && "text-primary",
      )}
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

/** Due date text and tone relative to today. */
export function dueLabel(dueDate: string | null, today: string, closed: boolean): { text: string; overdue: boolean } | null {
  if (dueDate === null) return null;
  const overdue = !closed && dueDate < today;
  return { text: dueDate === today ? "today" : dueDate, overdue };
}

export function TaskMeta({ task, today, showProject }: { task: PanelTask; today: string; showProject: boolean }) {
  const closed = task.status === "done" || task.status === "canceled";
  const due = dueLabel(task.dueDate, today, closed);
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span className="font-mono">{showProject ? task.key : task.key.slice(task.projectPrefix.length + 1)}</span>
      {due !== null ? <span className={cn(due.overdue && "text-destructive")}>{due.text}</span> : null}
      {task.pinned ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1" title="Pinned to today">
          <Icon name="Pin" className="size-2.5" />
          today
        </span>
      ) : null}
      {task.agentsWorking > 0 ? (
        <span className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400" title="An agent is working on this">
          <Icon name="Bot" className="size-2.5" />
          {task.agentsWorking}
        </span>
      ) : null}
      {task.labels.map((label) => (
        <span key={label} className="rounded bg-muted px-1">
          {label}
        </span>
      ))}
    </span>
  );
}

export function RowActions({ task, actions }: { task: PanelTask; actions: TaskActions }) {
  const closed = task.status === "done" || task.status === "canceled";
  return (
    <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <PriorityMenu
        priority={task.priority}
        onChange={actions.onPriority}
        trigger={
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex size-6 items-center justify-center rounded hover:bg-state-hover"
          >
            <PriorityDot priority={task.priority} className="size-2" />
          </button>
        }
      />
      <IconButton label={task.pinned ? "Unpin" : "Pin to today"} icon="Pin" active={task.pinned} onClick={() => actions.onPin(!task.pinned)} />
      {closed ? null : task.dueDate === null ? (
        <IconButton label="Due tomorrow" icon="CalendarClock" onClick={actions.onTomorrow} />
      ) : (
        <>
          <IconButton label="Push to tomorrow" icon="CalendarClock" onClick={actions.onTomorrow} />
          <IconButton label="Remove due date" icon="CalendarX" onClick={actions.onUnschedule} />
        </>
      )}
    </span>
  );
}

export function TaskRow({
  task,
  today,
  showProject,
  actions,
}: {
  task: PanelTask;
  today: string;
  showProject: boolean;
  actions: TaskActions;
}) {
  const navigate = useBbNavigate();
  const closed = task.status === "done" || task.status === "canceled";
  return (
    <li className="group flex items-start gap-1.5 px-2 py-1.5 text-sm hover:bg-state-hover">
      <StatusMenu status={task.status} onChange={actions.onStatus} className="mt-px" />
      <a
        href={task.href ?? `/plugins/tasks/tasks/task/${encodeURIComponent(task.key)}`}
        target={task.href?.startsWith("https://") ? "_blank" : undefined}
        rel="noopener noreferrer"
        onClick={(event) => {
          if (task.href?.startsWith("https://")) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openTask(navigate, task);
        }}
        className="min-w-0 flex-1 text-left hover:underline"
      >
        <span className={cn("block truncate leading-5", closed && "text-muted-foreground line-through")}>
          {task.priority !== "none" ? <PriorityDot priority={task.priority} className="mr-1.5 align-middle" /> : null}
          {task.title}
        </span>
        <TaskMeta task={task} today={today} showProject={showProject} />
      </a>
      <RowActions task={task} actions={actions} />
    </li>
  );
}
