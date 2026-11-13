/* Named document printing; native dialog, devices and errors remain main-owned. */
async function printDocument () {
  try { await window.aio.print() } catch (error) { window.alert('Could not print: ' + error.message) }
}
