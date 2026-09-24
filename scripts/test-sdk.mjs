import { createRequire } from 'node:module'
import { mkdirSync, existsSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const sdk = process.env.DSH_SDK_ROOT
if (!sdk) throw new Error('Set DSH_SDK_ROOT to a compatible DeepSeek Harness source checkout with development dependencies installed.')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const req = createRequire(join(sdk, 'package.json'))
const ts = req('typescript')
const parsed = ts.readConfigFile(join(sdk, 'tsconfig.base.json'), ts.sys.readFile).config
const aliases = Object.entries(parsed.compilerOptions.paths).map(([key, paths]) => ({find: '^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.*)') + '$', replacement: resolve(sdk, paths[0]).replace('*','$1')})).sort((a,b)=>b.find.length-a.find.length)
for (const name of ['vitest', '@testing-library/react', 'react', 'react-dom', 'jsdom']) {
 let source = (name === 'react' || name === 'react-dom' ? createRequire(join(sdk, 'packages/client/ui-primitives/package.json')) : req).resolve(name)
 while (!existsSync(join(source, 'package.json'))) source = dirname(source)
 const target = join(root, 'node_modules', name)
 mkdirSync(dirname(target), {recursive:true})
 if (!existsSync(target)) symlinkSync(source, target)
}
const config = join(root, '.vitest-sdk.mjs')
writeFileSync(config, `const config = ${JSON.stringify({root,resolve:{alias:aliases},test:{environment:'jsdom',include:['tests/**/*.client.spec.ts','tests/**/*.client.spec.tsx'],pool:'forks',maxWorkers:4}})};config.resolve.alias=config.resolve.alias.map(entry=>({...entry,find:new RegExp(entry.find)}));export default config;`)
const run = spawnSync(process.execPath, [join(dirname(req.resolve('vitest/package.json')), 'vitest.mjs'), 'run', '--config', config], {cwd:root,stdio:'inherit'})
process.exitCode = run.status ?? 1
