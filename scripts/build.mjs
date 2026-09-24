import { build } from 'esbuild'
import { transform } from 'lightningcss'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
await mkdir(resolve(root, 'lib'), { recursive: true })
await build({ entryPoints: [resolve(root, 'src/index.ts')], outfile: resolve(root, 'lib/index.js'), format: 'esm', platform: 'node', bundle: true })
const styles = resolve(root, 'src/styles.ts')
await build({
  entryPoints: [resolve(root, 'src/client.ts')], outfile: resolve(root, 'lib/client.js'),
  format: 'cjs', platform: 'browser', bundle: true, jsx: 'automatic', target: 'es2022',
  external: ['react', 'react/*', ...manifest.dsh.client.external],
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory(require){var module={exports:{}};var exports=module.exports;` },
  footer: { js: 'return module.exports;}});' },
  plugins: [{
    name: 'owned-css',
    setup(builder) {
      builder.onResolve({ filter: /\.module\.css$/ }, ({ path, importer }) => ({ path: resolve(dirname(importer), path), namespace: 'owned-css' }))
      builder.onLoad({ filter: /.*/, namespace: 'owned-css' }, async ({ path }) => {
        const id = relative(root, path)
        const css = transform({ filename: id, code: await readFile(path), cssModules: { pattern: 'njord_[hash]_[local]' }, minify: true })
        const classes = Object.fromEntries(Object.entries(css.exports ?? {}).map(([key, value]) => [key, value.name]))
        return { contents: `import {defineStyle} from ${JSON.stringify(styles)};defineStyle(${JSON.stringify(id)},${JSON.stringify(css.code.toString())});export default ${JSON.stringify(classes)};`, loader: 'js', resolveDir: root }
      })
    },
  }],
})

// Keep generated comments independent of the developer checkout.
const output = resolve(root, 'lib/client.js')
const code = await readFile(output, 'utf8')
await writeFile(output, code.replaceAll(root + '/', '').replace(/[ \t]+$/gm, ''))
