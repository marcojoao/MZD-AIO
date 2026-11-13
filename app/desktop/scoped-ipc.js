'use strict'
const { createSenderGuard } = require('./ipc-sender')
// Internal registration table; never exposed as a generic renderer dispatcher.
function registerScopedIpc ({ ipcMain, scopes, methods }) {
  const pending = new Set()
  const guards = scopes.map(scope => ({ ...scope, guard: createSenderGuard(scope) }))
  for (const [name, method] of Object.entries(methods)) ipcMain.handle('aio:' + name, async (event, ...args) => {
    const scope = guards.find(scope => scope.getWebContents() === event?.sender)
    if (!scope) throw Error('Untrusted sender/frame')
    scope.guard(event)
    if (!scope.capabilities.includes(name)) throw Error('Missing window capability')
    if (args.length !== method.count) throw Error('Invalid arguments')
    const operation = Promise.resolve().then(() => method.run(scope, ...args))
    pending.add(operation)
    try { return await operation } finally { pending.delete(operation) }
  })
  // Main-only close barrier. No generic transport or drain crosses preload.
  return () => Promise.all([...pending])
}
module.exports = { registerScopedIpc }
