// Bottom pane: the general-purpose chat rendered with bb's own chat surface.
// The host owns the timeline, composer, streaming and drafts; we only decide
// which thread to show, when to focus it, and what new chats start on.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ThreadChat,
  experimental_ProviderModelPicker as ProviderModelPicker,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ExperimentalProviderModelPickerValue } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Hint } from "@/components/ui/tooltip";
import { Menu, MenuItem } from "./TaskMenus";

const CHAT_CHANGED = "chat-changed";
const DEFAULTS_CHANGED = "chat-defaults-changed";

type Selection = ExperimentalProviderModelPickerValue;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Identity for a selection. The picker may echo a value back without a
 * `serviceTier` when the provider has no tiers, and the server stores that as
 * "default"; both mean the same thing, so they must compare equal or the
 * picker and the server save each other's echoes forever.
 */
export function selectionKey(selection: Selection | null): string {
  if (selection === null) return "";
  return [
    selection.providerId,
    selection.model,
    selection.reasoningLevel,
    selection.serviceTier ?? "default",
  ].join("|");
}

/** The chat defaults: loaded once, saved only when they really change. */
function useChatDefaults(busy: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [defaults, setDefaults] = useState<Selection | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // What the server holds, by identity. Guards both directions of the sync.
  const known = useRef("");

  const load = useCallback(() => {
    rpc.call("chat_defaults", null).then(
      (result) => {
        setHostId(result.hostId);
        const key = selectionKey(result.selection);
        if (key === known.current) return;
        known.current = key;
        setDefaults(result.selection);
      },
      (cause: unknown) => toast.error(`Could not load chat defaults: ${errorMessage(cause)}`),
    );
  }, [rpc]);
  useEffect(load, [load]);
  useRealtime(DEFAULTS_CHANGED, load);

  const save = useCallback(
    async (selection: Selection) => {
      // Keep the picker's own value so it has nothing left to reconcile.
      setDefaults(selection);
      const key = selectionKey(selection);
      if (key === known.current) return;
      known.current = key;
      setSaving(true);
      try {
        await rpc.call("chat_setDefaults", selection);
      } catch (cause) {
        toast.error(`Could not save chat defaults: ${errorMessage(cause)}`);
      } finally {
        setSaving(false);
      }
    },
    [rpc],
  );

  return { defaults, hostId, saving, save, load, disabled: saving || busy };
}

export function ChatPane({ focusRequest }: { focusRequest: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chatDefaults = useChatDefaults(busy);

  const ensure = useCallback(() => {
    rpc.call("chat_ensure", null).then(
      (result) => {
        setThreadId(result.threadId);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  useEffect(ensure, [ensure]);
  useRealtime(CHAT_CHANGED, (payload) => {
    const next = (payload as { threadId?: string | null } | null)?.threadId;
    if (typeof next === "string") setThreadId(next);
    else ensure();
  });

  /**
   * Start a thread on the chat defaults: a blank chat, this chat continued in
   * a new one (with a real @thread mention), or this chat continued as a full
   * sidebar thread. The old chat is never touched.
   */
  const start = async (kind: "blank" | "continue" | "thread") => {
    if (busy) return;
    const previous = threadId;
    setBusy(true);
    try {
      const result =
        kind === "blank"
          ? await rpc.call("chat_new", null)
          : await rpc.call("chat_continue", { target: kind === "thread" ? "thread" : "chat" });
      if (kind === "thread") {
        navigate.toThread(result.threadId);
        return;
      }
      setThreadId(result.threadId);
      setError(null);
      toast.success(kind === "blank" ? "New chat started." : "Continuing in a new chat.", {
        ...(previous ? { action: { label: "Open previous", onClick: () => navigate.toThread(previous) } } : {}),
      });
    } catch (cause) {
      toast.error(`Could not start the chat: ${errorMessage(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = busy || chatDefaults.saving || threadId === null;
  const model = chatDefaults.defaults?.model ?? "the defaults below";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 px-3">
        <Icon name="MessageSquare" className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Chat
        </span>
        {threadId !== null ? (
          <Hint label="Open this chat as a full thread">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-foreground"
              aria-label="Open this chat as a full thread"
              onClick={() => navigate.toThread(threadId)}
            >
              <Icon name="ArrowUpRight" className="size-3.5" />
            </Button>
          </Hint>
        ) : null}
        <div className="flex shrink-0 items-center">
          <Hint label="Start a blank chat. This one stays in your threads.">
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 rounded-r-none border-r-0 px-2 text-xs"
              aria-label="New chat"
              disabled={controlsDisabled}
              onClick={() => void start("blank")}
            >
              <Icon name="Plus" className="size-3.5" />
              {busy ? "Starting…" : "New chat"}
            </Button>
          </Hint>
          <Menu
            label="Continue this chat on another model"
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-6 w-5 rounded-l-none px-0 text-xs"
                disabled={controlsDisabled}
              >
                <Icon name="ChevronDown" className="size-3.5" />
              </Button>
            }
          >
            <div className="px-2 py-1 text-[11px] text-muted-foreground">Continue this chat on {model}</div>
            <MenuItem onSelect={() => void start("continue")}>
              <Icon name="MessageSquare" className="size-3.5" />
              In a new chat here
            </MenuItem>
            <MenuItem onSelect={() => void start("thread")}>
              <Icon name="ArrowUpRight" className="size-3.5" />
              As a full thread
            </MenuItem>
          </Menu>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/60 px-3 py-1 text-xs">
        <Hint label="Provider, model and reasoning for new chats and continues. The current chat keeps its own.">
          <span className="text-muted-foreground">New chat defaults:</span>
        </Hint>
        {chatDefaults.defaults ? (
          <ProviderModelPicker
            value={chatDefaults.defaults}
            onChange={(selection) => void chatDefaults.save(selection)}
            routing={chatDefaults.hostId ? { kind: "host", hostId: chatDefaults.hostId } : undefined}
            allowProviderChange
            disabled={chatDefaults.disabled}
            align="end"
          />
        ) : (
          <button type="button" className="underline" onClick={chatDefaults.load}>
            Load defaults
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {error !== null ? (
          <div className="flex flex-col gap-2 p-3 text-sm">
            <p role="alert" className="text-destructive">
              {error}
            </p>
            <button type="button" className="self-start text-xs underline" onClick={ensure}>
              Retry
            </button>
          </div>
        ) : threadId === null ? (
          <p className="p-3 text-sm text-muted-foreground">Opening chat…</p>
        ) : (
          <ThreadChat
            key={threadId}
            threadId={threadId}
            variant="full"
            layout="contained"
            permissionPolicy="editable"
            focusRequest={focusRequest}
            className="h-full min-h-0"
          />
        )}
      </div>
    </div>
  );
}
