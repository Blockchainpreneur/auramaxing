#!/bin/bash
# AURAMXING — Fix Claude Desktop after updates
# Usage: bash ~/auramxing/scripts/fix-claude.sh

set -e
APP="/Applications/Claude.app"
ASAR="$APP/Contents/Resources/app.asar"
WORK="/tmp/auramxing-fix"
MAIN_JS=".vite/build/mainView.js"

echo "▸ Cerrando Claude..."
killall Claude 2>/dev/null; sleep 1

echo "▸ Extrayendo app.asar..."
rm -rf "$WORK"
npx --yes @electron/asar extract "$ASAR" "$WORK"

# Solo inyectar si no está ya
if ! grep -q "auramxingInjectStyles" "$WORK/$MAIN_JS" 2>/dev/null; then
  echo "▸ Inyectando tema AURAMXING..."
  cat >> "$WORK/$MAIN_JS" << 'JSEOF'

// AURAMXING Black + Pastel — preload injection
;(function auramxingInjectStyles() {
  var CSS = [
    ':root,[data-color-scheme],[data-theme],.dark,html{',
    '--bg-000:#000!important;--bg-100:#050505!important;--bg-200:#080808!important;',
    '--bg-300:#0d0d0d!important;--bg-400:#111!important;--bg-500:#161616!important;',
    '--text-000:#F0E6FF!important;--text-100:#DDD0F5!important;--text-200:#C8B8F0!important;',
    '--text-300:#A89BC8!important;--text-400:#7B6EA0!important;',
    '--border-000:#1a1a1a!important;--border-100:#222!important;',
    '--border-200:#2a2a2a!important;--border-300:#333!important;',
    '--brand-000:#98E8C1!important;--brand-100:#7DD4A8!important;--brand-200:#62C090!important;',
    '--oncolor-000:#000!important;--oncolor-100:#0a0a0a!important;',
    '}',
    'html,body,#root,#app,#__next,main{background:#000!important;color:#F0E6FF!important;}',
    'nav,header,aside,[role=navigation],[class*=sidebar],[class*=Sidebar]{background:#000!important;border-color:#1a1a1a!important;}',
    '[class*=conversation],[class*=thread],[class*=message],[class*=turn],[role=main]{background:#000!important;}',
    'textarea,[contenteditable],[class*=ProseMirror],[class*=composer]{background:#080808!important;color:#F0E6FF!important;border-color:#2a2a2a!important;caret-color:#98E8C1!important;}',
    'pre,code,[class*=code],[class*=Code]{background:#050505!important;color:#FFD4A3!important;border-color:#1a1a1a!important;}',
    '[class*=card],[class*=Card],[class*=modal],[class*=Modal],[class*=dropdown],[class*=menu],[class*=Menu],[role=dialog],[role=menu]{background:#080808!important;border-color:#2a2a2a!important;}',
    'h1,h2,h3,h4,h5,h6{color:#FFF0C0!important;}',
    'a{color:#A8D8F0!important;}',
    'pre,code,[class*=code]{background:#050505!important;color:#FFD4A3!important;}',
    '::-webkit-scrollbar{width:4px!important;background:#000!important;}',
    '::-webkit-scrollbar-thumb{background:#222!important;border-radius:4px!important;}',
    '::selection{background:#2a1a4a!important;color:#F0E6FF!important;}',
  ].join('');
  function inject() {
    if (document.getElementById('auramxing-css')) return;
    var s = document.createElement('style');
    s.id = 'auramxing-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', inject); } else { inject(); }
  var _push = history.pushState;
  history.pushState = function() { _push.apply(this, arguments); setTimeout(inject, 100); };
  window.addEventListener('popstate', function() { setTimeout(inject, 100); });
})();
JSEOF
else
  echo "✓ Tema ya presente, no se re-inyecta"
fi

echo "▸ Repacando app.asar..."
npx @electron/asar pack "$WORK" "$ASAR"
rm -rf "$WORK"

echo "▸ Re-firmando..."
chmod -R u+w "$APP"
codesign --force --deep --sign - "$APP"
xattr -cr "$APP"

echo "▸ Whitelisting en Gatekeeper (requiere sudo)..."
sudo spctl --add "$APP"
sudo spctl --enable --label "Claude"

echo ""
echo "✓ Listo — abriendo Claude..."
open "$APP"
