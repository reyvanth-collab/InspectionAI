const { spawnSync } = require('node:child_process')
const path = require('node:path')
const backend=path.resolve(__dirname,'..'), frontend=path.resolve(backend,'../frontend')
const preview=process.argv.includes('--preview')
for(const [cwd,script,args] of [
  [backend,require.resolve('typescript/bin/tsc'),[]],
  [frontend,path.join(frontend,'node_modules/typescript/bin/tsc'),[]],
  [frontend,path.join(frontend,'node_modules/vite/bin/vite.js'),['build']],
  [backend,path.join(__dirname,'release.integration.cjs'),[]],
]) {
  const result=spawnSync(process.execPath,[script,...args],{cwd,stdio:'inherit',env:{...process.env,INSPECTAI_WORKFLOW_BROWSER_TEST:'1',INSPECTAI_WORKFLOW_PREVIEW:preview?'1':'0'}})
  if(result.error) { console.error(result.error.message); process.exit(1) }
  if(result.status!==0) process.exit(result.status || 1)
}
