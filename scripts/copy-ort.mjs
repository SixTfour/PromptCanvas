import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copy the ONNX Runtime web files into public/ort/.
 *
 * Left to itself, onnxruntime-web fetches its runtime from jsDelivr at the
 * moment a model loads. That works on a dev server with no Content Security
 * Policy and fails on a deployed build with one, which is a miserable way to
 * find out — and it quietly undermines the claim that this app works offline,
 * since the runtime would be pulled from a third party on every cold start.
 *
 * Copying from node_modules rather than pinning a URL means the files always
 * match the installed version. A version skew here surfaces as a wasm that
 * refuses to instantiate.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEST = path.join(ROOT, 'public', 'ort')
const ORT_DIST = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist')

/*
 * Only the asyncify variant: it is the one @huggingface/transformers references
 * in its web build. The other three (jsep, jspi, plain) add ~56 MB between them
 * and are never requested from the browser path.
 */
const NEEDED = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']

if (!fs.existsSync(ORT_DIST)) {
  console.error(`copy-ort: ${ORT_DIST} not found. Run npm install first.`)
  process.exit(1)
}

fs.mkdirSync(DEST, { recursive: true })

let copied = 0
let current = 0
for (const name of NEEDED) {
  const from = path.join(ORT_DIST, name)
  const to = path.join(DEST, name)
  if (!fs.existsSync(from)) {
    console.error(`copy-ort: missing ${name} in ${ORT_DIST}`)
    process.exit(1)
  }
  // Skip an unchanged file rather than re-writing 25 MB on every build.
  if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) {
    current++
    continue
  }
  fs.copyFileSync(from, to)
  copied++
}

const total = NEEDED.reduce((sum, n) => sum + fs.statSync(path.join(DEST, n)).size, 0)
console.log(
  `copy-ort: ${copied} copied, ${current} already current ` +
    `(${(total / 1048576).toFixed(1)} MB in public/ort/)`,
)
