import type { BookToc, TocNode } from "./types"

/**
 * The table of contents contract, shared by main, preload and renderer.
 *
 * The tree is authored by hand (or by a script) as `toc.json` inside the
 * `toc.json`, so parsing has to be strict enough to catch typos in a file the user
 * wrote, and forgiving enough to accept the obvious shorthands. The renderer
 * only ever consumes the flattened form.
 *
 * Zero dependencies and no I/O — this module is imported by the renderer too.
 */

/** Version of the payload this build writes. A reader refuses anything newer. */
export const TOC_FORMAT_VERSION = 1

/** Guards against a hand-written file turning the sidebar into an unusable tree. */
const MAX_DEPTH = 6
const MAX_TITLE_LENGTH = 200

/** A node with its tree position resolved to a stable, renderable id. */
export interface FlatTocNode {
  /** Dotted path within the tree ("0", "2.1"), stable across re-parses. */
  id: string
  title: string
  page: number | null
  printedPage: number | null
  depth: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parsePage(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive whole page number, got ${JSON.stringify(value)}`)
  }
  return value
}

function parseNode(value: unknown, path: string, depth: number): TocNode {
  if (depth > MAX_DEPTH) {
    throw new Error(`${path}: a table of contents may not nest deeper than ${MAX_DEPTH} levels`)
  }

  const record = asRecord(value)
  if (!record) throw new Error(`${path} must be an object with a "title"`)

  const rawTitle = record.title
  const title = typeof rawTitle === "string" ? rawTitle.trim() : ""
  if (title === "") throw new Error(`${path} needs a non-empty "title"`)
  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error(`${path}: "title" is longer than ${MAX_TITLE_LENGTH} characters`)
  }

  const rawChildren = record.children
  if (rawChildren !== undefined && rawChildren !== null && !Array.isArray(rawChildren)) {
    throw new Error(`${path}.children must be an array`)
  }
  const children = (rawChildren as unknown[] | undefined)?.map((child, index) =>
    parseNode(child, `${path}.children[${index}]`, depth + 1),
  )

  const page = parsePage(record.page, `${path}.page`)
  const printedPage = parsePage(record.printedPage, `${path}.printedPage`)

  if (page === null && (!children || children.length === 0)) {
    // A node that can neither be clicked nor expanded is almost always a typo.
    throw new Error(`${path} ("${title}") needs a "page" or a non-empty "children"`)
  }

  const node: TocNode = { title, page }
  if (printedPage !== null) node.printedPage = printedPage
  if (children && children.length > 0) node.children = children
  return node
}

/**
 * Parses and validates a `toc.json` payload.
 *
 * A bare array is accepted as shorthand for `{ "nodes": [...] }`, because that
 * is what a user writing the file by hand naturally produces.
 */
export function parseToc(value: unknown): BookToc {
  const record = asRecord(value)
  const shorthand = Array.isArray(value) ? (value as unknown[]) : null
  const rawNodes = shorthand ?? record?.nodes

  if (!Array.isArray(rawNodes)) {
    throw new Error('Table of contents must be an object with a "nodes" array (or a bare array)')
  }
  if (rawNodes.length === 0) {
    throw new Error("Table of contents has no entries")
  }

  const rawVersion = shorthand ? TOC_FORMAT_VERSION : (record?.version ?? TOC_FORMAT_VERSION)
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion) || rawVersion < 1) {
    throw new Error(`"version" must be a positive whole number, got ${JSON.stringify(rawVersion)}`)
  }
  if (rawVersion > TOC_FORMAT_VERSION) {
    throw new Error(
      `Table of contents version ${rawVersion} is newer than this build supports (${TOC_FORMAT_VERSION})`,
    )
  }

  const source = record?.source
  return {
    version: rawVersion,
    source: typeof source === "string" && source.trim() !== "" ? source : null,
    nodes: rawNodes.map((node, index) => parseNode(node, `nodes[${index}]`, 1)),
  }
}

/** Pre-order flattening: every node keeps a dotted id derived from its position. */
export function flattenToc(toc: BookToc | null | undefined): FlatTocNode[] {
  if (!toc) return []
  const out: FlatTocNode[] = []

  const walk = (nodes: TocNode[], prefix: string, depth: number): void => {
    nodes.forEach((node, index) => {
      const id = prefix === "" ? String(index) : `${prefix}.${index}`
      out.push({
        id,
        title: node.title,
        page: node.page ?? null,
        printedPage: node.printedPage ?? null,
        depth,
      })
      if (node.children && node.children.length > 0) walk(node.children, id, depth + 1)
    })
  }

  walk(toc.nodes, "", 1)
  return out
}

/**
 * The entry that contains `page`: the last one that starts at or before it.
 *
 * Pre-order flattening means a section follows its chapter, and a deeper entry
 * that starts on the same page is the more specific one, so both "later" and
 * "deeper" win ties.
 */
export function findActiveTocId(nodes: FlatTocNode[], page: number): string | null {
  let best: FlatTocNode | null = null
  for (const node of nodes) {
    if (node.page === null || node.page > page) continue
    if (
      best === null ||
      best.page === null ||
      node.page > best.page ||
      (node.page === best.page && node.depth >= best.depth)
    ) {
      best = node
    }
  }
  return best ? best.id : null
}

/** Ids of every ancestor of `id`, for auto-expanding the path to the active entry. */
export function tocAncestorIds(id: string): string[] {
  const parts = id.split(".")
  const ancestors: string[] = []
  for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("."))
  return ancestors
}

/** Total entry count, used by the panel header. */
export function countTocNodes(nodes: TocNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countTocNodes(node.children ?? []), 0)
}
