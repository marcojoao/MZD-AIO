/* Named message XML operations; parsing and persistence remain main-owned. */
var data2edit, msgLangs = [], currLangMsgs = [], currMsgLang
async function getMsgLangs () {
  data2edit = await aio.loadMessages()
  msgLangs = data2edit.Node.Node[0].Node.map(node => node.$.key)
}
async function resetMsgLang () { data2edit = await aio.resetMessages(); msgLangs = data2edit.Node.Node[0].Node.map(node => node.$.key) }
function getMsgsForLang (language) {
  const node = data2edit && data2edit.Node.Node[0].Node.find(node => node.$.key === language)
  currLangMsgs = node ? node.Node.map(node => node.$.value) : []
}
async function rebuildMessageXml (language, messages) {
  await aio.saveMessages(language, messages)
  await getMsgLangs()
}
getMsgLangs().catch(error => bootbox.alert(error.message))
