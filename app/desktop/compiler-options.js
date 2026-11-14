'use strict'
const defaults = require('./compiler-defaults.json')
function validateOptions (value) {
  const fail = () => { throw Error('Invalid compilation options') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  function merge (input, model, depth = 0) {
    if (depth > 12) fail()
    if (input === undefined) return structuredClone(model)
    if (model === null) { if (input !== null && !['string', 'number', 'boolean'].includes(typeof input)) fail(); return input }
    if (Array.isArray(model)) {
      if (!Array.isArray(input) || input.length > 200) fail()
      return input.map((v, i) => model.length ? merge(v, model[i] || model[0], depth + 1) : v)
    }
    if (typeof model === 'object') {
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail()
      const result = {}
      for (const key of Object.keys(input)) if (['__proto__', 'constructor', 'prototype'].includes(key)) fail()
      for (const [k, v] of Object.entries(model)) result[k] = merge(input[k], v, depth + 1)
      return result
    }
    if (typeof input !== typeof model || (typeof input === 'number' && !Number.isFinite(input)) || (typeof input === 'string' && (input.length > 8192 || /[\x00-\x1f]/.test(input)))) fail()
    return input
  }
  const user = merge({ ...value, customTheme: false }, defaults)
  const ids = (array, allowed) => { if (!Array.isArray(array) || array.length > allowed.length || array.some(x => !Number.isInteger(x) || !allowed.includes(x)) || new Set(array).size !== array.length) fail() }
  // Use the actual controller/locale IDs, not numeric ranges with unused holes.
  const selectionIds = require('../lang/english.aio.json').tweakOps.map(option => option.id)
  ids(user.options, [...selectionIds, ...selectionIds.map(id => id + 100)])
  ids(user.mainOps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 106, 110])
  if (!Number.isInteger(user.colors) || user.colors < 0 || user.colors > 17) fail()
  for (const n of Object.values(user.boot)) if (!Number.isInteger(n) || n < 0 || n > 100) fail()
  const scalar = s => { if (typeof s === 'string' && !/^[\w#.% ,()+:/-]*$/.test(s)) fail() }
  for (const group of [user.uistyle, user.statusbar, user.speedoOps, user.spdExtra, user.vpOps]) for (const v of Object.values(group)) if (!v || typeof v !== 'object') scalar(v)
  for (const item of user.fuelBarColors) { if (!/^FBC(?:20|40|60|80|100)$/.test(item.bashVar) || !/^#[a-f\d]{6}$/i.test(item.colorVal)) fail() }
  for (const item of user.barThemeColors) { if (!/^\d+$/.test(item.num)) fail(); for (const k of ['main', 'secondary', 'border']) if (!/^(?:#[a-f\d]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d.,% ]+\))$/i.test(item[k])) fail() }
  for (const item of user.spdValues) if (!/^[a-zA-Z]\w*$/.test(item.elmnt) || !Array.isArray(item.pos) || item.pos.some(p => !/^-?\d+$/.test(String(p)))) fail()
  const audio = defaults.entertainmentItems.map(x => x.menuItem)
  for (const item of user.entertainmentItems) if (!audio.includes(item.menuItem) || !Number.isInteger(item.pos) || item.pos < 0 || item.pos > 100) fail()
  // Path-like renderer state is not read permission. Custom themes use chooser tokens only.
  user.customTheme = value.customTheme === false || value.customTheme === undefined ? false : value.customTheme
  if (user.customTheme && (typeof user.customTheme !== 'object' || typeof user.customTheme.token !== 'string')) fail()
  user.destruct = value.destruct === true
  user.aaCarGPS = value.aaCarGPS === true
  user.casdkAppsOnly = value.casdkAppsOnly === true
  if (value.apps !== undefined) {
    if (!value.apps || typeof value.apps !== 'object' || Array.isArray(value.apps)) fail()
    user.apps = {}
    for (const k of ['simpledashboard', 'gpsspeed', 'multidash', 'vdd', 'devtools', 'terminal', 'background', 'tetris', 'breakout', 'snake', 'clock', 'simplespeedo', 'sdcard']) { if (value.apps[k] !== undefined && typeof value.apps[k] !== 'boolean') fail(); user.apps[k] = value.apps[k] === true }
  }
  if (value.wifi !== undefined) {
    if (!value.wifi || typeof value.wifi.ssid !== 'string' || typeof value.wifi.password !== 'string' || /[\x00-\x1f]/.test(value.wifi.ssid + value.wifi.password) || value.wifi.ssid.length > 32 || value.wifi.password.length > 63 || value.wifi.password.length < 8) fail()
    user.wifi = { ssid: value.wifi.ssid, password: value.wifi.password }
  }
  return user
}
module.exports = { validateOptions }
