'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { read, parents } = require('./compiler-fs')
const names = Object.freeze({ background: 'background.png', offscreen: 'OffScreenBackground.png', album: 'no_artwork_icon.png' })
const builtin = Object.freeze({ background: 'default/default.png', offscreen: 'default/OffScreenBackground.png', album: 'blank-album-art/no_artwork_icon.png' })
// Node-only callers can inject a decoder. Production always injects nativeImage.
function pngSize (bytes) {
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw Error('Invalid PNG image')
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 64000000) throw Error('Invalid PNG image dimensions')
  const chunks = []
  let ended = false
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8)
    if (length > bytes.length - offset - 12) throw Error('Truncated PNG image')
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    if (type === 'IEND') { ended = true; break }
    offset += length + 12
  }
  if (!ended || !chunks.length) throw Error('Incomplete PNG image')
  // Bounded structural check for Node-only callers, not a native rendering claim.
  require('node:zlib').inflateSync(Buffer.concat(chunks), { maxOutputLength: 256 * 1024 * 1024 })
  return { width, height }
}
function createImageResolver ({ resources, userData, imageParent, decode = pngSize }) {
  function resolve (kind, useDefault = false) {
    if (!Object.hasOwn(names, kind)) throw Error('Invalid image kind')
    const candidates = useDefault ? [] : [imageParent && path.join(imageParent, '_copy_to_usb', names[kind]), userData && path.join(userData, 'background', names[kind])].filter(Boolean)
    candidates.push(path.join(resources, '../background-images', builtin[kind]))
    for (const destination of candidates) {
      // Only absence allows fallback. Unsafe ancestors/leaves, unreadable or
      // undecodable selected sources must reject, never silently use defaults.
      try {
        parents(path.dirname(destination))
        const stat = fs.lstatSync(destination)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw Error('Unsafe image source')
      } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      const bytes = read(destination)
      let dimensions
      try { dimensions = decode(bytes); if (!dimensions?.width || !dimensions?.height) throw Error('Empty image') } catch (error) { throw Error('Could not decode ' + kind + ' image: ' + destination + ': ' + error.message) }
      return { kind, destination, bytes, ...dimensions, preview: 'data:image/png;base64,' + bytes.toString('base64') }
    }
    throw Error('Required ' + kind + ' image is missing')
  }
  function previews () {
    return Object.fromEntries(Object.keys(names).map(kind => {
      try { const { bytes, ...state } = resolve(kind); return [kind, state] } catch (error) { return [kind, { kind, error: error.message }] }
    }))
  }
  return { resolve, previews }
}
module.exports = { createImageResolver, names }
