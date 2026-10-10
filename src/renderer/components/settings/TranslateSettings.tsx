import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Loader2, Check, Eye, EyeOff, Languages } from "lucide-react";
import type { Settings } from "@shared/ipc";
import type { TranslateSettingsView } from "@shared/translate";
import { translateText } from "@/api/translate";
import { languageLabel, textFor } from "@/i18n";

interface TranslateSettingsProps {
  settings: Settings;
  onSettings: (next: Settings) => void;
  onOpenSettingsRequest?: () => void;
}

/**
 * Translation settings: pick a vendor, fill in its credentials, choose languages.
 *
 * The form knows nothing about any vendor — its inputs are rendered from
 * `providers[].fields`, so switching vendors only switches a list of
 * descriptions. Secrets are write-only: the payload says only that a value is
 * stored, and an emptied box means "remove this key".
 */
export function TranslateSettings({ settings, onSettings }: TranslateSettingsProps) {
  const { t } = useTranslation();
  /** Language codes are an open set (a provider advertises its own). */
  const labelOf = (code: string | undefined) => languageLabel(t, code);
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

  /** Empties the field locally; nothing is persisted until Save is pressed. */
  const clearField = useCallback((key: string) => setValue(key, ""), [setValue]);

  const runTest = useCallback(async () => {
    await save();
    setTest({ state: "running" });
    try {
      const result = await translateText({ text: t("settings.translate.testSample") });
      setTest({
        state: "ok",
        message: t(result.cached ? "settings.translate.testOkCached" : "settings.translate.testOk", {
          source: languageLabel(t, result.source),
          target: languageLabel(t, result.target),
          text: result.text,
        }),
      });
    } catch (err) {
      setTest({ state: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  }, [save, t]);

  const languages = provider?.languages ?? ["zh", "en"];

  return (
    <div className="space-y-6">
      {/* Provider */}
      <div className="flex items-center justify-between gap-6 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t("settings.translate.provider")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.translate.providerDesc")}</p>
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
              {textFor(t, item.labelKey, item.label)}
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
              <p className="text-sm font-medium text-foreground">{textFor(t, field.labelKey, field.label)}</p>
              {field.hint && (
                <p className="text-xs text-muted-foreground">{textFor(t, field.hintKey, field.hint)}</p>
              )}
            </div>
            <div className="w-72 shrink-0">
              <div className="relative">
                {/* Prefilled with what is stored: masked as dots by default, and
                    the eye switches to plain text, which is then copyable. */}
                <input
                  type={field.secret && !revealed[field.key] ? "password" : "text"}
                  value={value}
                  placeholder={field.secret ? t("settings.translate.secretPlaceholder") : field.placeholder}
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
                    title={revealed[field.key] ? t("settings.translate.hide") : t("settings.translate.show")}
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
                  {t("settings.translate.clear")}
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Languages */}
      <div className="flex items-center justify-between gap-6 border-b border-border pb-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t("settings.translate.languages")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.translate.languagesDesc")}</p>
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
          {t("settings.translate.save")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void runTest()} className="gap-1.5">
          <Languages className="h-3.5 w-3.5" />
          {t("settings.translate.test")}
        </Button>
        {saved && !saving && (
          <span className="text-xs text-muted-foreground">{t("settings.translate.saved")}</span>
        )}
      </div>
    </div>
  );
}
