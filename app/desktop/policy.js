'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function isAbsolutePath (value) {
  return typeof value === 'string' && value.length > 0 &&
    !value.includes('\0') && path.isAbsolute(value) &&
    !value.split(path.sep).includes('..')
}

function isWithin (candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
}

// Options are trusted main-process configuration, never renderer-supplied paths.
// This is a read-only decision, not a reservation: writers must recheck at use time.
function resolveOutputDirectory (parent, options = {}) {
  try {
    if (!isAbsolutePath(parent)) throw new Error('Invalid parent')
    const canonicalParent = fs.realpathSync(parent)
    if (!fs.statSync(canonicalParent).isDirectory()) throw new Error('Parent is not a directory')
    const home = fs.realpathSync(options.home === undefined ? os.homedir() : options.home)
    const roots = [path.resolve(__dirname, '..')]
    if (process.resourcesPath) roots.push(process.resourcesPath)
    if (options.resourceRoots !== undefined) {
      if (!Array.isArray(options.resourceRoots)) throw new Error('Invalid resource roots')
      roots.push(...options.resourceRoots)
    }
    const output = path.join(canonicalParent, '_copy_to_usb')
    if (canonicalParent === path.parse(canonicalParent).root || canonicalParent === home ||
        roots.some(root => {
          const canonicalRoot = fs.realpathSync(root)
          return isWithin(canonicalParent, canonicalRoot) || isWithin(output, canonicalRoot)
        })) throw new Error('Protected parent')
    let target
    try {
      target = fs.lstatSync(output)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (target && (target.isSymbolicLink() || !target.isDirectory())) throw new Error('Unsafe target')
    return output
  } catch (cause) {
    throw new Error('Output directory is not allowed', { cause })
  }
}

// drivelist exposes isSystem, not a shorthand system field. Unknown status fails closed.
// No enumeration, native imports, or filesystem access is needed for this predicate.
function isEligibleDrive (drive) {
  return !!(drive && typeof drive === 'object' && drive.isSystem === false &&
    drive.isRemovable === true && Array.isArray(drive.mountpoints) &&
    drive.mountpoints.length > 0 && Array.from(drive.mountpoints).every(mountpoint =>
      mountpoint && isAbsolutePath(mountpoint.path) &&
      path.resolve(mountpoint.path) !== path.parse(mountpoint.path).root))
}

function validateExternalUrl (value) {
  try {
    if (typeof value !== 'string') throw new Error('Expected a string')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        url.hostname !== 'github.com') throw new Error('Unreviewed URL')
    return url.href
  } catch (cause) {
    throw new Error('External URL is not allowed', { cause })
  }
}

module.exports = { resolveOutputDirectory, isEligibleDrive, validateExternalUrl }
