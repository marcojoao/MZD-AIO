'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { read, inventory } = require('./compiler-fs')
const { unzip } = require('./compiler-zip')
const colors = ['Red', 'Blue', 'Green', 'Silver', 'Pink', 'Purple', 'Orange', 'Yellow', 'SmoothRed', 'SmoothAzure', 'SmoothViolet', 'carOS', 'StormTroopers', 'Poker', 'Mazda', 'Floating', 'X-Men', 'Custom']
const { createImageResolver } = require('./image-state')
function exists (file) { try { fs.lstatSync(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
const quoteDouble = text => text.replace(/[\\"$`]/g, '\\$&')
async function workflows ({ user, state, resources, userData, imageParent, resolveImage = createImageResolver({ resources, userData, imageParent }).resolve, stage, varDir, io, progress, addRootFiles }) {
  const builddir = path.join(resources, 'files/tweaks')
  const colorRoot = path.join(userData || resources, 'color-schemes')
  const out = relative => path.join(stage, relative)
  const copy = (source, relative, filter) => io.copy(source, out(relative), filter)
  const replace = (file, from, to) => io.write(file, read(file).toString().replaceAll(from, to))
  async function archive (file, destination) {
    if (!exists(file)) throw Error('Required asset unavailable: ' + path.basename(file) + '. Legacy downloads are disabled; import a verified asset into the application data color-schemes directory or choose another option.')
    progress('Unzipping ' + path.basename(file))
    await unzip(file, out(destination), io)
  }
  if (user.mainOps.includes(6)) {
    const rotator = state.backgroundRotator
    if (!rotator || !Number.isInteger(rotator.images) || rotator.images < 1 || rotator.images > 100 || !Number.isInteger(rotator.seconds) || rotator.seconds < 10 || rotator.seconds > 300) throw Error('Configure background rotator in the image joiner before compiling')
    io.write(path.join(varDir, 'bg-rotator.txt'), `BG_STEPS=${rotator.images}\nBG_SECONDS=${rotator.images * rotator.seconds}\nBG_SEC_EACH=${rotator.seconds}\nBG_WIDTH=${rotator.images * 800}`)
  }
  if (user.restore.full) {
    const red = path.join(colorRoot, 'Red/jci.zip')
    if (exists(red)) await archive(red, 'config/color-schemes/Red')
    else progress('Optional Red color archive unavailable; restore uses bundled original files.')
  } else if (!user.autorun.installer && !user.casdk.inst && !user.casdk.uninst && user.mainOps.includes(3)) {
    const color = colors[user.colors]
    if (user.colors === 17) {
      const grant = state.theme
      if (user.customTheme) {
        if (!grant || user.customTheme.token !== grant.token || path.basename(grant.source) !== 'jci') throw Error('Custom theme is not authorized; choose its jci folder again')
        copy(grant.source, 'config/color-schemes/theme/jci', (kind, file) => kind !== 'file' || path.extname(file).toLowerCase() === '.png')
      } else {
        io.mkdir(out('config/color-schemes/theme/jci'))
        progress('Custom theme not selected: manually place verified PNG theme files into config/color-schemes/theme/jci.')
      }
    } else {
      const colorScheme = user.colors < 8 || user.colors === 11
      const relative = 'config/color-schemes/' + (colorScheme ? color : 'theme')
      await archive(colorScheme ? path.join(colorRoot, color, 'jci.zip') : path.join(builddir, 'config/themes', color + '.zip'), relative)
      if (user.colors === 1) copy(path.join(colorRoot, 'Blue/_skin_jci_bluedemo.zip'), relative + '/_skin_jci_bluedemo.zip')
      if (!user.useColorBG) io.remove(out(relative + '/jci/gui/common/images/background.png'))
      io.remove(out(relative + '/jci/gui/common/images/no_artwork_icon.png'))
      io.remove(out(relative + '/jci/gui/apps/system/controls/OffScreen/images/OffScreenBackground.png'))
    }
  }
  function stageImage (kind, relative, useDefault = false) {
    // Write the exact validated bytes, not a second path read after resolution.
    io.write(out(relative), resolveImage(kind, useDefault).bytes)
  }
  function copyPresetMessageFile () {
    const targets = [path.join(userData || resources, 'messages/blm_msg-system.xml'), path.join(userData || resources, 'background/message_replies/jci/settings/configurations/blm_msg-system.xml'), path.join(builddir, 'config/message_replies/jci/settings/configurations/blm_msg-system.xml')]
    const source = targets.find(exists)
    if (!source) throw Error('Required preset message XML is missing')
    copy(source, 'config/message_replies/jci/settings/configurations/blm_msg-system.xml')
  }
  function special (fragments) {
    if (user.restore.full) {
      addRootFiles(false)
      fragments.push(path.join(builddir, '00___fullRestore.sh'))
      copy(path.join(builddir, 'config_org'), 'config_org')
      return true
    }
    if (!user.casdk.inst && !user.casdk.uninst) return false
    if (!user.apps) throw Error('Choose CASDK application selections before compiling')
    addRootFiles(false)
    const apps = user.apps
    const names = { simpledashboard: 'APPSIMPLEDASHBOARD', gpsspeed: 'APPGPSSPEED', multidash: 'APPMULTIDASH', vdd: 'APPVDD', devtools: 'APPDEVTOOLS', terminal: 'APPTERMINAL', background: 'APPBG', tetris: 'APPTETRIS', breakout: 'APPBREAKOUT', snake: 'APPSNAKE', clock: 'APPCLOCK', simplespeedo: 'APPSIMPLESPEEDO', sdcard: 'CASDK_SD' }
    const variables = Object.entries(names).map(([key, name]) => `${name}=${apps[key] ? 1 : 0}\n`).join('')
    io.write(path.join(varDir, 'casdkapps.txt'), variables); fragments.push(path.join(varDir, 'casdkapps.txt'))
    if (user.casdk.inst) {
      io.mkdir(out('casdk/apps'))
      for (const key of Object.keys(names)) if (key !== 'sdcard' && apps[key]) copy(path.join(builddir, 'casdk/apps/app.' + key), 'casdk/apps/app.' + key)
      if (!user.casdkAppsOnly) {
        fragments.push(path.join(builddir, '00__casdk-i.txt'), path.join(builddir, '00_storage-i.txt'))
        const region = user.casdk.region === 'eu' ? 'eu' : 'na', from = region === 'eu' ? 'na' : 'eu'
        io.write(path.join(varDir, 'casdkreg.txt'), `sed -i "s/'${from}'/'${region}'/g" /jci/gui/apps/custom/runtime/runtime.js && log_message "===                      Region Changed to ${region.toUpperCase()}                         ==="`)
        fragments.push(path.join(varDir, 'casdkreg.txt'))
      }
      fragments.push(path.join(builddir, '00__casdkapps-i.txt'))
      copy(path.join(builddir, 'casdk'), 'casdk', (_, source) => !path.relative(path.join(builddir, 'casdk'), source).split(path.sep).includes('apps'))
    } else fragments.push(path.join(builddir, user.casdkAppsOnly ? '00__casdkapps-u.txt' : '00__casdk-u.txt'))
    return true
  }
  function autorun () {
    const destination = user.autorun.serial ? 'XX' : ''
    const base = out(destination)
    const source = path.join(builddir, 'cmu-autorun')
    copy(path.join(source, 'installer'), destination)
    if (user.autorun.id7recovery || user.autorun.serial) {
      copy(path.join(source, 'sdcard/recovery'), destination)
      for (const name of inventory(base)) if (name.endsWith('.md') || /^02-[^/]+\/[^/]+\.txt$/.test(name)) io.remove(path.join(base, name))
      io.remove(path.join(base, user.autorun.serial ? 'tweaks.sh' : 'run.sh'))
      if (!user.autorun.serial && !user.backups.skipconfirm) replace(path.join(base, 'tweaks.sh'), '# confirmation ', '')
    }
    if (user.autorun.autoADB || user.autorun.autoWIFI) {
      copy(path.join(source, 'sdcard/recovery-extra'), destination)
      if (!user.autorun.autoADB) { io.remove(path.join(base, '02-start-adb')); io.remove(path.join(base, 'adb')) }
      if (!user.autorun.autoWIFI) io.remove(path.join(base, '02-start-wifiAP'))
    }
    if (user.autorun.dryrun && !user.autorun.serial) copy(path.join(source, 'sdcard/dryrun'), destination)
    if (user.autorun.autoWIFI) {
      if (!user.wifi) throw Error('WiFi AP requires an SSID and password; configure them or disable WiFi AP')
      io.write(path.join(base, '02-start-wifiAP/wifiAP.config'), `# This is your wifiAP.config file\nexport NETWORK_WIFI_SSID="${quoteDouble(user.wifi.ssid)}"\nexport NETWORK_WIFI_PASSWORD="${quoteDouble(user.wifi.password)}"\n`)
    }
    if (user.autorun.serial) for (const name of fs.readdirSync(base)) if (name === 'jci-autoupdate' || /\.(?:temp|txt|md|up|sh)$/.test(name)) io.remove(path.join(base, name))
  }
  return { special, autorun, archive, stageImage, copyPresetMessageFile, quoteDouble }
}
module.exports = { workflows }
