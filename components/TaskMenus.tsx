// Small dropdowns shared by the list row and the board card: change status,
// change priority, and the row's overflow actions.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import type { TaskPriority, TaskStatus } from "@/lib/today";
import { ALL_PRIORITIES, ALL_STATUSES, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/tasks-view";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/tooltip";
import { StatusIcon } from "./StatusIcon";

export const PRIORITY_DOT: Record<TaskPriority, string | null> = {
  urgent: "bg-destructive",
  high: "bg-orange-500",
  medium: "bg-amber-400",
  low: "bg-sky-400",
  none: null,
};

const CONTENT_CLASS =
  "z-50 min-w-40 rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md";
const ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 outline-none data-[highlighted]:bg-state-hover";

export function Menu({
  trigger,
  children,
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <Hint label={label}>
        <DropdownMenu.Trigger asChild aria-label={label}>
          {trigger}
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={4} className={CONTENT_CLASS} onClick={(e) => e.stopPropagation()}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, active }: { children: ReactNode; onSelect: () => void; active?: boolean }) {
  return (
    <DropdownMenu.Item className={cn(ITEM_CLASS, active && "font-medium")} onSelect={onSelect}>
      {children}
    </DropdownMenu.Item>
  );
}

export function StatusMenu({
  status,
  onChange,
  className,
}: {
  status: TaskStatus;
  onChange: (status: TaskStatus) => void;
  className?: string;
}) {
  return (
    <Menu
      label={`Status: ${STATUS_LABEL[status]}`}
      trigger={
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn("flex size-6 items-center justify-center rounded hover:bg-state-hover", className)}
        >
          <StatusIcon status={status} />
        </button>
      }
    >
      {ALL_STATUSES.map((value) => (
        <MenuItem key={value} active={value === status} onSelect={() => onChange(value)}>
          <StatusIcon status={value} />
          {STATUS_LABEL[value]}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function PriorityDot({ priority, className }: { priority: TaskPriority; className?: string }) {
  const dot = PRIORITY_DOT[priority];
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 rounded-full", dot ?? "border border-muted-foreground/60", className)}
    />
  );
}

export function PriorityMenu({
  priority,
  onChange,
  trigger,
}: {
  priority: TaskPriority;
  onChange: (priority: TaskPriority) => void;
  trigger: ReactNode;
}) {
  return (
    <Menu label={`Priority: ${PRIORITY_LABEL[priority]}`} trigger={trigger}>
      {ALL_PRIORITIES.map((value) => (
        <MenuItem key={value} active={value === priority} onSelect={() => onChange(value)}>
          <PriorityDot priority={value} />
          {PRIORITY_LABEL[value]}
        </MenuItem>
      ))}
    </Menu>
  );
}
