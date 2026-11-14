// Selection order and generated variable/config formatting ported from the
// legacy builder. Main-owned I/O helpers throw rather than succeeding on errors.
'use strict'
module.exports = function generateSelections (context, user) {
  const { fs, path, mkdirp, builddir, varDir, tmpdir, addTweakDir, stageImage,
    addRootFiles, copyPresetMessageFile, buildEntList, replaceInFile,
    concatenate, quoteDouble } = context
  const tweaks2write = [builddir + '00_intro.txt']
  let themeColor = 'Red'
  let copySwapfile = false
  let swapdest = ''
  let barColorFile = context.barColorHeader
  const addTweak = name => tweaks2write.push(builddir + name)
  tweakVariables(user)
  tweaks2write.push(builddir + '00_start.txt')
  if (!context.special(tweaks2write)) {
    // Legacy buildTweaksConfig inserts these before every uninstall/install.
    if (user.mainOps.includes(1)) addTweak('00_backup.txt')
    if (user.mainOps.includes(0) || user.options.includes(21)) addTweak('00_wifi.txt')
    if (user.mainOps.includes(4) || user.options.includes(21)) addTweak('00_sshbringback.txt')
    buildTweak(user)
  }
  return { fragments: tweaks2write, copySwapfile, swapdest }
function buildTweak (user) {
  // ****************************************************/
  // **********Write uninstalls first********************/
  // ****************************************************/
  if (user.options.includes(101)) {
    addTweak('01_touchscreen-u.txt')
  }
  if (user.options.includes(102)) {
    addTweak('02_disclaimer-u.txt')
  }
  if (user.options.includes(103)) {
    addTweak('03_warning-u.txt')
    addTweakDir('safety-warning-reverse-camera', false)
  }
  if (user.options.includes(104)) {
    addTweak('04_sensor-u.txt')
    addTweakDir('transparent-parking-sensor', false)
  }
  if (user.options.includes(105)) {
    addTweak('05_mainloop-u.txt')
  }
  if (user.options.includes(106)) {
    addTweak('06_listloop-u.txt')
  }
  if (user.options.includes(107)) {
    addTweak('07_shorterdelay-u.txt')
  }
  if (user.options.includes(108)) {
    addTweak('08_sysbeep-u.txt')
  }
  if (user.options.includes(109)) {
    addTweak('09_audioorder-u.txt')
  }
  if (user.options.includes(110)) {
    addTweak('10_pausemute-u.txt')
  }
  if (user.options.includes(111)) {
    addTweak('11_msgreplies-u.txt')
  }
  if (user.options.includes(112)) {
    addTweak('12_diag-u.txt')
  }
  if (user.options.includes(113)) {
    addTweak('13_boot-u.txt')
    addTweakDir('bootanimation', false)
  }
  if (user.options.includes(114)) {
    addTweak('14_bgart-u.txt')
    addTweakDir('bigger-album-art', false)
  }
  if (user.options.includes(115)) {
    addTweak('15_btnbackground-u.txt')
    addTweakDir('NoButtons', false)
  }
  if (user.options.includes(116)) {
    addTweak('16_blnkframe-u.txt')
    addTweakDir('blank-album-art-frame', false)
  }
  if (user.options.includes(118)) {
    addTweak('18_swapfile-u.txt')
  }
  if (user.options.includes(122)) {
    addTweak('22_fuel-u.txt')
    addTweakDir('FuelConsumptionTweak', false)
  }
  if (user.options.includes(121)) {
    addTweak('08_orderflac-u.txt')
    addTweakDir('media-order-patching', false)
  }
  if (user.options.includes(126)) {
    addTweak('26_usbaudiomod-u.txt')
    addTweakDir('USBAudioMod', false)
  }
  if (user.mainOps.includes(106)) {
    addTweak('00_bgrotator-u.txt')
    addTweakDir('BackgroundRotator', false)
  }
  if (user.options.includes(124)) {
    addTweak('24_castscreen-u.txt')
  }
  if (user.options.includes(117)) {
    addTweak('17_videoplayer-u.txt')
  }
  if (user.options.includes(119)) {
    addTweak('19_speedo-u.txt')
  }
  if (user.options.includes(125)) {
    addTweak('25_androidauto-u.txt')
  }
  if (user.options.includes(127)) {
    addTweak('27_aioapp-u.txt')
  }
  if (user.mzdmeter.uninst) {
    addTweak('28_mzdmeter-u.txt')
  }
  // ****************************************************/
  // ******************Write Installs********************/
  // ****************************************************/
  if (user.mainOps.includes(3)) {
    if (user.colors === 0) {
      addTweak('21_colors-u.txt')
    } else if (user.colors < 8 || user.colors === 11) {
      addTweak('21_colors-i.txt')
    } else {
      addTweak('21_theme-i.txt')
    }
  }
  if (user.options.includes(1)) {
    addTweak('01_touchscreen-i.txt')
  }
  if (user.options.includes(2)) {
    addTweak('02_disclaimer-i.txt')
  }
  if (user.options.includes(3)) {
    addTweak('03_warning-i.txt')
    addTweakDir('safety-warning-reverse-camera', true)
  }
  if (user.options.includes(4)) {
    addTweak('04_sensor-i.txt')
    addTweakDir('transparent-parking-sensor', true)
  }
  if (user.options.includes(5)) {
    addTweak('05_mainloop-i.txt')
    addTweakDir('main-menu-loop', true)
  }
  if (user.options.includes(6)) {
    addTweak('06_listloop-i.txt')
    addTweakDir('list-loop', true)
  }
  if (user.options.includes(7)) {
    addTweak('07_shorterdelay-i.txt')
  }
  if (user.listbeep) {
    addTweak('07_listbeep-i.txt')
  }
  if (user.options.includes(8)) {
    addTweak('08_sysbeep-i.txt')
  }
  if (user.options.includes(9)) {
    addTweak('09_audioorder-i.txt')
  }
  if (user.options.includes(10)) {
    addTweak('10_pausemute-i.txt')
  }
  if (user.options.includes(19)) {
    addTweak('19_speedo-i1.txt', true)
    switch (user.speedoOps.lang.id) {
      case 1:
        break
      case 2:
        addTweak('19_speedo-spanish.txt', true)
        break
      case 3:
        addTweak('19_speedo-polish.txt', true)
        break
      case 4:
        addTweak('19_speedo-slovic.txt', true)
        break
      case 5:
        addTweak('19_speedo-turkish.txt', true)
        break
      case 6:
        addTweak('19_speedo-french.txt', true)
        break
      case 7:
        addTweak('19_speedo-italian.txt', true)
        break
      case 8:
        addTweak('19_speedo-dutch.txt', true)
        break
      default:
        addTweak('19_speedo-english.txt', true)
    }
    if (user.speedoOps.xph.id === 10) {
      addTweak('19_speedo-mph.txt', true)
    }
    if (user.speedoOps.effic.id === 40) {
      addTweak('19_speedo-kml.txt', true)
    }
    if (user.speedoOps.classicLargeText) {
      addTweak('19_speedo-lrgtxt.txt', true)
    }
    if (user.speedoOps.temperature.id === 43) {
      addTweak('19_speedo-temp.txt', true)
    }
    if (user.speedoOps.modAlt) {
      addTweak('19_speedo-analog.txt', true)
    }
    if (user.speedoOps.simpmod) {
      addTweak('19_speedo_bar.txt', true)
    }
    if (user.speedoOps.bg.id === 30) {
      addTweak('19_speedo-own_background.txt', true)
    } else if (user.speedoOps.bg.id === 31) {
      addTweak('19_speedo-old_background.txt', true)
    }
    if (user.speedoOps.sml.id === 22) {
      addTweak('19_speedo-small_speedo_off.txt', true)
    } else {
      if (user.speedoOps.sbmain !== undefined) {
        addTweak('19_set_sb_values.txt', true)
      }
      if (user.speedoOps.sbfuel !== 'disable') {
        addTweak('19_sbfuelbar.txt', true)
      }
      if (user.speedoOps.digiclock) {
        addTweak('19_speedo-digiclock.txt', true)
      }
      if (user.speedoOps.sbreverse) {
        addTweak('19_speedo-sbhiderev.txt', true)
      }
      if (!user.speedoOps.sbhideinapp) {
        addTweak('19_speedo-sbdonthide.txt', true)
      }
    }
    addTweak('19_speedo-i2.txt', true)
    addTweakDir('speedometer', true)
    writeSpeedoConfigFile(user)
  }
  if (user.options.includes(21)) {
    addTweak('08_orderflac-i.txt')
    addTweakDir('media-order-patching', true)
  }
  if (user.options.includes(24)) {
    addTweak('24_castscreen-i.txt')
    addTweakDir('castscreen-receiver', true)
  }
  if (user.options.includes(11)) {
    addTweak('11_msgreplies-i.txt')
    copyPresetMessageFile()
  }
  if (user.options.includes(13)) {
    addTweak('13_boot-i.txt')
    addTweakDir('bootanimation', true)
  }
  if (user.options.includes(26)) {
    addTweak('26_usbaudiomod-i.txt') // USB Audio Mod Install comes before Bigger Album Art
    addTweakDir('USBAudioMod', true)
  }
  if (user.options.includes(14)) {
    addTweak('14_bgart-i.txt')
    addTweakDir('bigger-album-art', true)
  }
  if (user.options.includes(15)) {
    addTweak('15_btnbackground-i.txt')
    addTweakDir('NoButtons', true)
  }
  if (user.options.includes(16)) {
    addTweakDir('blank-album-art-frame', true)
  }
  if (user.options.includes(17)) {
    addTweak('17_videoplayer-i.txt')
    addTweakDir('videoplayer', true)
  }
  if (user.options.includes(27)) {
    addTweak('27_aioapp-i.txt')
    if (user.screenOffBoot) {
      addTweak('27_aioapp-screenoff.txt')
    }
    addTweakDir('aio-app', true)
  }
  if (user.options.includes(27) || user.options.includes(17)) {
    addTweak('00_storage-i.txt', true)
  }
  if (user.mzdmeter.inst) {
    addTweak('28_mzdmeter-i.txt')
    addTweakDir('mzdmeter', true)
  }
  if (user.options.includes(22)) {
    addTweak('22_fuel-i.txt')
    addTweakDir('FuelConsumptionTweak', true)
  }
  if (user.options.includes(25)) {
    if (user.aaHUD) {
      addTweakDir('androidauto', true, replaceInFile, `${tmpdir}/config/androidauto/data_persist/dev/bin/headunit-wrapper`, `DEBUG=0`, `DEBUG=1`)
    } else {
      addTweakDir('androidauto', true)
    }
    addTweak('25_androidauto-i.txt')
    if (user.aaCarGPS) {
      addTweak('25_androidautocargps.txt')
    } else if (user.aaBetaVer) {
      addTweak('25_androidautorevgps.txt')
    }
    if (user.aaWifi) {
      if (user.aaHUD) {
        addTweakDir('androidautowifi', true, replaceInFile, `${tmpdir}/config/androidautowifi/headunit-wrapper`, `DEBUG=0`, `DEBUG=1`)
      } else {
        addTweakDir('androidautowifi', true)
      }
      addTweak('25_androidautowifi-i.txt')
    }
  }
  if (user.mainOps.includes(4) || user.options.includes(21)) {
    addTweakDir('ssh_bringback', true)
  }
  // disclaimer & order of audio source list
  if (user.options.includes(2) || user.options.includes(9) || user.options.includes(102) || user.options.includes(109)) {
    addTweakDir('audio_order_AND_no_More_Disclaimer', true)
    buildEntList(user)
  }
  // Statusbar Tweaks
  if (user.options.includes(120)) {
    addTweak('20_date-u.txt')
    addTweakDir('date-to-statusbar_mod', false)
  } else if (user.options.includes(20)) {
    if (user.statusbar.d2sbuninst) {
      addTweak('20_date2status-u.txt')
      addTweakDir('date-to-statusbar_mod', false)
    } else if (user.statusbar.d2sbinst) {
      if (user.d2sbOps === 0) {
        addTweak('20_date-iv1.txt')
      } else {
        addTweak('20_date-iv3.3.txt')
      }
      addTweakDir('date-to-statusbar_mod', true)
    }
    if (user.statusbar.uninst) {
      addTweak('20_statusbar_tweaks-u.txt')
    } else {
      addTweak('20_statusbar_tweaks-i.txt')
    }
  }
  if (user.uistyle.uninst) {
    addTweak('20_uistyle-u.txt')
  } else if (user.mainOps.includes(9)) {
    addTweak('20_uistyle-i.txt')
  }
  if (user.uistyle.uninstmain) {
    addTweak('20_mainmenu-u.txt')
  } else if (user.mainOps.includes(8)) {
    addTweak('20_mainmenu-i.txt')
    addTweakDir('MainMenuTweaks', true)
  }
  if (user.options.includes(16)) {
    addTweak('16_blnkframe-i.txt')
  }
  if (user.options.includes(12)) {
    addTweak('12_diag-i.txt')
    addTweakDir('test_mode', true)
  }
  if (user.mainOps.includes(10) || user.mainOps.includes(110)) {
    stageImage('offscreen', 'config/OffScreenBackground.png', user.mainOps.includes(110))
    addTweak(`00_offbackground-${user.mainOps.includes(10) ? 'i' : 'u'}.txt`)
  }
  if (user.mainOps.includes(2)) {
    stageImage('background', 'config/background.png')
    if (user.mainOps.includes(6)) addTweak('00_bgrotator-i.txt')
    addTweak('00_background.txt')
  }
  if (user.mainOps.includes(5)) {
    addTweak('00_sd-cid.txt')
    addTweakDir('get_sd_cid', true)
  }
  /* if (user.multictrlbtns) {
    addTweak('00_multicontroller-i.txt')
    addTweakDir('multicontroller', true)
  } */
  if (user.options.includes(19) || user.options.includes(17) || user.options.includes(25) || user.options.includes(27) || user.options.includes(28) || user.options.includes(119) || user.options.includes(117) || user.options.includes(125) || user.options.includes(127) || user.options.includes(128)) {
    addTweakDir('bin', true)
    if (user.options.includes(19) || user.options.includes(17) || user.options.includes(25) || user.options.includes(27) || user.options.includes(28)) {
      addTweakDir('jci', true)
      if (!user.options.includes(2) && !user.options.includes(9)) {
        addTweak('00_59patch.txt')
      }
    }
  }
  if (user.options.some((x) => { return x > 100 })) {
    addTweakDir('v70', false)
  }
  // Swapfile tweak has to be last
  if (user.options.includes(18)) {
    copySwapfile = true
    if (user.swapOps.mount) {
      swapdest = '/config/swapfile/'
      addTweak('18_swapfile-i.txt')
    }
  }
  // Self Destruct mode so you dont need to remove the USB drive
  if (user.destruct || copySwapfile) {
    addTweak('99_self-destruct.txt')
  }
  addRootFiles(user.dataDump)
  addTweak(user.options.includes(11) ? '00_factory-reset-end.txt' : '00_end.txt')
}
function writeSpeedoConfigFile (user) {
  mkdirp.sync(`${tmpdir}/config/speedometer/jci/gui/apps/_speedometer/js/`)
  var JSobj = `var spdBottomRows = ${user.spdExtra.barSpeedoRows}; //Number of Bottom Rows\n`
  JSobj += 'var spdTbl = {\n'
  for (var val in user.spdValues) {
    if (`${user.spdValues[val].pos}` !== null) {
      JSobj += `\t${user.spdValues[val].elmnt}: [${user.spdValues[val].pos}], //${user.spdValues[val].label}\n`
    }
  }
  JSobj += '}\n'
  JSobj += 'var classicSpeedoTmplt = '
  JSobj += JSON.stringify(user.classicSpeed, null, '\t') + '\n'
  fs.writeFileSync(`${varDir}/spdConf.txt`, JSobj)
  var speedoConfig = []
  speedoConfig.push(`${builddir}/config/speedometer_config/config-start.js`)
  speedoConfig.push(`${varDir}/spdConf.txt`)
  speedoConfig.push(`${builddir}/config/speedometer_config/config-end.js`)
  fs.writeFileSync(`${tmpdir}/config/speedometer/speedometer-config.js`, concatenate(speedoConfig))
  fs.writeFileSync(`${tmpdir}/config/speedometer/speedometer-controls.js`, `var spdBtn = ${JSON.stringify(user.multictrl, null, '\t')}`)
  for (var bt in user.barThemeColors) {
    var num = user.barThemeColors[bt].num
    barColorFile += `/* Theme #${num} */\n`
    barColorFile += `#speedBarContainer.theme${num} #vehdataMainDiv fieldset div, #speedBarContainer.theme${num} #vehdataMainDiv [class*="vehDataMain"].pos0 div {\n`
    barColorFile += `\tcolor: ${user.barThemeColors[bt].main};\n}\n`
    barColorFile += `#speedBarContainer.theme${num} #vehdataMainDiv [class*="vehDataMain"].pos0 legend .spunit span, #speedBarContainer.theme${num} #vehdataMainDiv fieldset {\n`
    barColorFile += `\tcolor: ${user.barThemeColors[bt].secondary};\n`
    barColorFile += `\tborder-color: ${user.barThemeColors[bt].border};\n}\n`
  }
  fs.writeFileSync(`${tmpdir}/config/speedometer/barThemes.css`, barColorFile)
}

function tweakVariables (user) {
  mkdirp.sync(`${varDir}`)
  var bak = `KEEPBKUPS=` + (user.backups.org ? `1\n` : `0\n`)
  bak += `TESTBKUPS=` + (user.backups.test ? `1\n` : `0\n`)
  bak += `SKIPCONFIRM=` + (user.backups.skipconfirm ? `1\n` : `0\n`)
  bak += `APPS2RESOURCES=` + (user.backups.apps2resources ? `1\n` : `0\n`)
  bak += (user.mainOps.includes(1) ? `ZIPBACKUP=` + (user.zipbackup ? `1\n` : `0\n`) : '')
  bak += (user.mainOps.includes(4) || user.options.includes(21) ? `FORCESSH=` + (user.forcessh ? `1\n` : `0\n`) : '')
  fs.writeFileSync(`${varDir}/backups.txt`, bak)
  tweaks2write.push(`${varDir}/backups.txt`)
  if (user.restore.full) {
    bak = `DEL_BAKUPS=`
    bak += (user.restore.delBackups) ? `1\n` : `0\n`
    fs.writeFileSync(`${varDir}/restore.txt`, bak)
    tweaks2write.push(`${varDir}/restore.txt`)
  }
  if (user.mainOps.includes(6)) {
    tweaks2write.push(`${varDir}/bg-rotator.txt`)
  }
  if (user.mainOps.includes(3)) {
    switch (user.colors) {
      case 0: themeColor = 'Red'; break
      case 1: themeColor = 'Blue'; break
      case 2: themeColor = 'Green'; break
      case 3: themeColor = 'Silver'; break
      case 4: themeColor = 'Pink'; break
      case 5: themeColor = 'Purple'; break
      case 6: themeColor = 'Orange'; break
      case 7: themeColor = 'Yellow'; break
      case 8: themeColor = 'SmoothRed'; break
      case 9: themeColor = 'SmoothAzure'; break
      case 10: themeColor = 'SmoothViolet'; break
      case 11: themeColor = 'carOS'; break
      case 12: themeColor = 'StormTroopers'; break
      case 13: themeColor = 'Poker'; break
      case 14: themeColor = 'Mazda'; break
      case 15: themeColor = 'Floating'; break
      case 16: themeColor = 'X-Men'; break
      case 17: themeColor = 'Custom'; break
      default: themeColor = 'Red'
    }
  }
  if (user.options.includes(13)) {
    var bootAnimations = `BOOTLOGO1=${user.boot.logo1}\n`
    bootAnimations += `BOOTLOGO2=${user.boot.logo2}\n`
    bootAnimations += `BOOTLOGO3=${user.boot.logo3}\n`
    fs.writeFileSync(`${varDir}/bootlogo.txt`, bootAnimations)
    tweaks2write.push(`${varDir}/bootlogo.txt`)
  }
  if (user.mainOps.includes(3)) {
    fs.writeFileSync(`${varDir}/color.txt`, `COLORTHEME=${themeColor}\n`)
    tweaks2write.push(`${varDir}/color.txt`)
  }
  if (user.options.includes(1)) {
    var tchscrn = `KEEP_SPEED_RESTRICT=`
    tchscrn += (user.keepSpeedRestrict) ? `1\n` : `0\n`
    tchscrn += `ENABLE_DVD=`
    tchscrn += (user.enableDVD) ? `1\n` : `0\n`
    fs.writeFileSync(`${varDir}/touchscreen.txt`, tchscrn)
    tweaks2write.push(`${varDir}/touchscreen.txt`)
  }
  if (user.mainOps.includes(8)) {
    var mmenu = `UI_STYLE_ELLIPSE=`
    mmenu += (user.uistyle.ellipse) ? `1\n` : `0\n`
    mmenu += `UI_STYLE_MINICOINS=`
    mmenu += (user.uistyle.minicoins) ? `1\n` : `0\n`
    mmenu += `UI_STYLE_MINIFOCUS=`
    mmenu += (user.uistyle.minifocus) ? `1\n` : `0\n`
    mmenu += `UI_STYLE_NOGLOW=`
    mmenu += (user.uistyle.hideglow) ? `1\n` : `0\n`
    mmenu += `UI_STYLE_ALTLAYOUT=${user.uistyle.layout}\n`
    mmenu += `UI_STYLE_MAIN3D=${user.uistyle.mainlabel}\n`
    mmenu += `UI_STYLE_LABELCOLOR=${user.uistyle.labelcolor}\n`
    fs.writeFileSync(`${varDir}/mainmenu.txt`, mmenu)
    tweaks2write.push(`${varDir}/mainmenu.txt`)
  }
  if (user.mainOps.includes(9)) {
    var ui = `UI_STYLE_BODY=${user.uistyle.body}\n`
    ui += `UI_STYLE_LIST=${user.uistyle.listitem}\n`
    ui += `UI_STYLE_DISABLED=${user.uistyle.listitemdisabled}\n`
    ui += `UI_STYLE_TITLE=${user.uistyle.title}\n`
    ui += `UI_STYLE_RADIO=${user.uistyle.radio}\n`
    ui += `UI_STYLE_SHADOW=`
    ui += (user.uistyle.shadow) ? `"text-shadow: 2px 2px .5px #000;"\n` : `\n`
    fs.writeFileSync(`${varDir}/uistyle.txt`, ui)
    tweaks2write.push(`${varDir}/uistyle.txt`)
  }
  if (user.options.includes(14)) {
    var noalbmart = `NOALBM=`
    noalbmart += (user.uistyle.noalbm) ? `1\n` : `0\n`
    noalbmart += `FULLTITLES=`
    noalbmart += (user.uistyle.fulltitles) ? `1\n` : `0\n`
    fs.writeFileSync(`${varDir}/bgralbmart.txt`, noalbmart)
    tweaks2write.push(`${varDir}/bgralbmart.txt`)
  }
  if (user.options.includes(15)) {
    var transbg = `NO_BTN_BG=`
    transbg += (user.uistyle.nobtnbg) ? `1\n` : `0\n`
    transbg += `NO_NP_BG=`
    transbg += (user.uistyle.nonpbg) ? `1\n` : `0\n`
    transbg += `NO_LIST_BG=`
    transbg += (user.uistyle.nolistbg) ? `1\n` : `0\n`
    transbg += `NO_CALL_BG=`
    transbg += (user.uistyle.nocallbg) ? `1\n` : `0\n`
    transbg += `NO_TEXT_BG=`
    transbg += (user.uistyle.notextbg) ? `1\n` : `0\n`
    fs.writeFileSync(`${varDir}/removebgs.txt`, transbg)
    tweaks2write.push(`${varDir}/removebgs.txt`)
  }
  if (user.options.includes(20)) {
    var dateFormat = user.d2sbOps - 1
    var sc = `DATE_FORMAT=${dateFormat}\n`
    sc += `STATUS_BAR_APP=${user.statusbar.app}\n`
    sc += `STATUS_BAR_CLOCK=${user.statusbar.clock}\n`
    sc += `STATUS_BAR_NOTIF=${user.statusbar.notif}\n`
    sc += `STATUS_BAR_OPACITY=${user.statusbar.opacity}\n`
    sc += (user.statusbar.main) ? `STATUS_BAR_CTRL="background-image: none;"\nSBN_CTRL="background-image: none;"\n` : `STATUS_BAR_CTRL="background-image: url('../images/StatusBarBg.png');"\nSBN_CTRL=\n`
    fs.writeFileSync(`${varDir}/statusbar-color.txt`, sc)
    tweaks2write.push(`${varDir}/statusbar-color.txt`)
  }
  if (user.options.includes(22)) {
    fs.writeFileSync(`${varDir}/fuel-consumption.txt`, `FUEL_CONS_UNIT=${user.fuelOps}\n`)
    tweaks2write.push(`${varDir}/fuel-consumption.txt`)
  }
  if (user.options.includes(17)) {
    var vpops = `VP_SHUFFLE=${user.vpOps.shuffle}\n`
    vpops += `VP_REPEAT=${user.vpOps.repeat}\n`
    vpops += `VP_FULLSCRN=${user.vpOps.fullscreen}\n`
    vpops += `VP_V4LSINK=${user.vpOps.v4lsink}\n`
    fs.writeFileSync(`${varDir}/vpops.txt`, vpops)
    tweaks2write.push(`${varDir}/vpops.txt`)
  }
  if (user.options.includes(19)) {
    var sops = `OPACITY=`
    sops += (user.speedoOps.bg.id === 30) ? `${user.speedoOps.opac}\n` : `0\n`
    sops += `SPEEDCOLOR=`
    sops += (user.speedoOps.color !== null) ? `${user.speedoOps.color}\n` : `0\n`
    sops += `SPD_BAR_RPM=`
    sops += (user.spdExtra.engineSpeedBar) ? `1\n` : `0\n`
    sops += `SPD_BAR_HIDE=`
    sops += (user.spdExtra.hideSpeedBar) ? `1\n` : `0\n`
    sops += `SPD_COUNTER=`
    sops += (user.spdExtra.speedAnimation) ? `1\n` : `0\n`
    sops += `HIDE_SPEEDO_SBN=`
    sops += (user.spdExtra.hidespeedosbn) ? `1\n` : `0\n`
    sops += `SPD_XTRA_FUEL_SUFF=${user.spdExtra.fuelGaugeValueSuffix}\n`
    sops += `SPD_XTRA_FUEL_FACT=${user.spdExtra.fuelGaugeFactor}\n`
    sops += (user.speedoOps.sbmain !== undefined) ? `SBMAIN=${user.speedoOps.sbmain}\n` : `\n`
    sops += (user.speedoOps.sbval1 !== undefined) ? `SBVAL1=${user.speedoOps.sbval1}\n` : `\n`
    sops += (user.speedoOps.sbval2 !== undefined) ? `SBVAL2=${user.speedoOps.sbval2}\n` : `\n`
    sops += (user.speedoOps.sbfuel !== undefined) ? `SBFBPOS=${user.speedoOps.sbfuel}\n` : `\n`
    sops += `SBUNIT=speedUnit\n`
    sops += `BTSTART=${user.spdExtra.barThemeStart}\n`
    sops += `SBINT=${user.speedoOps.sbint * 1000}\n`
    for (var fb in user.fuelBarColors) {
      sops += `${user.fuelBarColors[fb].bashVar}="${user.fuelBarColors[fb].colorVal}"\n`
      // console.log(`${user.fuelBarColors[fb].bashVar}="${user.fuelBarColors[fb].colorVal}"`);
    }
    fs.writeFileSync(`${varDir}/bgopacity.txt`, sops)
    tweaks2write.push(`${varDir}/bgopacity.txt`)
  }
  if (user.options.includes(26)) {
    fs.writeFileSync(`${varDir}/gracenote.txt`, `GRACENOTE="${quoteDouble(user.gracenoteText)}"`)
    tweaks2write.push(`${varDir}/gracenote.txt`)
  }
}


}
