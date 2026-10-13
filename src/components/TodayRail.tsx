// The rail itself: a fixed right column with the task panel above a docked
// inbox chat. It reserves its width inside #root so app content is not covered,
// and hides on compact viewports where a 300px column would eat the screen.
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Hint } from "@/components/ui/tooltip";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { rail, RAIL_MAX_WIDTH, RAIL_MIN_WIDTH, type RailState } from "@/lib/rail-store";
import { cn } from "@/lib/utils";
import { ChatPane } from "./ChatPane";
import { TaskPanel } from "./TaskPanel";

const RESERVE_STYLE_ID = "bb-today-rail-reserve";

/** Push the app shell left by the rail's width; remove on unmount or collapse. */
function useReservedSpace(active: boolean, width: number) {
  useEffect(() => {
    const root = document.documentElement;
    let style = document.getElementById(RESERVE_STYLE_ID) as HTMLStyleElement | null;
    if (style === null) {
      style = document.createElement("style");
      style.id = RESERVE_STYLE_ID;
      // Radix menus reset body padding when they lock scrolling. Reserve the
      // rail inside the app root so opening a menu cannot resize the chat.
      style.textContent = `body > #root { padding-right: var(--bb-today-rail-w, 0px); box-sizing: border-box; }`;
      document.head.appendChild(style);
    }
    root.style.setProperty("--bb-today-rail-w", active ? `${width}px` : "0px");
    return () => {
      root.style.setProperty("--bb-today-rail-w", "0px");
    };
  }, [active, width]);
  useEffect(
    () => () => {
      document.getElementById(RESERVE_STYLE_ID)?.remove();
      document.documentElement.style.removeProperty("--bb-today-rail-w");
    },
    [],
  );
}

/** Horizontal drag on the rail's left edge. */
function useWidthDrag() {
  const dragging = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    rail.setWidth(window.innerWidth - event.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

/** Vertical drag on the divider between the two panes. */
function useSplitDrag(container: React.RefObject<HTMLElement | null>) {
  const dragging = useRef(false);
  const onPointerDown = (event: React.PointerEvent) => {
    dragging.current = true;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging.current || container.current === null) return;
    const box = container.current.getBoundingClientRect();
    rail.setSplit((event.clientY - box.top) / box.height);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

export function TodayRail({ state }: { state: RailState }) {
  const compact = useIsCompactViewport();
  const visible = state.open && !compact;
  useReservedSpace(visible, state.width);
  const bodyRef = useRef<HTMLDivElement>(null);
  const widthDrag = useWidthDrag();
  const splitDrag = useSplitDrag(bodyRef);

  if (!visible) return null;

  return (
    <aside
      aria-label="Linear Panel"
      style={{ width: state.width, minWidth: RAIL_MIN_WIDTH, maxWidth: RAIL_MAX_WIDTH }}
      className={cn(
        "fixed inset-y-0 right-0 z-30 flex flex-col",
        "border-l border-border bg-background text-foreground",
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize rail"
        {...widthDrag}
        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize touch-none hover:bg-border/60"
      />
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/60 px-3">
        <Icon name="ListTodo" className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Today</span>
        <Hint label="Hide the rail (⌘⇧T). ⌘⇧J reopens it with the chat focused.">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Hide rail (⌘⇧T)"
            onClick={rail.close}
          >
            <Icon name="PanelRightClose" className="size-4" />
          </Button>
        </Hint>
      </header>
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div style={{ flexBasis: `${state.split * 100}%` }} className="min-h-0 shrink-0 grow-0 overflow-hidden">
          <TaskPanel state={state} />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panes"
          {...splitDrag}
          className="h-1.5 shrink-0 cursor-row-resize touch-none border-y border-border/60 bg-muted/40 hover:bg-border"
        />
        <div className="min-h-0 flex-1">
          <ChatPane focusRequest={state.focusRequest} />
        </div>
      </div>
    </aside>
  );
}
