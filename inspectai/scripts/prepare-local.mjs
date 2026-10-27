/** Make an isolated, updateable local checkout without modifying the current one. */
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, chmodSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
if (args.length % 2 || args.some((value, index) => index % 2 === 0 && !['--repo', '--target'].includes(value))) {
  console.error('Usage: node prepare-local.mjs [--repo PATH] [--target PATH]')
  process.exit(2)
}
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]))
const repo = path.resolve(options['--repo'] || '.')
const branch = 'release/november-product-completion'
const git = (cwd, ...values) => execFileSync('git', ['-C', cwd, ...values], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
try {
  const root = git(repo, 'rev-parse', '--show-toplevel')
  if (!existsSync(path.join(root, 'inspectai/backend/package.json'))) throw new Error('Run this against the InspectionAI repository.')
  const target = path.resolve(options['--target'] || path.join(path.dirname(root), `${path.basename(root)}-november`))
  if (target === root || target.startsWith(root + path.sep)) throw new Error('Choose a separate sibling folder, outside the current checkout.')
  git(root, 'fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`)
  const remote = `refs/remotes/origin/${branch}`
  if (existsSync(target)) {
    if (path.resolve(git(target, 'rev-parse', '--show-toplevel')) !== target) throw new Error('The target is not a separate Git checkout. Choose an empty path.')
    const common = cwd => path.resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir'))
    if (common(target) !== common(root)) throw new Error('The target belongs to a different repository. Choose a new sibling path.')
    if (git(target, 'status', '--porcelain')) throw new Error('The target contains local changes. Commit or preserve them before updating; nothing was discarded.')
    if (git(target, 'branch', '--show-current') !== 'local/november-product') throw new Error('The target is on another branch. Choose a new sibling path.')
    git(target, 'merge', '--ff-only', remote)
  } else {
    git(root, 'worktree', 'add', '-b', 'local/november-product', target, remote)
  }
  // Only copy existing local configuration into a new checkout. Never overwrite,
  // print, commit or substitute example values for a configured environment.
  for (const relative of ['inspectai/backend/.env', 'inspectai/frontend/.env']) {
    const source = path.join(root, relative), destination = path.join(target, relative)
    if (existsSync(source) && !existsSync(destination)) {
      const ignored = execFileSync('git', ['-C', target, 'check-ignore', '--', relative], { encoding: 'utf8' }).trim()
      if (!ignored) throw new Error('Environment files must be ignored before copying.')
      copyFileSync(source, destination)
      if (process.platform !== 'win32') chmodSync(destination, 0o600)
      console.log(`Preserved local configuration: ${relative}`)
    }
  }
  console.log(`Ready: ${target}\nCommit: ${git(target, 'rev-parse', '--short', 'HEAD')}\nOpen this folder in VS Code. Follow inspectai/docs/LOCAL_WINDOWS.md. No database changes or installs were run.`)
} catch (error) {
  // Git failures may contain local paths, but never print environment contents.
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
