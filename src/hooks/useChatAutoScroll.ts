import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const BOTTOM_THRESHOLD_PX = 100;

export type UseChatAutoScrollOpts = {
  messages: unknown[] | null | undefined;
  activeConversationId: string | null | undefined;
  isLoading?: boolean;
};

export function useChatAutoScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  opts: UseChatAutoScrollOpts
) {
  const stickToBottomRef = useRef(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const prevActiveIdRef = useRef<string | null | undefined>(undefined);
  const wasLoadingRef = useRef(false);

  useLayoutEffect(() => {
    if (opts.activeConversationId !== prevActiveIdRef.current) {
      prevActiveIdRef.current = opts.activeConversationId ?? null;
      stickToBottomRef.current = true;
      setShowJumpToLatest(false);
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [opts.activeConversationId, scrollRef]);

  useLayoutEffect(() => {
    const loading = !!opts.isLoading;
    if (loading && !wasLoadingRef.current) {
      stickToBottomRef.current = true;
    }
    wasLoadingRef.current = loading;
  }, [opts.isLoading]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const msgs = opts.messages;
    if (!msgs || msgs.length === 0) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [opts.messages, scrollRef]);

  const syncStickFromScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const dist = scrollHeight - scrollTop - clientHeight;
    const atBottom = dist <= BOTTOM_THRESHOLD_PX;
    stickToBottomRef.current = atBottom;
    const canScroll = scrollHeight > clientHeight + 2;
    setShowJumpToLatest(!atBottom && canScroll);
  }, [scrollRef]);

  const onScroll = useCallback(() => {
    syncStickFromScrollPosition();
  }, [syncStickFromScrollPosition]);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [scrollRef]);

  return { onScroll, jumpToLatest, showJumpToLatest };
}
