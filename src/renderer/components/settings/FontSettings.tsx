import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { READING_FONT_SIZE, type Settings } from "@shared/ipc";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { applyReadingFontSize } from "@/lib/readingFont";

interface FontSettingsProps {
  settings: Settings;
  onSettings: (next: Settings) => void;
}

/**
 * The wrapper accepts `number | number[]` (it supports multi-thumb sliders as
 * generated), and this one always has exactly one thumb. `value` is passed as an
 * array because the wrapper counts its thumbs off the *array* it is given — a
 * bare number makes it fall back to `[min, max]` and render two.
 */
function single(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0];
}

/**
 * The Font section: one setting, the reading size.
 *
 * **Dragging does not touch the IPC channel.** Saving on every tick would have
 * main rewrite config.json dozens of times in a few seconds and re-render the
 * whole app for each payload; so a drag only updates local state and the CSS
 * variable (the pane follows the pointer) and saves once when released (Base UI's
 * `onValueCommitted`). Both write the same number, so releasing cannot jump.
 *
 * There is deliberately no second size for Blocks: Markdown and Blocks are two
 * OCR outputs of one page (see DESIGN.md 5.5) but one panel and one reading
 * action, and two sizes would only make a reader doubt their eyes.
 */
export function FontSettings({ settings, onSettings }: FontSettingsProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings.readingFontSize);

  // A payload arriving from main (after any save) is the source of truth.
  // Adjusting during render avoids one frame of a stale value — same pattern as
  // TranslateSettings.
  const [syncedFrom, setSyncedFrom] = useState(settings.readingFontSize);
  if (syncedFrom !== settings.readingFontSize) {
    setSyncedFrom(settings.readingFontSize);
    setDraft(settings.readingFontSize);
  }

  const preview = (value: number) => {
    setDraft(value);
    applyReadingFontSize(value);
  };

  const commit = (value: number) => {
    window.api.settings
      .set({ readingFontSize: value })
      .then(onSettings)
      .catch(() => undefined);
  };

  const isDefault = draft === READING_FONT_SIZE.default;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-foreground">{t("settings.font.title")}</p>
        <p className="text-xs text-muted-foreground">
          {t("settings.font.desc")}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Slider
          className="w-64"
          value={[draft]}
          min={READING_FONT_SIZE.min}
          max={READING_FONT_SIZE.max}
          step={1}
          onValueChange={(value) => preview(single(value))}
          onValueCommitted={(value) => commit(single(value))}
          aria-label={t("settings.font.title")}
        />
        <span className="w-7 shrink-0 text-right text-sm tabular-nums text-foreground">{draft}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={isDefault}
          onClick={() => {
            preview(READING_FONT_SIZE.default);
            commit(READING_FONT_SIZE.default);
          }}
          title={t("settings.font.reset")}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings.font.range", {
          min: READING_FONT_SIZE.min,
          max: READING_FONT_SIZE.max,
          default: READING_FONT_SIZE.default,
        })}
      </p>
    </div>
  );
}
