/* Browser-only preference cache. Also imported by the main service for shared validation. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MZDDesktop = api
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict'
  const stores = Object.freeze(['aio-data', 'aio-persist', 'aio-data-obj', 'aio-last', 'user-themes', 'casdk', 'MZD_Speedometer'])
  const forbidden = ['__proto__', 'prototype', 'constructor']
  const own = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key)
  function keyParts (key) {
    if (typeof key !== 'string' || !key) throw new Error('Invalid preference key')
    const split = key.split('.')
    const parts = []
    for (let i = 0; i < split.length; i++) {
      let part = split[i]
      while (part.endsWith('\\') && i + 1 < split.length) part = part.slice(0, -1) + '.' + split[++i]
      if (!part || forbidden.includes(part)) throw new Error('Invalid preference key')
      parts.push(part)
    }
    return parts
  }
  function validateValue (value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
    if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('Expected JSON value')
    const proto = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('Expected JSON object')
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Expected JSON value')
    seen.add(value)
    for (const key of Object.keys(value)) {
      if (forbidden.includes(key)) throw new Error('Invalid preference key')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!own(descriptor, 'value')) throw new Error('Expected JSON value')
      validateValue(descriptor.value, seen)
    }
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new Error('Expected JSON array without extra properties')
      for (let i = 0; i < value.length; i++) if (!own(value, i)) throw new Error('Expected JSON array')
    }
    seen.delete(value)
  }
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  function setKey (object, key, value) {
    const parts = keyParts(key)
    for (const part of parts.slice(0, -1)) {
      if (!own(object, part) || !object[part] || typeof object[part] !== 'object') object[part] = {}
      object = object[part]
    }
    object[parts[parts.length - 1]] = value
  }
  function lookup (object, key) {
    for (const part of keyParts(key)) {
      if (!own(object, part)) return { found: false }
      object = object[part]
    }
    return { found: true, value: object }
  }
  function mergeDefaults (defaults, saved) {
    validateValue(defaults); validateValue(saved)
    function merge (base, extra) {
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return clone(extra)
      const result = base && typeof base === 'object' && !Array.isArray(base) ? clone(base) : {}
      for (const key of Object.keys(extra)) result[key] = merge(result[key], extra[key])
      return result
    }
    return merge(defaults, saved)
  }
  function createDesktopClient (data, api, onError = () => {}) {
    validateValue(data.preferences)
    let tail = Promise.resolve()
    let failure
    const cache = {}
    const flush = () => tail.then(() => { if (failure) throw failure })
    function enqueue (name, entries) {
      const result = tail.then(async () => {
        if (failure) throw failure
        for (const [key, value] of entries) await api.setPreference(name, key, value)
      })
      // Always attach a rejection handler for legacy synchronous event callers.
      // Keep the failure sticky: optimistic cache must never be mistaken for saved state.
      tail = result.catch(error => { if (!failure) { failure = error; try { onError(error) } catch (_) {} } })
      return result
    }
    for (const name of stores) {
      if (!own(data.preferences, name) || !data.preferences[name] || Array.isArray(data.preferences[name])) throw new Error('Missing preference store: ' + name)
      let state = clone(data.preferences[name])
      cache[name] = {
        get (key, fallback) { const result = lookup(state, key); return clone(result.found ? result.value : fallback) },
        has (key) { return lookup(state, key).found },
        set (key, value) {
          const entries = typeof key === 'string' ? [[key, value]] : Object.entries(key || {})
          if (typeof key !== 'string') validateValue(key)
          for (const [key, value] of entries) { keyParts(key); validateValue(value) }
          const captured = entries.map(([key, value]) => [key, clone(value)])
          const next = clone(state)
          for (const [key, value] of captured) setKey(next, key, clone(value))
          validateValue(next)
          state = next
          return enqueue(name, captured)
        },
        get store () { return clone(state) },
        get size () { return Object.keys(state).length },
        flush
      }
    }
    return { stores: cache, flush }
  }
  const startups = new WeakMap()
  function startDesktop (window, initialize = () => {}) {
    if (startups.has(window)) return startups.get(window)
    const document = window.document
    const ready = document.readyState === 'loading' ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true })) : Promise.resolve()
    const startup = Promise.all([ready, Promise.resolve().then(() => window.aio.bootstrap())]).then(async ([, data]) => {
      const report = error => {
        const message = 'MZD-AIO could not save preferences: ' + error.message
        if (window.bootbox) window.bootbox.alert(message)
        else if (window.console) window.console.error(message)
      }
      const client = createDesktopClient(data, window.aio, report)
      Object.assign(window, { desktopData: data, desktopClient: client, settings: client.stores['aio-data'], persistantData: client.stores['aio-persist'], dataObj: client.stores['aio-data-obj'], lastView: client.stores['aio-last'], userThemes: client.stores['user-themes'], casdkApps: client.stores.casdk, speedoSave: client.stores.MZD_Speedometer, lang: data.language.name, langObj: data.language.messages, langDef: data.language.defaults, translateSchema: data.language.schema })
      await initialize(data)
      window.angular.bootstrap(document, ['AIO'])
    }).catch(async error => {
      await ready
      document.body.textContent = 'MZD-AIO could not start: ' + error.message
      document.body.removeAttribute && document.body.removeAttribute('ng-cloak')
    })
    startups.set(window, startup)
    return startup
  }
  // Call only with the fixed local script list owned by index.html.
  async function loadDesktopScripts (window, sources) {
    for (const source of sources) await new Promise((resolve, reject) => {
      const script = window.document.createElement('script')
      script.src = source
      script.async = false
      script.onload = resolve
      script.onerror = () => reject(new Error('Could not load ' + source))
      window.document.head.appendChild(script)
    })
  }
  return { loadDesktopScripts, stores, validateValue, keyParts, setKey, mergeDefaults, createDesktopClient, startDesktop }
})
