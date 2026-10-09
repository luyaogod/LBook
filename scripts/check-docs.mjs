/**
 * Verifies the documentation index rules from AGENTS.md.
 *
 *   node scripts/check-docs.mjs
 *
 * 1. Every directory under src/, scripts/ and tests/ has a README.md.
 * 2. Every relative markdown link in those READMEs resolves to a real file.
 * 3. Every README reaches the root README.md through its 父级 links in <= 4 hops.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const ROOTS = ["src", "scripts", "tests"]
const MAX_HOPS = 4
const ROOT_README = path.join(root, "README.md")

const problems = []

function relative(absolute) {
  return path.relative(root, absolute).split(path.sep).join("/")
}

function walkDirectories(start) {
  const found = []
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const child = path.join(dir, entry.name)
      found.push(child)
      visit(child)
    }
  }
  const absolute = path.join(root, start)
  if (fs.existsSync(absolute)) visit(absolute)
  return found
}

// 1. README coverage
const directories = ROOTS.flatMap((entry) => walkDirectories(entry))
for (const dir of directories) {
  if (!fs.existsSync(path.join(dir, "README.md"))) {
    problems.push(`missing README.md: ${relative(dir)}`)
  }
}

// 2 & 3. links and the parent chain
const readmeFiles = [
  ROOT_README,
  ...directories.map((dir) => path.join(dir, "README.md")).filter((file) => fs.existsSync(file)),
]

const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g

function linksIn(file) {
  const text = fs.readFileSync(file, "utf8")
  const links = []
  for (const match of text.matchAll(linkPattern)) {
    const target = match[1].trim()
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
      continue
    }
    links.push(target)
  }
  return links
}

function parentLinkOf(file) {
  const text = fs.readFileSync(file, "utf8")
  const section = text.split("## 相关文档")[1]
  if (!section) return null
  const match = section.match(/父级：\[[^\]]*\]\(([^)]+)\)/)
  return match ? match[1].trim() : null
}

const hopCounts = []

for (const file of readmeFiles) {
  for (const target of linksIn(file)) {
    const resolved = path.resolve(path.dirname(file), target.split("#")[0])
    if (!fs.existsSync(resolved)) {
      problems.push(`broken link in ${relative(file)}: ${target}`)
    }
  }

  if (file === ROOT_README) continue

  let current = file
  let hops = 0
  const visited = new Set([current])

  while (hops <= MAX_HOPS) {
    const parent = parentLinkOf(current)
    if (!parent) {
      problems.push(`no 父级 link in ${relative(current)}`)
      break
    }
    const next = path.resolve(path.dirname(current), parent.split("#")[0])
    hops += 1

    if (next === ROOT_README) {
      hopCounts.push({ file: relative(file), hops })
      break
    }
    if (visited.has(next) || !fs.existsSync(next)) {
      problems.push(`父级 chain from ${relative(file)} does not reach the root README`)
      break
    }
    visited.add(next)
    current = next

    if (hops > MAX_HOPS) {
      problems.push(`父级 chain from ${relative(file)} exceeds ${MAX_HOPS} hops`)
    }
  }
}

console.log(`checked ${readmeFiles.length} README files, ${directories.length} directories`)

const deepest = hopCounts.reduce((max, item) => Math.max(max, item.hops), 0)
console.log(`deepest 父级 chain: ${deepest} hops (limit ${MAX_HOPS})`)

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log("documentation index is consistent")
