import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
function load() {
  const document = new JSDOM('<!doctype html><html><head></head><body></body></html>').window.document
  let entry
  vm.runInNewContext(code, { window: { __ModuleLoader__: { load(value) { entry = value } } }, document, console, setTimeout, clearTimeout, AbortController })
  const plugin = entry.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives' ? { Button() {} } : require(name))
  return { entry, plugin, document }
}
test('the built bundle mounts its own Remote and disposes styles and API', async () => {
  const {entry, plugin, document} = load()
  assert.equal(entry.id, '@persike/dsh-njord-ui')
  assert.equal(document.head.children.length, 0)
  const cleanup = [], children = []
  let mounts = 0, unmounts = 0
  await plugin.apply({
    remote: { async $mount(remote) { assert.ok(remote); mounts++; return async () => {unmounts++} } },
    effect(factory) {cleanup.push(factory())},
    plugin(child) {children.push(child)},
  })
  assert.equal(mounts,1)
  assert.equal(children.length,4)
  assert.ok(document.head.children.length > 0)
  for (const dispose of cleanup.reverse()) await dispose()
  assert.equal(document.head.children.length,0)
  assert.equal(unmounts,1)
})
test('a refused API mount activates no panels and installs no styles', async () => {
  const {plugin, document} = load()
  await assert.rejects(plugin.apply({ remote: {async $mount(){throw new Error('API unavailable')}}, effect(){assert.fail('effect')}, plugin(){assert.fail('panel')} }), /API unavailable/)
  assert.equal(document.head.children.length,0)
})
