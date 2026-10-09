import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

/** Streams the file so a 200 MB package never lands in memory. */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject)
  })
}
