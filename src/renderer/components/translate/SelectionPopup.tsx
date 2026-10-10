import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Languages, Loader2, Square, TriangleAlert, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { speakToObjectUrl, translateText } from "@/api/translate";
import { languageLabel } from "@/i18n";

/**
 * Placement rules are ported from the Google Translate extension bubble, whose
 * compiled source ships with the extension itself (unpack it from
 * `…/Chrome/User Data/<profile>/Extensions/aapbdbdomjkkjkaonfhkkikfgjllcleb/`).
 * The essentials, straight from its `Bubble.getTranslateIcon`:
 *
 *   left = clientX - 13                       // icon is 25px wide → centred on the cursor
 *   top  = clientY - rect.top > rect.height/2
 *          ? rect.bottom + 1                   // cursor low in the selection → icon below it
 *          : rect.top - 1 - 27                 // otherwise above it
 *   Bubble.MAX_LENGTH_ = 250                  // Google's cap; ours is MAX_SELECTION below
 *   goodAnchor(rect) = !(rect.top == 0 && rect.left == 0)
 *
 * The point of the vertical rule is that the trigger lands **outside** the selected
 * box — never on the words behind the selection, which is what breaks reading.
 */
const ICON_SIZE = 24;
/** Gap between the selection box and the icon, above and below. */
const ICON_GAP_ABOVE = 3;
const ICON_GAP_BELOW = 1;
/**
 * Deliberately **not** Google's 250: a paragraph is a legitimate thing to want
 * translated. Bounded well below the vendor's own per-request cap (2000) so the
 * card still has room to be useful.
 */
const MAX_SELECTION = 500;
/** Selection with no letters at all (page numbers, table figures) is not language. */
const NOT_LANGUAGE = /^[0-9!@#$€£%^&*()_+\-=[\]{};':"\\|,.<>/?]*$/;
/** Below this the card has no room to be useful; Google bails out under 400. */
const MIN_VIEWPORT_WIDTH = 400;
/** Distance kept between the icon/selection and the card. */
const CARD_GAP = 6;
/** Rough card height, used only to decide whether it fits on a side. */
const CARD_ESTIMATED_HEIGHT = 200;

interface Anchor {
  x: number;
  y: number;
  /** Where the card grows from, so it does not cover the selection. */
  above: boolean;
}

type Phase = "icon" | "loading" | "done" | "error";

interface PopupState {
  text: string;
  /** Trigger position, centred on the cursor and clear of the selection box. */
  icon: { x: number; y: number };
  anchor: Anchor;
  phase: Phase;
  source?: string;
  target?: string;
  translation?: string;
  cached?: boolean;
  error?: string;
}

const clampX = (x: number, width: number) => Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - width - 8));

interface SelectionPopupProps {
  /** The scrollable element whose text may be selected. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** False while the panel shows blocks rather than markdown. */
  enabled: boolean;
  /** Called when the user has to go and configure a vendor. */
  onOpenSettings?: () => void;
}

/**
 * Selection translation: highlight text, a small icon appears, clicking it
 * translates.
 *
 * Not translating automatically is deliberate — a selection is often just for
 * copying or marking, and firing a request interrupts reading and costs money.
 * The icon sits at the end of the selection (where the Google extension puts it)
 * and only clicking it opens the card.
 *
 * The card has two speakers, for the original and for the translation; audio is
 * cached in memory per "text + language", so asking twice does not synthesise
 * twice.
 */
