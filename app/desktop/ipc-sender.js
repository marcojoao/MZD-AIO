'use strict'
const { fileURLToPath } = require('node:url')
const path = require('node:path')

// Each registration owns one webContents and one exact local main-frame page.
// Secondary pages require a separate registration with explicitly scoped handlers.
function createSenderGuard ({ getWebContents, indexPath }) {
  return event => {
    try {
      const contents = getWebContents()
      if (!contents || !event || event.sender !== contents || !event.senderFrame ||
          event.senderFrame !== contents.mainFrame) throw new Error('Unowned frame')
      const url = new URL(event.senderFrame.url)
      if (url.protocol !== 'file:' || url.host ||
          path.resolve(fileURLToPath(url)) !== path.resolve(indexPath)) throw new Error('Untrusted page')
      return url
    } catch (cause) {
      throw new Error('Invalid sender/frame or sender/frame URL', { cause })
    }
  }
}
module.exports = { createSenderGuard }
