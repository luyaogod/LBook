import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bolt, Languages, Settings2, Type, X } from "lucide-react";
import type { Settings } from "@shared/ipc";
import type { TranslationKeys } from "@/i18n/en";
import { GeneralSettings } from "./GeneralSettings";
import { FontSettings } from "./FontSettings";
import { TranslateSettings } from "./TranslateSettings";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired whenever main returns a fresh settings payload, so App stays in sync. */
  onSettings: (settings: Settings) => void;
  settings: Settings | null;
}

type SectionId = "general" | "font" | "translate";

/**
 * The three sections, as keys rather than labels: a module constant cannot call
 * `t()`, and the label has to follow the interface language.
 */
const SECTIONS: Array<{ id: SectionId; labelKey: TranslationKeys; icon: typeof Settings2 }> = [
  { id: "general", labelKey: "settings.section.general", icon: Settings2 },
  { id: "font", labelKey: "settings.section.font", icon: Type },
  { id: "translate", labelKey: "settings.section.translate", icon: Languages },
];

/**
 * The settings panel.
 *
 * Claude Desktop's shape: a column of sections on the left, content on the right,
 * over a dimmed backdrop. Three sections: General (appearance, language), Font
 * (reading size), Translate (vendors and credentials). Font comes before
 * Translate because it is changed *while reading*, not configured once.
 */
export function SettingsDialog({ open, onClose, onSettings, settings }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<SectionId>("general");

  // Every open starts on General rather than wherever the user left off: the
  // panel is a place people come back to for the same few things, and landing on
  // the section you last touched makes "the default" depend on history.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setSection("general");
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative flex h-[600px] max-h-[86vh] w-[880px] max-w-[94vw] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
        {/* Left: sections */}
        <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/30 p-3">
          <p className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.title")}
          </p>
          {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                section === id
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(labelKey)}
            </button>
          ))}

          <div className="mt-auto flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
            <Bolt className="h-3 w-3" />
            LBook {settings?.version ?? ""}
          </div>
        </nav>

        {/* Right: content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
            <h2 className="text-base font-semibold text-foreground">
              {t(SECTIONS.find((item) => item.id === section)?.labelKey ?? "settings.title")}
            </h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title={t("settings.close")}>
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {section === "general" && settings && (
              <GeneralSettings settings={settings} onSettings={onSettings} />
            )}
            {section === "font" && settings && (
              <FontSettings settings={settings} onSettings={onSettings} />
            )}
            {section === "translate" && settings && (
              <TranslateSettings settings={settings} onSettings={onSettings} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
