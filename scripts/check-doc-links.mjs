import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [path.join(root, 'README.md')]
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
}
await collect(path.join(root, 'docs'))

let checked = 0
const failures = []
for (const file of files) {
  const source = await readFile(file, 'utf8')
  let fence = null
  const prose = source
    .split(/\r?\n/)
    .filter((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
      if (marker) {
        if (fence === null) fence = marker
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
        return false
      }
      return fence === null
    })
    .join('\n')
  const links = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g
  for (const match of prose.matchAll(links)) {
    const target = match[1] ?? match[2]
    if (!target || target.startsWith('#')) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[/\\]/i.test(target)) continue
    checked++
    try {
      const pathname = decodeURI(target.split('#')[0])
      await access(path.resolve(path.dirname(file), pathname))
    } catch {
      failures.push({ file: path.relative(root, file).replaceAll('\\', '/'), target })
    }
  }
}
if (failures.length) {
  for (const { file, target } of failures) console.error(`${file}: ${target}`)
  console.error(`${failures.length} missing local link targets`)
  process.exitCode = 1
} else {
  console.log(`Checked ${checked} local links in ${files.length} Markdown files`)
}
