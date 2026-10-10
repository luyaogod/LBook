import type { en } from "./en"

/**
 * Teaches `t()` the key names.
 *
 * This is the price of using a JSON-shaped dictionary elsewhere: without it a
 * mistyped key is a missing label at runtime. With it, `t("settings.font.titl")`
 * does not compile.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: {
      translation: typeof en
    }
  }
}