export function SelectionPopup({ containerRef, enabled, onOpenSettings }: SelectionPopupProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<PopupState | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef(new Map<string, string>());
  const [speaking, setSpeaking] = useState<"none" | "source" | "target" | "loading-source" | "loading-target">(
    "none"
  );

  // Leaving markdown view must not leave a card behind. Adjusting during render
  // (rather than in an effect) keeps the first paint after the switch clean.
  const [wasEnabled, setWasEnabled] = useState(enabled);
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (!enabled) setState(null);
  }

  const dismiss = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking("none");
    setState(null);
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking("none");
  }, []);

  /** The icon was clicked: this is the first moment a request is allowed to run. */
  const run = useCallback(async (current: PopupState) => {
    const id = ++requestIdRef.current;
    setState({ ...current, phase: "loading" });
    try {
      const result = await translateText({ text: current.text });
      if (requestIdRef.current !== id) return;
      setState({
        ...current,
        phase: "done",
        translation: result.text,
        source: result.source,
        target: result.target,
        cached: result.cached,
      });
    } catch (error) {
      if (requestIdRef.current !== id) return;
      setState({
        ...current,
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const speakAloud = useCallback(
    async (kind: "source" | "target") => {
      if (!state) return;

      // Second click on the same speaker stops playback.
      const active = kind === "source" ? "source" : "target";
      if (speaking === active) {
        stopAudio();
        return;
      }

      const text = kind === "source" ? state.text : (state.translation ?? "");
      const language = kind === "source" ? (state.source ?? "en") : (state.target ?? "zh");
      if (text.trim() === "") return;

      const key = `${language}\u0000${text}`;
      setSpeaking(kind === "source" ? "loading-source" : "loading-target");
      try {
        let url = audioCacheRef.current.get(key);
        if (!url) {
          url = await speakToObjectUrl({ text, language });
          audioCacheRef.current.set(key, url);
        }

        audioRef.current?.pause();
        const element = new Audio(url);
        audioRef.current = element;
        element.onended = () => setSpeaking("none");
        element.onerror = () => setSpeaking("none");
        setSpeaking(kind);
        await element.play();
      } catch (error) {
        setSpeaking("none");
        setState((current) =>
          current ? { ...current, phase: "error", error: error instanceof Error ? error.message : String(error) } : current
        );
      }
    },
    [state, speaking, stopAudio]
  );

  // Listen on the document: a selection can end outside the container.
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;

    const onMouseUp = (event: MouseEvent) => {
      // Clicks inside the card must not re-trigger or dismiss it.
      if (cardRef.current?.contains(event.target as Node)) return;

      const selection = window.getSelection();
      const text = selection?.toString().trim() ?? "";

      if (!selection || selection.rangeCount === 0 || text === "" || !container) {
        dismiss();
        return;
      }

      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        dismiss();
        return;
      }

      const box = range.getBoundingClientRect();
      // Google's goodAnchor(): a rect parked at the origin means a hidden or
      // unmeasurable range, and positioning against it lands in the corner.
      if ((box.width === 0 && box.height === 0) || (box.top === 0 && box.left === 0)) {
        dismiss();
        return;
      }

      // Ported from Bubble.bubbleCheck(): no trigger for pages of text, for pure
      // numbers/punctuation (page numbers, table figures), or in a window too
      // narrow for a card. Long selections simply get no offer instead of an
      // error, which is what Google does too.
      if (
        text.length > MAX_SELECTION ||
        NOT_LANGUAGE.test(text) ||
        window.innerWidth <= MIN_VIEWPORT_WIDTH
      ) {
        dismiss();
        return;
      }

      // Vertically clear of the selection box, on the side the cursor is *not*
      // in, exactly as the extension does it.
      const iconAbove = event.clientY - box.top <= box.height / 2;
      const iconY = iconAbove
        ? Math.max(box.top - ICON_GAP_ABOVE - ICON_SIZE, 4)
        : Math.min(box.bottom + ICON_GAP_BELOW, window.innerHeight - ICON_SIZE - 4);

      // The card continues outward from the icon, and only crosses to the other
      // side of the selection when that side has no room.
      let above = iconAbove;
      let y = iconAbove ? iconY - CARD_GAP : iconY + ICON_SIZE + CARD_GAP;
      if (above && y - CARD_ESTIMATED_HEIGHT < 8) {
        above = false;
        y = box.bottom + CARD_GAP;
      } else if (!above && y + CARD_ESTIMATED_HEIGHT > window.innerHeight - 8) {
        above = true;
        y = box.top - CARD_GAP;
      }

      setState({
        text,
        icon: { x: clampX(event.clientX - ICON_SIZE / 2, ICON_SIZE), y: iconY },
        anchor: { x: box.left, y, above },
        phase: "icon",
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    // The anchor rect is viewport-relative, so any scroll invalidates it.
    const onScroll = () => dismiss();

    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keydown", onKeyDown);
    container?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keydown", onKeyDown);
      container?.removeEventListener("scroll", onScroll);
    };
  }, [enabled, containerRef, dismiss]);

  // Blob URLs live as long as the panel does; release them when it goes away.
  useEffect(() => {
    const cache = audioCacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  if (!state) return null;

  // ---- phase 1: just the trigger icon -------------------------------------
  if (state.phase === "icon") {
    return (
      <button
        style={{ left: state.icon.x, top: state.icon.y }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void run(state)}
        title={t("translate.icon")}
        // The chrome copies the Google Translate extension's trigger (light:
        // #f5f5f5 / #dcdcdc / #5f6368); the dark values are that palette's own
        // dark counterparts rather than a generic token, so it still reads as
        // "that button".
        className="fixed z-50 flex h-6 w-6 items-center justify-center rounded-[5px] border border-[#dcdcdc] bg-[#f5f5f5] text-[#5f6368] shadow-sm transition-colors hover:border-[#c6c6c6] hover:bg-[#f8f8f8] hover:text-foreground dark:border-[#5f6368] dark:bg-[#3c4043] dark:text-[#e8eaed] dark:hover:border-[#80868b] dark:hover:bg-[#4a4d51]"
      >
        <Languages className="h-4 w-4" />
      </button>
    );
  }

  // ---- phase 2: the card --------------------------------------------------
  const { anchor } = state;
  const left = clampX(anchor.x, 360);
  const style: React.CSSProperties = anchor.above
    ? { left, bottom: window.innerHeight - anchor.y }
    : { left, top: anchor.y };
  const speakable = state.phase === "done";
  const busy = speaking === "loading-source" || speaking === "loading-target";

  const speaker = (kind: "source" | "target") => {
    if (!speakable) return null;
    const isActive = speaking === kind;
    const isLoading = speaking === `loading-${kind}`;
    return (
      <button
        onClick={() => void speakAloud(kind)}
        disabled={busy}
        title={isActive ? t("translate.stopSpeaking") : kind === "source" ? t("translate.speakSource") : t("translate.speakTarget")}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : isActive ? (
          <Square className="h-3 w-3" />
        ) : (
          <Volume2 className="h-3.5 w-3.5" />
        )}
      </button>
    );
  };

  return (
    <div
      ref={cardRef}
      style={style}
      // Keep the selection highlighted while the user reads the card.
      onMouseDown={(event) => event.preventDefault()}
      className="fixed z-50 w-90 max-w-[90vw] rounded-lg border border-border bg-popover shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {speaker("source")}
          {languageLabel(t, state.source) || "…"}
        </span>
        {state.phase === "done" && (
          <button
            onClick={() => void navigator.clipboard.writeText(state.translation ?? "")}
            title={t("translate.copy")}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="max-h-64 overflow-y-auto px-3 py-2">
        <p className="text-xs leading-relaxed text-muted-foreground">{state.text}</p>

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {speaker("target")}
          {languageLabel(t, state.target)}
          {state.cached && (
            <span className="flex items-center gap-1" title={t("translate.cachedHint")}>
              <Check className="h-3 w-3 text-emerald-500" />
              {t("translate.cached")}
            </span>
          )}
        </div>

        {state.phase === "loading" && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t("translate.inProgress")}
          </p>
        )}

        {state.phase === "done" && (
          <p className="mt-1 text-sm leading-relaxed text-foreground">{state.translation}</p>
        )}

        {state.phase === "error" && (
          <div className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">
              {state.error}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="ml-1 underline underline-offset-2 hover:text-foreground"
                >
                  {t("translate.openSettings")}
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
