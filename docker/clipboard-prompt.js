// KasmVNC's web client only queries the clipboard permission state - it never
// calls a clipboard API in a way that makes Chrome/Edge show the permission
// prompt, so seamless clipboard silently stays off until the user digs into
// per-site browser settings. Nudge the prompt on the first user gesture:
// readText() from a gesture handler triggers the browser's native permission
// dialog, and once granted KasmVNC's own clipboard sync takes over.
// Capture phase: noVNC stops propagation on canvas events, so bubble-phase
// listeners on document never fire.
// Firefox doesn't support seamless clipboard at all - readText() rejects and
// this stays a harmless no-op there.
(function () {
  if (!navigator.clipboard || !navigator.clipboard.readText) return
  var asked = false
  function ask() {
    if (asked) return
    asked = true
    document.removeEventListener('pointerdown', ask, true)
    document.removeEventListener('mousedown', ask, true)
    document.removeEventListener('keydown', ask, true)
    navigator.clipboard.readText().catch(function () {})
  }
  function arm() {
    document.addEventListener('pointerdown', ask, true)
    document.addEventListener('mousedown', ask, true)
    document.addEventListener('keydown', ask, true)
  }
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'clipboard-read' })
      .then(function (s) { if (s.state === 'prompt') arm() })
      .catch(arm)
  } else {
    arm()
  }
})()
