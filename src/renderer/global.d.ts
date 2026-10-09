import type { LbookApi } from "../shared/ipc"

declare global {
  interface Window {
    api: LbookApi
  }
}

export {}
