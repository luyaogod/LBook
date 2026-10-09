import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeChoice } from "@/components/theme/ThemeProvider";

const THEMES: Array<{ id: ThemeChoice; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

const RESOLVED_LABEL = { light: "浅色", dark: "暗色" } as const;

/**
 * General 分区。
 *
 * 目前只有外观：三张卡片，与 Claude Desktop 的设置同款。选择直接交给
 * `ThemeProvider`——它一边立刻换类，一边把 `settings.theme` 写回 config.json。
 */
export function GeneralSettings() {
  const { theme, resolved, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-foreground">Appearance</p>
        <p className="text-xs text-muted-foreground">
          跟随系统时，随操作系统的浅色/暗色自动切换。选择会写进 config.json。
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {THEMES.map(({ id, label, icon: Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              onClick={() => setTheme(id)}
              aria-pressed={active}
              className={`flex h-24 flex-col items-center justify-center gap-2 rounded-xl border text-sm transition-colors ${
                active
                  ? "border-ring bg-accent text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        当前生效：{theme === "system" ? `跟随系统（${RESOLVED_LABEL[resolved]}）` : RESOLVED_LABEL[resolved]}
      </p>
    </div>
  );
}
