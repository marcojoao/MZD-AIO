/* Main-owned compiler bridge. No filesystem, drive enumeration or shell access. */
/* global aio, angular */
function buildTweakFile (user, apps) {
  const options = JSON.parse(angular.toJson(user))
  if (apps) options.apps = JSON.parse(angular.toJson(apps))
  return aio.compile({ options, outputParent: user.copydir })
}
