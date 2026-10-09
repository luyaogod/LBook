import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Eye, EyeOff, Languages } from "lucide-react";
import type { Settings } from "@shared/ipc";
import type { TranslateSettingsView } from "@shared/translate";
import { translateText } from "@/api/translate";

/** Codes the pickers can show today; a provider advertises which it accepts. */
const LANGUAGE_LABELS: Record<string, string> = {
  auto: "自动检测",
  zh: "中文（简体）",
  en: "英语",
  ja: "日语",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
  ru: "俄语",
};

function labelOf(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

const SAMPLE = "Accounting is the language of business.";

interface TranslateSettingsProps {
  settings: Settings;
  onSettings: (next: Settings) => void;
  onOpenSettingsRequest?: () => void;
}

/**
 * 翻译设置：选供应商、填凭据、定语言。
 *
 * 表单本身**不认识任何厂商**——输入框是按 `providers[].fields` 渲染出来的，
 * 换一家供应商只是换一组描述。密钥只写不读：`secretsSet` 只告诉这里"已经存过"。
 */
export function TranslateSettings({ settings, onSettings }: TranslateSettingsProps) {
  const [draft, setDraft] = useState<TranslateSettingsView>(settings.translate);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; message?: string }>({
    state: "idle",
  });
  /** Secret fields currently shown in clear text, by field key. */
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // A settings payload arriving from main (after any save) is the source of
  // truth. Adjusting during render avoids one frame of stale form values.
  const [syncedFrom, setSyncedFrom] = useState(settings.translate);
  if (syncedFrom !== settings.translate) {
    setSyncedFrom(settings.translate);
    setDraft(settings.translate);
  }

  const provider = draft.providers.find((item) => item.id === draft.provider) ?? draft.providers[0];
  const values = draft.values[provider?.id ?? ""] ?? {};

  const setValue = useCallback(
    (key: string, value: string) => {
      setSaved(false);
      setDraft((current) => ({
        ...current,
        values: {
          ...current.values,
          [current.provider]: { ...(current.values[current.provider] ?? {}), [key]: value },
        },
      }));
    },
    []
  );

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await window.api.settings.set({
        translate: {
          provider: draft.provider,
          sourceLang: draft.sourceLang,
          targetLang: draft.targetLang,
          // The form is prefilled with what is stored, so an emptied box is a
          // request to remove that value rather than "leave it alone".
          values: { [draft.provider]: draft.values[draft.provider] ?? {} },
        },
      });
      onSettings(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [draft, onSettings]);

  /** Empties the field locally; nothing is persisted until 保存 is pressed. */
  const clearField = useCallback((key: string) => setValue(key, ""), [setValue]);

  const runTest = useCallback(async () => {
    await save();
    setTest({ state: "running" });
    try {
      const result = await translateText({ text: SAMPLE });
      setTest({ state: "ok", message: `${result.source} → ${result.target}：${result.text}${result.cached ? "（缓存）" : ""}` });
    } catch (err) {
      setTest({ state: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  }, [save]);

  const languages = provider?.languages ?? ["zh", "en"];

  return (
    <div className="space-y-6">
      {/* Provider */}
      <div className="flex items-center justify-between gap-6 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">服务商</p>
          <p className="text-xs text-muted-foreground">划词翻译走哪家的接口。</p>
        </div>
        <select
          value={draft.provider}
          onChange={(event) => {
            setSaved(false);
            setDraft((current) => ({ ...current, provider: event.target.value }));
          }}
          className="h-8 w-52 shrink-0 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
        >
          {draft.providers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {/* Credentials — rendered entirely from the provider's own field list */}
      {provider?.fields.map((field) => {
        const value = values[field.key] ?? "";
        return (
          <div key={field.key} className="flex items-start justify-between gap-6 border-b border-border pb-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{field.label}</p>
              {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
            </div>
            <div className="w-72 shrink-0">
              <div className="relative">
                {/* Prefilled with what is stored: masked as dots by default, and
                    the eye switches to plain text, which is then copyable. */}
                <input
                  type={field.secret && !revealed[field.key] ? "password" : "text"}
                  value={value}
                  placeholder={field.secret ? "留空并保存 = 移除该密钥" : field.placeholder}
                  onChange={(event) => setValue(field.key, event.target.value)}
                  className={`h-8 w-full rounded-md border border-border bg-transparent pl-2 text-sm outline-none focus:border-primary ${
                    field.secret ? "pr-8" : ""
                  }`}
                  autoComplete="off"
                  spellCheck={false}
                />
                {field.secret && (
                  <button
                    onClick={() => setRevealed((current) => ({ ...current, [field.key]: !current[field.key] }))}
                    title={revealed[field.key] ? "隐藏" : "显示"}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {revealed[field.key] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              {field.secret && value !== "" && (
                <button
                  onClick={() => clearField(field.key)}
                  className="mt-1 text-[11px] text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                >
                  清除（保存后生效）
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Languages */}
      <div className="flex items-center justify-between gap-6 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">语言</p>
          <p className="text-xs text-muted-foreground">源语言选"自动检测"时，按选中文字本地判断。</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={draft.sourceLang}
            onChange={(event) => {
              setSaved(false);
              setDraft((current) => ({ ...current, sourceLang: event.target.value }));
            }}
            className="h-8 w-32 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
          >
            <option value="auto">{labelOf("auto")}</option>
            {languages.map((code) => (
              <option key={code} value={code}>
                {labelOf(code)}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">→</span>
          <select
            value={draft.targetLang}
            onChange={(event) => {
              setSaved(false);
              setDraft((current) => ({ ...current, targetLang: event.target.value }));
            }}
            className="h-8 w-32 rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-primary"
          >
            {languages.map((code) => (
              <option key={code} value={code}>
                {labelOf(code)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {test.state === "fail" && <p className="text-xs text-destructive">{test.message}</p>}
      {test.state === "ok" && (
        <p className="flex items-start gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{test.message}</span>
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          保存
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runTest()} className="gap-1.5">
          <Languages className="h-3.5 w-3.5" />
          测试翻译
        </Button>
        {saved && !saving && <span className="text-xs text-muted-foreground">已保存</span>}
      </div>
    </div>
  );
}
