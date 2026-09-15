// List view: tasks grouped by status with collapsible headers.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { groupByStatus, STATUS_LABEL, type PanelTask } from "@/lib/tasks-view";
import type { TaskStatus } from "@/lib/today";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./StatusIcon";
import { TaskRow, type TaskActions } from "./TaskRow";

export function TaskList({
  tasks,
  today,
  showProject,
  actionsFor,
}: {
  tasks: PanelTask[];
  today: string;
  showProject: boolean;
  actionsFor: (task: PanelTask) => TaskActions;
}) {
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(() => new Set(["done", "canceled", "backlog"]));
  const groups = groupByStatus(tasks);
  const toggle = (status: TaskStatus) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });

  return (
    <div className="h-full overflow-y-auto">
      {groups.map((group) => {
        const open = !collapsed.has(group.status);
        return (
          <section key={group.status} className="pb-1">
            <button
              type="button"
              onClick={() => toggle(group.status)}
              aria-expanded={open}
              className="sticky top-0 z-10 flex w-full items-center gap-2 bg-background/95 px-2 pb-1 pt-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur hover:text-foreground"
            >
              <StatusIcon status={group.status} className="size-3" />
              {STATUS_LABEL[group.status]}
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{group.tasks.length}</span>
              <Icon name="ChevronDown" className={cn("ml-auto size-3 transition-transform", !open && "-rotate-90")} />
            </button>
            {open ? (
              <ul className="flex flex-col">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} showProject={showProject} actions={actionsFor(task)} />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
