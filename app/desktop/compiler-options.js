'use strict'
const defaults = require('./compiler-defaults.json')
function validateOptions (value) {
  const fail = () => { throw Error('Invalid compilation options') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  function merge (input, model, depth = 0) {
    if (depth > 12) fail()
    if (input === undefined) return structuredClone(model)
    if (model === null) {
      if (input !== null && !['string', 'number', 'boolean'].includes(typeof input)) fail()
      if ((typeof input === 'number' && !Number.isFinite(input)) || (typeof input === 'string' && (input.length > 8192 || /[\x00-\x1f\u2028\u2029]/.test(input)))) fail()
      return input
    }
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
    if (typeof input !== typeof model || (typeof input === 'number' && !Number.isFinite(input)) || (typeof input === 'string' && (input.length > 8192 || /[\x00-\x1f\u2028\u2029]/.test(input)))) fail()
    return input
  }
  const user = merge({ ...value, customTheme: false }, defaults)
  const ids = (array, allowed) => { if (!Array.isArray(array) || array.length > allowed.length || array.some(x => !Number.isInteger(x) || !allowed.includes(x)) || new Set(array).size !== array.length) fail() }
  // Use the actual controller/locale IDs, not numeric ranges with unused holes.
  const selectionIds = require('../lang/english.aio.json').tweakOps.map(option => option.id)
  ids(user.options, [...selectionIds, ...selectionIds.map(id => id + 100)])
  ids(user.mainOps, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 106, 110])
  if (!Number.isInteger(user.colors) || user.colors < 0 || user.colors > 17) fail()
  // These values become unquoted shell assignments or JavaScript numeric slots.
  // Validate each field's semantics, not a shared set of shell-looking characters.
  const oneOf = (value, values) => { if (!values.includes(value)) fail() }
  const number = (value, min, max, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail()
  }
  const digits = (value, min, max) => {
    if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) fail()
    number(Number(value), min, max, true)
  }
  const hexColor = value => { if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) fail() }
  const locale = require('../lang/english.aio.json')
  for (const key of ['fuelOps', 'd2sbOps', 'disclaimOps']) oneOf(user[key], locale[key].map(x => x.id))
  // Controller bootOps1/2/3 (including the default disable selection).
  oneOf(user.boot.logo1, [0, 1, 2, 3, 4, 5, 6, 7])
  oneOf(user.boot.logo2, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  oneOf(user.boot.logo3, [0, 1, 2, 4, 7, 8, 9, 10, 11])
  for (const key of ['body', 'listitem', 'listitemdisabled', 'title', 'radio', 'labelcolor']) hexColor(user.uistyle[key])
  for (const key of ['layout', 'mainlabel']) oneOf(user.uistyle[key], [0, ...locale.uistyle[key].map(x => x.id)])
  for (const key of ['app', 'clock', 'notif']) hexColor(user.statusbar[key])
  number(user.statusbar.opacity, 0, 1)
  for (const key of ['repeat', 'fullscreen']) oneOf(user.vpOps[key], [0, 1, 2])
  const speedo = user.speedoOps, extra = user.spdExtra
  for (const key of ['lang', 'xph', 'sml', 'bg', 'effic', 'temperature']) {
    oneOf(speedo[key].id, [...Object.values(locale.speedoOps[key]).map(x => x.id), ...(key === 'lang' ? [null] : [])])
  }
  oneOf(speedo.startbar.id, [45])
  oneOf(speedo.color, [null, ...locale.speedoOps.color])
  number(speedo.opac, 0, 1)
  // The UI specifies minimum 1 second; cap at the largest safe millisecond integer.
  number(speedo.sbint, 1, Math.floor(Number.MAX_SAFE_INTEGER / 1000))
  const statusValues = ['hidden', ...defaults.spdValues.map(x => x.class), 'gpsSpeedValue']
  for (const key of ['sbmain', 'sbval1', 'sbval2']) oneOf(speedo[key], statusValues)
  oneOf(speedo.sbfuel, ['disable', 'default', 'topbar', 'bottombar'])
  oneOf(extra.fuelGaugeValueSuffix, ['%', 'Gal', 'L'])
  number(extra.fuelGaugeFactor, 1, extra.fuelGaugeValueSuffix === '%' ? 100 : 80)
  digits(extra.barThemeStart, 0, 5)
  digits(extra.barSpeedoRows, 1, 4)
  oneOf(extra.speedoctrls, ['Bar', 'Classic'])
  oneOf(user.casdk.region, ['na', 'eu'])
  for (const item of user.fuelBarColors) { if (!/^FBC(?:20|40|60|80|100)$/.test(item.bashVar) || !/^#[a-f\d]{6}$/i.test(item.colorVal)) fail() }
  for (const item of user.barThemeColors) { digits(item.num, 1, 5); for (const k of ['main', 'secondary', 'border']) hexColor(item[k]) }
  for (const item of user.spdValues) {
    oneOf(item.elmnt, defaults.spdValues.map(x => x.elmnt))
    if (item.pos.length !== 3) fail()
    item.pos.forEach((p, i) => digits(p, 0, [2, 4, 5][i]))
  }
  const audio = defaults.entertainmentItems.map(x => x.menuItem)
  for (const item of user.entertainmentItems) if (!audio.includes(item.menuItem) || !Number.isInteger(item.pos) || item.pos < 0 || item.pos > 100) fail()
  // Path-like renderer state is not read permission. Custom themes use chooser tokens only.
  user.customTheme = value.customTheme === false || value.customTheme === undefined ? false : value.customTheme
  if (user.customTheme && (typeof user.customTheme !== 'object' || typeof user.customTheme.token !== 'string')) fail()
  for (const key of ['destruct', 'aaCarGPS', 'casdkAppsOnly']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') fail()
    user[key] = value[key] === true
  }
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
