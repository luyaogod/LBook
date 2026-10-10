import { useState } from "react";
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
 * 字体分区：只有一项——字号。
 *
 * **拖动时不走 IPC。** 一边拖一边把值写回主进程，会让 `config.json` 在几秒内被
 * 原子重写几十次，而且每次回来的载荷都会重渲染整个应用。所以拖动过程只改本地值
 * 并直接改 CSS 变量（面板跟着鼠标动），松手才落盘一次（Base UI 的
 * `onValueCommitted`）。两者写的是同一个数，所以松手不会跳。
 *
 * 不做"两种字号"（比如 Markdown 一套、Blocks 一套）：这两个视图读的是**同一页的两种 OCR 产出**
 * （`markdown_text` 字符串 vs 带 bbox 的块，见 `DESIGN.md` 5.5），但它们是同一块面板、同一个阅读动作；
 * 字号不同只会让人切视图时疑心自己看错了书。
 */
export function FontSettings({ settings, onSettings }: FontSettingsProps) {
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
        <p className="text-sm font-medium text-foreground">Font size</p>
        <p className="text-xs text-muted-foreground">
          阅读区文字的大小，单位为像素。Markdown 与 Blocks 两个视图共用这一档字号。
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
          aria-label="Font size"
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
          title="恢复默认"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        范围 {READING_FONT_SIZE.min}–{READING_FONT_SIZE.max}px，默认 {READING_FONT_SIZE.default}px。
        改动写进 config.json，重启后仍然是这个大小。
      </p>
    </div>
  );
}
