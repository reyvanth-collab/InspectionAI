import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const helper = fileURLToPath(new URL('./prepare-local.mjs', import.meta.url))
test('local update preserves dirty original, copies ignored env only once and refuses dirty or divergent target', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'inspectai-sync-'))
  const origin = path.join(temp, 'remote'), clone = path.join(temp, 'laptop'), target = clone + '-november'
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const run = () => spawnSync(process.execPath, [helper, '--repo', clone], { encoding: 'utf8' })
  try {
    mkdirSync(origin)
    git(origin, 'init', '-b', 'release/november-product-completion')
    git(origin, 'config', 'user.name', 'Fixture'); git(origin, 'config', 'user.email', 'fixture@example.invalid')
    for (const dir of ['backend', 'frontend']) {
      mkdirSync(path.join(origin, 'inspectai', dir), { recursive: true })
      writeFileSync(path.join(origin, 'inspectai', dir, 'package.json'), '{}\n')
    }
    writeFileSync(path.join(origin, '.gitignore'), '.env\n')
    git(origin, 'add', '.'); git(origin, 'commit', '-m', 'fixture base')
    git(temp, 'clone', origin, clone)
    git(clone, 'config', 'user.name', 'Fixture'); git(clone, 'config', 'user.email', 'fixture@example.invalid')
    writeFileSync(path.join(clone, 'inspectai/backend/.env'), 'SYNTHETIC_CONFIG=keep-local\n')
    writeFileSync(path.join(clone, 'inspectai/backend/package.json'), '{"local":"unsaved"}\n')
    const dirty = git(clone, 'status', '--porcelain')
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    assert.equal(git(clone, 'status', '--porcelain'), dirty)
    assert(!first.stdout.includes('SYNTHETIC_CONFIG'))
    assert.equal(readFileSync(path.join(target, 'inspectai/backend/.env'), 'utf8'), 'SYNTHETIC_CONFIG=keep-local\n')
    writeFileSync(path.join(target, 'inspectai/backend/.env'), 'SYNTHETIC_CONFIG=target-wins\n')
    writeFileSync(path.join(origin, 'release-note.txt'), 'new remote change')
    git(origin, 'add', '.'); git(origin, 'commit', '-m', 'fixture update')
    assert.equal(run().status, 0)
    assert(existsSync(path.join(target, 'release-note.txt')))
    assert.equal(readFileSync(path.join(target, 'inspectai/backend/.env'), 'utf8'), 'SYNTHETIC_CONFIG=target-wins\n')
    writeFileSync(path.join(target, 'release-note.txt'), 'local change')
    assert.notEqual(run().status, 0)
    assert.equal(readFileSync(path.join(target, 'release-note.txt'), 'utf8'), 'local change')
    git(target, 'add', '.'); git(target, 'commit', '-m', 'local commit')
    writeFileSync(path.join(origin, 'remote-only.txt'), 'remote change')
    git(origin, 'add', '.'); git(origin, 'commit', '-m', 'diverge')
    const before = git(target, 'rev-parse', 'HEAD')
    assert.notEqual(run().status, 0)
    assert.equal(git(target, 'rev-parse', 'HEAD'), before)
    assert.equal(git(clone, 'status', '--porcelain'), dirty)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
