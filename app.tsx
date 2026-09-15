// bb-plugin-today-rail — frontend entry.
//
// One app-wide overlay (the rail), two palette commands, a sidebar footer
// button, and the keyboard shortcuts. bb supplies no chrome for an overlay,
// so TodayRail positions itself and reserves its own horizontal space.
import { useEffect } from "react";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TodayRail } from "@/components/TodayRail";
import { isFocusInboxShortcut, isToggleShortcut, rail, useRailState } from "@/lib/rail-store";

function RailOverlay() {
  const state = useRailState();

  useEffect(() => {
    const isMac = /mac|iphone|ipad/i.test(navigator.userAgent);
    const onKeyDown = (event: KeyboardEvent) => {
      if (isToggleShortcut(event, isMac)) {
        event.preventDefault();
        event.stopPropagation();
        rail.toggle();
      } else if (isFocusInboxShortcut(event, isMac)) {
        event.preventDefault();
        event.stopPropagation();
        rail.focusInbox();
      }
    };
    // Capture phase so editors and terminals cannot swallow the shortcut.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  // ThreadChat's controls use tooltips, and the overlay slot mounts outside
  // the host's TooltipProvider. The radix import is shimmed to the host copy.
  return (
    <TooltipProvider delayDuration={300}>
      <TodayRail state={state} />
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({
    id: "today-rail",
    component: RailOverlay,
  });
  app.slots.commandPaletteAction({
    id: "toggle",
    title: "Tasks: toggle rail",
    run: () => rail.toggle(),
  });
  app.slots.commandPaletteAction({
    id: "chat",
    title: "Chat: focus sidebar chat",
    run: () => rail.focusInbox(),
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "today-rail",
    label: "Linear Panel",
    icon: "ListTodo",
    onActivate: () => rail.toggle(),
  });
});
