/* Browser-only named native workflows. No Node or generic IPC transport. */
function nativeAction (promise) {
  return Promise.resolve(promise).catch(error => { bootbox.alert({ message: error.message }); return null })
}
function disabledFeature () { bootbox.alert('Legacy network/download features are disabled. No replacement service has been configured.') }
const uiEvents = window.uiEvents = (() => {
  const listeners = new Map()
  return {
    on (name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); return () => listeners.set(name, list.filter(x => x !== callback)) },
    emit (name, ...args) { for (const callback of listeners.get(name) || []) callback(...args) }
  }
})()
aio.onMenuAction(action => {
  if (['save-options', 'load-options', 'load-last', 'start-compile', 'go-home'].includes(action)) uiEvents.emit(action)
})
aio.onProgress(message => snackbar(message))
aio.onImageStaged(result => nativeAction(applyImageResult(result)))
async function applyImageResult (result) {
  if (!result) return null
  if (result.kind === 'background') {
    getBackground = result.destination
    const src = result.destination + '?' + Date.now()
    $('#imgframe, #imgmodal').empty().append($('<img>').attr('src', src))
    $('#selected-file').text('Selected background: ' + result.destination)
  } else if (result.kind === 'album') {
    await settings.set('blank-album-art', result.destination)
    $('.blnk-albm-art').hide(); $('#blnk-albm-img').show().empty().append($('<img>').attr('src', result.destination + '?' + Date.now()))
  }
  await settings.set('stagedImages.' + result.kind, result.destination)
  return result
}
async function selectImage (kind) {
  return nativeAction((async () => {
    const source = await aio.chooseImage(kind)
    if (source === null) return null
    return applyImageResult(await aio.resizeImage({ kind, source }))
  })())
}
function selectBuiltinImage (name) { return nativeAction(aio.selectBuiltinImage(name).then(applyImageResult)) }
function selectJoinedImage () { return nativeAction(aio.chooseJoinedImage().then(applyImageResult)) }
function selectTheme () { return nativeAction(aio.chooseTheme().then(theme => { if (theme !== null) uiEvents.emit('custom-theme', theme) })) }
function chooseOutput () { return nativeAction(aio.chooseOutputDirectory()) }
function openApprovedExternal (url) { return nativeAction(aio.openExternal(url)) }
// app/opts is an immutable bundled payload. Normalize its finite legacy controls
// in the DOM, not via a renderer IPC compatibility bridge or payload byte edits.
function migratePayloadControls () {
  const replacements = {
    'open-file-bg': "selectImage('background')", 'open-file-default': "selectBuiltinImage('background')",
    'open-offscreen-bg': "selectImage('offscreen')", 'open-offscreen-default': "selectBuiltinImage('offscreen')",
    'default-blnk-art': "selectBuiltinImage('album')", 'transparent-blnk-art': "selectBuiltinImage('transparent')",
    'open-file-blnk-art': "selectImage('album')", 'bg-no-resize': 'selectJoinedImage()', 'theme-jci': 'selectTheme()',
    'open-joiner-window': "nativeAction(aio.openScreen('joiner'))"
  }
  for (const element of document.querySelectorAll('[onclick]')) {
    const old = element.getAttribute('onclick')
    // Retained message controls delegate hiding/error state to awaited handlers.
    if (element.getAttribute('ng-click') === 'savePresetMsgs()') { element.removeAttribute('onclick'); continue }
    if (old === "resetMsgLang();$('#presetMessageEditor').fadeOut()") { element.setAttribute('onclick', 'resetMsgLang()'); continue }
    const next = old.replace(/ipc\.send\('([^']+)'\)/g, (call, name) => replacements[name] || 'disabledFeature()')
    if (next !== old) element.setAttribute('onclick', next)
  }
}
new MutationObserver(migratePayloadControls).observe(document.documentElement, { childList: true, subtree: true })
migratePayloadControls()
