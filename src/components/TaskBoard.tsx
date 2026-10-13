// Board view: one column per status, horizontally scrollable, with native
// drag-and-drop between and within columns. A drop calls Tasks' boardMove so
// manual order is shared with the Tasks plugin's own board.
import { useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { boardColumns, dropNeighbours, STATUS_LABEL, type PanelTask } from "@/lib/tasks-view";
import type { TaskStatus } from "@/lib/today";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./StatusIcon";
import { PriorityDot, StatusMenu } from "./TaskMenus";
import { openTask, RowActions, TaskMeta, type TaskActions } from "./TaskRow";

export interface BoardMove {
  taskId: string;
  status: TaskStatus;
  beforeTaskId: string | null;
  afterTaskId: string | null;
}

interface DropTarget {
  status: TaskStatus;
  index: number;
}

const DRAG_TYPE = "application/x-bb-today-task";

function Card({
  task,
  today,
  showProject,
  actions,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  task: PanelTask;
  today: string;
  showProject: boolean;
  actions: TaskActions;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const navigate = useBbNavigate();
  const closed = task.status === "done" || task.status === "canceled";
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, task.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group cursor-grab rounded-md border border-border/70 bg-background p-2 text-sm shadow-xs active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        <StatusMenu status={task.status} onChange={actions.onStatus} className="-ml-1 -mt-0.5" />
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
          <span className={cn("block leading-5", closed && "text-muted-foreground line-through")}>
            {task.priority !== "none" ? <PriorityDot priority={task.priority} className="mr-1.5 align-middle" /> : null}
            {task.title}
          </span>
        </a>
      </div>
      <div className="mt-1 flex items-end justify-between gap-1 pl-5">
        <TaskMeta task={task} today={today} showProject={showProject} />
        <RowActions task={task} actions={actions} />
      </div>
    </li>
  );
}

export function TaskBoard({
  tasks,
  today,
  showProject,
  actionsFor,
  onMove,
}: {
  tasks: PanelTask[];
  today: string;
  showProject: boolean;
  actionsFor: (task: PanelTask) => TaskActions;
  onMove: (move: BoardMove) => void;
}) {
  const columns = boardColumns(tasks);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);

  const finish = () => {
    setDraggingId(null);
    setTarget(null);
  };
  const drop = (event: React.DragEvent, status: TaskStatus, ids: string[], index: number) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData(DRAG_TYPE) || draggingId;
    finish();
    if (!taskId) return;
    const current = tasks.find((task) => task.id === taskId);
    const position = dropNeighbours(ids, taskId, index);
    // Dropping a card back where it already sits is a no-op.
    if (current?.status === status && ids.indexOf(taskId) === index) return;
    if (current?.status === status && ids.indexOf(taskId) === index - 1) return;
    onMove({ taskId, status, ...position });
  };

  return (
    <div className="flex h-full gap-2 overflow-x-auto overflow-y-hidden px-2 pb-2 pt-2">
      {columns.map((column) => {
        const ids = column.tasks.map((task) => task.id);
        const isTarget = target?.status === column.status;
        return (
          <section
            key={column.status}
            aria-label={STATUS_LABEL[column.status]}
            className={cn(
              "flex h-full w-60 shrink-0 flex-col rounded-lg bg-muted/40",
              isTarget && "ring-1 ring-primary/40",
            )}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              if (target?.status !== column.status || target.index !== ids.length) {
                setTarget({ status: column.status, index: ids.length });
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null);
            }}
            onDrop={(event) => drop(event, column.status, ids, target?.index ?? ids.length)}
          >
            <h3 className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <StatusIcon status={column.status} className="size-3" />
              {STATUS_LABEL[column.status]}
              <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{column.tasks.length}</span>
            </h3>
            <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-1.5 pb-1.5">
              {column.tasks.map((task, index) => (
                <li key={task.id} className="contents">
                  {isTarget && target.index === index && draggingId !== task.id ? <DropLine /> : null}
                  <div
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      const box = event.currentTarget.getBoundingClientRect();
                      const before = event.clientY < box.top + box.height / 2;
                      const next = { status: column.status, index: before ? index : index + 1 };
                      if (target?.status !== next.status || target.index !== next.index) setTarget(next);
                    }}
                    onDrop={(event) => {
                      event.stopPropagation();
                      drop(event, column.status, ids, target?.index ?? index);
                    }}
                  >
                    <Card
                      task={task}
                      today={today}
                      showProject={showProject}
                      actions={actionsFor(task)}
                      dragging={draggingId === task.id}
                      onDragStart={() => setDraggingId(task.id)}
                      onDragEnd={finish}
                    />
                  </div>
                </li>
              ))}
              {isTarget && target.index >= ids.length ? <DropLine /> : null}
              {column.tasks.length === 0 && !isTarget ? (
                <li className="px-1 py-2 text-center text-[11px] text-muted-foreground">Empty</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DropLine() {
  return <li aria-hidden className="h-0.5 shrink-0 rounded bg-primary" />;
}
