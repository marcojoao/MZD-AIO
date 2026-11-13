'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { stores, validateValue, keyParts, setKey } = require('../assets/js/desktop-client')

// All directories and metadata are trusted main-process configuration, not IPC input.
function createPreferenceService ({ directory, legacyDirectory = directory, resourceDirectory, app, paths }) {
  let tail = Promise.resolve()
  const queue = operation => {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
  function checkStore (store) {
    if (!stores.includes(store)) throw new Error('Unsupported preference store')
  }
  async function read (store) {
    checkStore(store)
    for (const dir of [...new Set([directory, legacyDirectory])]) {
      let text
      try { text = await fs.readFile(path.join(dir, store + '.json'), 'utf8') } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      try {
        const value = JSON.parse(text)
        validateValue(value)
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected object')
        return value
      } catch (error) { throw new Error(`Corrupt preference store ${store}: ${error.message}`) }
    }
    return {}
  }
  async function atomicWrite (store, data) {
    await fs.mkdir(directory, { recursive: true })
    const target = path.join(directory, store + '.json')
    const temporary = target + '.' + crypto.randomUUID() + '.tmp'
    let handle
    try {
      handle = await fs.open(temporary, 'wx', 0o600)
      await handle.writeFile(JSON.stringify(data, null, 2) + '\n')
      await handle.sync()
      await handle.close(); handle = null
      await fs.rename(temporary, target)
    } finally {
      if (handle) await handle.close()
      await fs.rm(temporary, { force: true })
    }
  }
  async function localized () {
    const readLanguage = async name => JSON.parse(await fs.readFile(path.join(resourceDirectory, 'lang', name + '.aio.json'), 'utf8'))
    const defaults = await readLanguage('english')
    const saved = (await read('aio-persist')).lang
    // Only shipped language filenames are eligible. Never resolve renderer paths.
    const available = (await fs.readdir(path.join(resourceDirectory, 'lang'))).filter(name => /^[a-z]+\.aio\.json$/.test(name)).map(name => name.slice(0, -9))
    let name = typeof saved === 'string' && available.includes(saved) ? saved : 'english'
    let selected
    try { selected = await readLanguage(name) } catch (error) { name = 'english'; selected = defaults }
    const merge = (base, extra) => {
      if (!extra || typeof extra !== 'object') return extra
      const result = Array.isArray(base) ? base.slice() : { ...base }
      for (const key of Object.keys(extra)) result[key] = extra[key] && typeof extra[key] === 'object' ? merge(result[key], extra[key]) : extra[key]
      return result
    }
    validateValue(defaults); validateValue(selected)
    const schema = JSON.parse(await fs.readFile(path.join(resourceDirectory, 'lang/aio.schema.json'), 'utf8'))
    return { name, messages: merge(defaults, selected), defaults, schema }
  }
  return {
    getPreferences: store => queue(() => read(store)),
    setPreference: (store, key, value) => {
      // Capture input now, before callers can mutate it while queued.
      let snapshot
      try { checkStore(store); keyParts(key); validateValue(value); snapshot = JSON.parse(JSON.stringify(value)) } catch (error) { return Promise.reject(error) }
      return queue(async () => {
        const data = await read(store)
        setKey(data, key, snapshot)
        validateValue(data)
        await atomicWrite(store, data)
      })
    },
    bootstrap: () => queue(async () => {
      const preferences = {}
      for (const store of stores) preferences[store] = await read(store)
      return { app: { name: app.name, version: app.version }, paths: { ...paths }, preferences, language: await localized() }
    })
  }
}
module.exports = { createPreferenceService }
