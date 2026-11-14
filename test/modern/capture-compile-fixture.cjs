'use strict'
// Capture actual controller declarations, not invented selections. Scratch-only utility.
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const home = fs.readFileSync(path.join(root, 'app/controllers/home.js'), 'utf8')
const speedo = fs.readFileSync(path.join(root, 'app/assets/js/spdValues.js'), 'utf8').split('// Push Disable')[0]
const audio = fs.readFileSync(path.join(root, 'app/assets/js/audioSourceList.js'), 'utf8').split('function buildEntList')[0]
const context = { $scope: {}, lang: 'english', settings: { get: (_, fallback) => fallback }, persistantData: { get: (_, fallback) => fallback }, speedoSave: { get: (_, fallback) => fallback }, desktopData: { paths: { desktop: '/fixture/output' } } }
vm.createContext(context)
vm.runInContext(speedo + '\n' + audio + '\n' + home.slice(home.indexOf('      $scope.user = {'), home.indexOf('      const userDefaults =')), context)
const locale = JSON.parse(fs.readFileSync(path.join(root, 'app/lang/english.aio.json')))
const menuLoop = locale.tweakOps.find(x => /main.*menu.*loop/i.test(JSON.stringify(x)))
if (!menuLoop) throw Error('Main menu loop declaration missing')
context.$scope.user.options = [menuLoop.id]
fs.mkdirSync(path.join(root, 'test/fixtures'), { recursive: true })
fs.writeFileSync(path.join(root, 'test/fixtures/compile-options.json'), JSON.stringify(context.$scope.user, null, 2) + '\n')
console.log('Captured main menu loop', menuLoop)
