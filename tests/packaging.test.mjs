import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('shares the installed plugin through a required semver peer', () => {
  assert.equal(manifest.peerDependencies['@persike/dsh-project-tools'], '0.1.0')
  assert.equal(manifest.dependencies?.['@persike/dsh-project-tools'], undefined)
  assert.notEqual(manifest.peerDependenciesMeta?.['@persike/dsh-project-tools']?.optional, true)
  for (const dependencies of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
    for (const spec of Object.values(dependencies ?? {})) {
      assert.doesNotMatch(spec, /^(?:git(?:\+|:)|github:|https?:|file:|link:)/)
    }
  }
})
