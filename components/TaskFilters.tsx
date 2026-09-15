// The toolbar: search, list/board toggle, sort, and a filter popover for
// project, status, priority, and labels. Filter state lives in rail-store so
// it survives reloads and is shared with the palette commands.
import * as Popover from "@radix-ui/react-popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/tooltip";
import { rail } from "@/lib/rail-store";
import {
  activeFilterCount,
  ALL_PRIORITIES,
  ALL_STATUSES,
  DEFAULT_FILTERS,
  PRIORITY_LABEL,
  SORTS,
  STATUS_LABEL,
  toggleIn,
  type TaskFilters as Filters,
  type TaskView,
} from "@/lib/tasks-view";
import { cn } from "@/lib/utils";
import type { PanelLabel, PanelProject } from "../server";
import { StatusIcon } from "./StatusIcon";
import { Menu, MenuItem, PriorityDot } from "./TaskMenus";

const SORT_LABEL: Record<Filters["sort"], string> = { manual: "Manual", priority: "Priority", due: "Due date" };

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-state-hover">
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      {children}
    </label>
  );
}

export function TaskFilters({
  filters,
  view,
  source,
  projects,
  labels,
  count,
}: {
  filters: Filters;
  view: TaskView;
  source: "tasks" | "linear";
  projects: PanelProject[];
  labels: PanelLabel[];
  count: number | null;
}) {
  const scopeWord = source === "linear" ? "Team" : "Project";
  const noun = source === "linear" ? "issue" : "task";
  const active = activeFilterCount(filters);
  const labelNames = [...new Set(labels.map((label) => label.name))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 px-2 pb-2 pt-2">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => rail.setFilters({ search: event.target.value })}
            placeholder={`Search ${noun}s`}
            aria-label={`Search ${noun}s`}
            className="h-7 pl-7 pr-6 text-xs"
          />
          {filters.search !== "" ? (
            <Hint label="Clear search">
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => rail.setFilters({ search: "" })}
                className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <Icon name="X" className="size-3" />
              </button>
            </Hint>
          ) : null}
        </div>
        <div role="group" aria-label="View" className="flex shrink-0 items-center rounded-md bg-muted p-0.5">
          {(["list", "board"] as const).map((value) => (
            <Hint key={value} label={value === "list" ? "List view" : "Board view: drag cards between statuses"}>
              <button
                type="button"
                aria-pressed={view === value}
                aria-label={value === "list" ? "List view" : "Board view"}
                onClick={() => rail.setView(value)}
                className={cn(
                  "flex size-6 items-center justify-center rounded text-muted-foreground",
                  view === value && "bg-background text-foreground shadow-xs",
                )}
              >
                <Icon name={value === "list" ? "ListView" : "Columns2"} className="size-3.5" />
              </button>
            </Hint>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Popover.Root modal={false}>
          <Hint label={active > 0 ? `${active} filter${active === 1 ? "" : "s"} active: project, status, priority, labels` : "Filter by project, status, priority, or label"}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active",
                  active > 0 && "text-foreground",
                )}
              >
                <Icon name="SlidersHorizontal" className="size-3.5" />
                Filter
                {active > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{active}</span> : null}
              </button>
            </Popover.Trigger>
          </Hint>
          <Popover.Portal>
            <Popover.Content
              align="start"
              sideOffset={4}
              className="z-50 flex max-h-[70vh] w-64 flex-col gap-3 overflow-y-auto rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
            >
              {projects.length > 1 ? (
                <Group title={scopeWord}>
                  <CheckRow checked={filters.projectId === null} onChange={() => rail.setFilters({ projectId: null })}>
                    All {scopeWord.toLowerCase()}s
                  </CheckRow>
                  {projects.map((project) => (
                    <CheckRow
                      key={project.id}
                      checked={filters.projectId === project.id}
                      onChange={(checked) => rail.setFilters({ projectId: checked ? project.id : null })}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{project.prefix}</span>
                      {project.name}
                    </CheckRow>
                  ))}
                </Group>
              ) : null}
              <Group title="Status">
                {ALL_STATUSES.map((status) => (
                  <CheckRow
                    key={status}
                    checked={filters.statuses.includes(status)}
                    onChange={() => rail.setFilters({ statuses: toggleIn(filters.statuses, status) })}
                  >
                    <StatusIcon status={status} />
                    {STATUS_LABEL[status]}
                  </CheckRow>
                ))}
              </Group>
              <Group title="Priority">
                {ALL_PRIORITIES.map((priority) => (
                  <CheckRow
                    key={priority}
                    checked={filters.priorities.includes(priority)}
                    onChange={() => rail.setFilters({ priorities: toggleIn(filters.priorities, priority) })}
                  >
                    <PriorityDot priority={priority} className="size-2" />
                    {PRIORITY_LABEL[priority]}
                  </CheckRow>
                ))}
              </Group>
              {labelNames.length > 0 ? (
                <Group title="Labels">
                  {labelNames.map((name) => (
                    <CheckRow
                      key={name}
                      checked={filters.labels.includes(name)}
                      onChange={() => rail.setFilters({ labels: toggleIn(filters.labels, name) })}
                    >
                      {name}
                    </CheckRow>
                  ))}
                </Group>
              ) : null}
              <button
                type="button"
                disabled={active === 0}
                onClick={rail.resetFilters}
                className="self-start rounded px-1 text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              >
                Reset to open tasks
              </button>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Menu
          label={`Sort by ${SORT_LABEL[filters.sort].toLowerCase()}`}
          trigger={
            <button
              type="button"
              className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground data-[state=open]:bg-state-active"
            >
              <Icon name="Sort" className="size-3.5" />
              {SORT_LABEL[filters.sort]}
            </button>
          }
        >
          {SORTS.map((sort) => (
            <MenuItem key={sort} active={sort === filters.sort} onSelect={() => rail.setFilters({ sort })}>
              {SORT_LABEL[sort]}
            </MenuItem>
          ))}
        </Menu>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {count === null ? "" : `${count} ${count === 1 ? noun : `${noun}s`}`}
        </span>
      </div>
      {filters.statuses.length === 0 ? (
        <p className="px-1 text-[11px] text-muted-foreground">
          No status selected, so every status is shown.{" "}
          <button type="button" className="underline" onClick={() => rail.setFilters({ statuses: [...DEFAULT_FILTERS.statuses] })}>
            Open only
          </button>
        </p>
      ) : null}
    </div>
  );
}
