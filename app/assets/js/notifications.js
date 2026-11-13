/* jshint esversion:6, -W117 */
function showNotification (title, message, fadeouttime, callback) {
  $('#notices').show()
  var notice = document.createElement('div')
  notice.setAttribute('class', 'notice')
  notice.innerHTML = `<span class="w3-closebtn w3-display-topright" onclick="$(this).parent().hide((${fadeouttime}+1)*1000)">&times;</span><div class="w3-hover-text-indigo">${message}</div>`
  document.getElementById('notices').appendChild(notice)
  if (fadeouttime !== 0) {
    setTimeout(function () {
      $('#notices *').fadeOut(fadeouttime * 1000)
    }, 3000)
  }
  // document.body.appendChild(notice)
  var nohtml = message ? String(message).replace(/<[^>]+>/gm, '') : ''
  snackbar(`<img src='icon.ico' onerror='$(this).hide()'> ${nohtml}`)
}

function snackbar (message, mtime) {
  /* $('#snackbar').append('body')
  var x = document.getElementById('snackbar')
  x.innerHTML = message
  x.className = 'show w3-card-12'
  setTimeout(function () { x.className = x.className.replace('show', '') }, 1500) */
  $.gritter.add({
    title: 'MZD-AIO',
    text: message,
    time: mtime * 1000 || 5000
  })
}

function snackbarstay (message) {
  // $('#snackbar').append('body')
  // var x = document.getElementById('snackbar')
  // x.innerHTML = message + '<div onclick="$(this).parent().removeClass(\'stay\')" class="w3-xxlarge w3-display-topright w3-close-btn w3-hover-text-red" style="margin-top:-15px;cursor:pointer;">&times;</div>'
  // x.className = 'stay w3-card-12'
  $.gritter.add({
    title: 'MZD-AIO',
    text: message,
    sticky: true
  })
}
