/* Named message XML operations; parsing and persistence remain main-owned. */
var data2edit, msgLangs = [], currLangMsgs = [], currMsgLang
async function getMsgLangs () {
  data2edit = await aio.loadMessages()
  msgLangs.splice(0, msgLangs.length, ...data2edit.Node.Node[0].Node.map(node => node.$.key))
}
async function persistMessageChange (operation) {
  try {
    await operation()
    $('#presetMessageEditor').fadeOut()
    return true
  } catch (error) {
    bootbox.alert({ message: 'Could not save message changes: ' + error.message })
    return false
  }
}
function resetMsgLang () {
  return persistMessageChange(async () => {
    data2edit = await aio.resetMessages()
    msgLangs.splice(0, msgLangs.length, ...data2edit.Node.Node[0].Node.map(node => node.$.key))
  })
}
function getMsgsForLang (language) {
  const node = data2edit && data2edit.Node.Node[0].Node.find(node => node.$.key === language)
  currLangMsgs = node ? node.Node.map(node => node.$.value) : []
}
async function rebuildMessageXml (language, messages) {
  await aio.saveMessages(language, messages)
  await getMsgLangs()
}
var messagesReady = getMsgLangs()
messagesReady.catch(error => bootbox.alert(error.message))
