'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { resolveOutputDirectory } = require('./policy')
const { read, inventory, stageWriter, parents } = require('./compiler-fs')
const selections = require('./compiler-selections')
const { workflows } = require('./compiler-workflows')
const { validateOptions } = require('./compiler-options')
const { manifest, verifyOwned, sentinel } = require('./compiler-manifest')

function createCompiler ({ resources = path.resolve(__dirname, '..'), userData, imageParent, policyOptions, beforeCopy, getState = async () => ({}) } = {}) {
  const protectedRoots = [resources, ...['background', 'background-images', 'castscreenApp'].map(name => path.resolve(resources, '..', name)), imageParent, userData].filter(name => name && fs.existsSync(name))
  const outputPolicy = { ...policyOptions, resourceRoots: [...protectedRoots, ...(policyOptions?.resourceRoots || [])] }
  let busy = false
  return { async compile ({ options, outputParent }, onProgress = () => {}) {
    if (busy) throw Error('Compilation already in progress')
    busy = true
    let stage
    try {
      const outputDirectory = resolveOutputDirectory(outputParent, outputPolicy)
      const user = validateOptions(options)
      verifyOwned(outputDirectory)
      const parentIdentity = fs.lstatSync(path.dirname(outputDirectory))
      const state = await getState(user)
      stage = path.join(path.dirname(outputDirectory), '.aio-stage-' + randomUUID())
      fs.mkdirSync(stage, { mode: 0o700 })
      const io = stageWriter(stage, beforeCopy)
      const builddir = path.join(resources, 'files/tweaks/')
      const varDir = path.join(stage, '.work')
      const log = []
      const progress = message => { log.push(message); onProgress({ stage: 'generate', message }) }
      const concatenate = files => files.map(file => {
        progress('Adding ' + path.basename(file))
        return read(file).toString() + '\n'
      }).join('').replace(/\r\n?/g, '\n')
      function addTweakDir (name, install, callback, ...args) {
        const relative = (install ? 'config/' : 'config_org/') + name
        progress('Copying ' + relative)
        io.copy(path.join(builddir, relative), path.join(stage, relative))
        if (callback) callback(...args)
      }
      function addRootFiles (dataDump) {
        io.copy(path.join(builddir, 'root'), stage)
        if (dataDump) io.copy(path.join(stage, 'data'), stage)
        io.remove(path.join(stage, 'data'))
      }
      const flow = await workflows({ user, state, resources, userData, imageParent, stage, varDir, io, progress, addRootFiles })
      if (user.autorun.installer && !user.restore.full) flow.autorun()
      else {
        const result = selections({ fs: { writeFileSync: io.write }, path, mkdirp: { sync: io.mkdir }, builddir, varDir, tmpdir: stage,
          addTweakDir, addRootFiles, concatenate, barColorHeader: require('./compiler-bar-header.json'),
          ...flow, prepareTheme: () => {},
          buildEntList: () => {
            io.mkdir(path.join(stage, 'config/audio_order_AND_no_More_Disclaimer/both/jci/gui/apps/system/js'))
            const listOrder = user.entertainmentItems.map(item => 'var ' + item.menuItem + ' = ' + item.pos + ';\n').join('')
            io.write(path.join(stage, 'config/audio_order_AND_no_More_Disclaimer/systemApp.js.audio'), listOrder)
          },
          replaceInFile: (name, from, to) => io.write(name, read(name).toString().replaceAll(from, to))
        }, user)
        if (user.options.includes(16) && !user.restore.full && !user.casdk.inst && !user.casdk.uninst) flow.stageImage('album', 'config/blank-album-art-frame/jci/gui/common/images/no_artwork_icon.png')
        io.write(path.join(stage, user.runsh ? 'run.sh' : 'tweaks.sh'), concatenate(result.fragments))
        if (user.runsh) for (const name of ['jci-autoupdate', 'cmu_dataretrieval.up', 'dataRetrieval_config.txt']) io.remove(path.join(stage, name))
        if (result.copySwapfile) await flow.archive(path.join(builddir, 'config/swapfile/swapfile.zip'), result.swapdest ? 'config/swapfile' : '')
      }
      io.remove(varDir)
      if (!user.autorun.serial) io.write(path.join(stage, 'AIO_LOG.md'), '# MZD-AIO compilation\nManual export only; no physical USB copy performed.\n\n' + log.map(message => '- ' + message + '\n').join(''))
      io.write(path.join(stage, sentinel), JSON.stringify(manifest(stage)))
      const files = inventory(stage)
      parents(path.dirname(outputDirectory))
      const now = fs.lstatSync(path.dirname(outputDirectory))
      if (now.dev !== parentIdentity.dev || now.ino !== parentIdentity.ino || resolveOutputDirectory(outputParent, outputPolicy) !== outputDirectory) throw Error('Output parent changed')
      const backup = path.join(path.dirname(outputDirectory), '.aio-previous-' + randomUUID())
      const hadOutput = verifyOwned(outputDirectory)
      if (hadOutput) fs.renameSync(outputDirectory, backup)
      try { fs.renameSync(stage, outputDirectory); stage = null } catch (error) {
        if (hadOutput) fs.renameSync(backup, outputDirectory)
        throw error
      }
      // Successful stage rename is the publication commit point. Observer and
      // old-backup cleanup failures must never misreport that committed package.
      const notifyCommitted = event => {
        try { Promise.resolve(onProgress(event)).catch(() => {}) } catch (_) {}
      }
      if (hadOutput) {
        try { verifyOwned(backup); fs.rmSync(backup, { recursive: true }) } catch (error) {
          notifyCommitted({ stage: 'warning', code: 'BACKUP_CLEANUP_FAILED', recoverable: true, backupDirectory: backup,
            message: 'Package generated; previous backup cleanup failed. Retain the backup for explicit recovery/cleanup.', diagnostic: error.message })
        }
      }
      notifyCommitted({ stage: 'complete', message: 'Package generated; manually copy its contents to USB.' })
      return { outputDirectory, files }
    } finally {
      if (stage) fs.rmSync(stage, { recursive: true, force: true })
      busy = false
    }
  } }
}
const compiler = createCompiler()
module.exports = { createCompiler, compile: (...args) => compiler.compile(...args) }
