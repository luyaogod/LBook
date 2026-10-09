import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/ipc";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A non-modal notice when a new version is ready.
 *
 * The update is downloaded in the background and installed on quit, so this
 * never interrupts what the user is doing — it only offers to restart now.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "unsupported" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void window.api.updates.getState().then(setStatus);
    return window.api.events.onUpdateStatus(setStatus);
  }, []);

  if (dismissed || status.state !== "ready") return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <Download className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        LBook {status.version} is ready. It will install when you quit.
      </span>
      <Button size="sm" onClick={() => void window.api.updates.install()}>
        Restart now
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setDismissed(true)}
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
