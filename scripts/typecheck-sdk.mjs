/** Type-check against public, built SDK declarations without source aliases. */
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, mkdirSync, lstatSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const sdk = process.env.DSH_SDK_ROOT
if (!sdk) throw new Error('Set DSH_SDK_ROOT to a compatible, built Harness checkout.')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fromSdk = createRequire(join(resolve(sdk), 'package.json'))
const ts = fromSdk('typescript')
const available = new Map()
for (const group of readdirSync(join(sdk, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  for (const entry of readdirSync(join(sdk, 'packages', group.name), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(sdk, 'packages', group.name, entry.name)
    try { available.set(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).name, path) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
for (const name of ['cordis', 'schemastery']) available.set(`@deepseek-ai/${name}`, join(sdk, 'vendor', name))
const sources = ts.sys.readDirectory(join(root, 'src'), ['.ts', '.tsx'])
const packages = new Set(sources.flatMap(file => [...readFileSync(file, 'utf8').matchAll(/from ['"](@deepseek-ai\/[^/'"]+)/g)].map(match => match[1])))
for (const name of packages) {
  const source = available.get(name)
  if (!source) throw new Error(`Missing SDK package ${name}`)
  link(name, source)
}
const fromPrimitives = createRequire(join(sdk, 'packages/client/ui-primitives/package.json'))
for (const name of ['@types/react', '@types/react-dom']) link(name, dirname(fromPrimitives.resolve(`${name}/package.json`)))
const options = {
  target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX,
  strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
  skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true,
  types: [], lib: ['lib.es2024.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
}
const program = ts.createProgram(sources, options)
const diagnostics = ts.getPreEmitDiagnostics(program)
console.log(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: value => value,
  getCurrentDirectory: () => root,
  getNewLine: () => '\n',
}))
if (diagnostics.length) process.exitCode = 1
else console.log('Public SDK declaration typecheck passed.')
function link(name, source) {
  const target = join(root, 'node_modules', name)
  mkdirSync(dirname(target), { recursive: true })
  try {
    const entry = lstatSync(target)
    let resolved
    try { resolved = realpathSync(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (resolved === realpathSync(source)) return
    if (!entry.isSymbolicLink()) throw new Error(`Refusing to replace ${target}`)
    unlinkSync(target)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  symlinkSync(resolve(source), target, 'junction')
}
