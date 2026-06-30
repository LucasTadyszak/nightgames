// ══════════════════════════════════════
// qr-scanner.js
// iOS     → instructions (le web NE PEUT PAS lancer l'app Appareil Photo
//            native ni détecter un QR : aucune API iOS ne l'autorise.
//            On guide l'utilisateur à ouvrir sa caméra manuellement,
//            qui affiche la bannière système → Safari charge ?code=XXXX)
// Android → modal vidéo + BarcodeDetector
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream = null;
  let _timer  = null;

  // ── Détection iOS ──
  const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // ── Code commun ──────────────────────────────────────────────
  function _extractCode(raw) {
    let code = raw.trim();
    try {
      const u = new URL(raw);
      const c = u.searchParams.get('code');
      if (c) code = c.trim();
    } catch (_) {}
    return code.toUpperCase();
  }

  function _onCode(raw) {
    const code = _extractCode(raw);
    if (code.length !== 4) { showToast('QR invalide, réessaie'); return; }
    const input = document.getElementById('join-code-input');
    if (input) input.value = code;
    _pendingFlow = 'join:' + code;
    document.getElementById('name-screen-title').textContent = `Rejoindre ${code}`;
    document.getElementById('btn-confirm-name').textContent  = 'REJOINDRE ›';
    showScreen('name');
  }

  // ══════════════════════════════════════
  // iOS — affiche les instructions
  // Le web ne peut pas ouvrir l'app Photo : on demande à l'utilisateur
  // de le faire lui-même. Sa caméra détecte le QR et affiche la bannière
  // système. En la tapant, Safari charge ?code=XXXX → _onCode via app.js.
  // ══════════════════════════════════════
  function _openIOSInstructions() {
    const modal = document.getElementById('qr-scanner-modal');
    document.getElementById('qr-viewport').classList.add('hidden');
    document.getElementById('qr-scanner-hint').classList.add('hidden');
    document.getElementById('qr-ios-steps').classList.remove('hidden');
    modal.classList.remove('hidden');
  }

  // ══════════════════════════════════════
  // Android — modal vidéo + BarcodeDetector
  // ══════════════════════════════════════
  function _stop() {
    clearInterval(_timer); _timer = null;
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  function _closeModal() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  async function _openVideoScanner() {
    const modal = document.getElementById('qr-scanner-modal');
    const video = document.getElementById('qr-video');
    const hint  = document.getElementById('qr-scanner-hint');

    modal.classList.remove('hidden');
    hint.textContent = 'Chargement de la caméra…';

    if (!('BarcodeDetector' in window)) {
      hint.textContent = '⚠️ Scanner non supporté sur ce navigateur.';
      return;
    }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      });
    } catch (e) {
      hint.textContent = '⚠️ Accès caméra refusé.';
      return;
    }

    video.srcObject = _stream;
    video.play();

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    hint.textContent = 'Pointe sur le QR code du host';

    _timer = setInterval(async () => {
      if (video.readyState < video.HAVE_ENOUGH_DATA) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          _stop();
          _closeModal();
          _onCode(codes[0].rawValue);
        }
      } catch (_) {}
    }, 150);
  }

  // ── Entrée publique ──────────────────────────────────────────
  function open() {
    if (_isIOS) {
      _openIOSInstructions();
    } else {
      // S'assure que la vue vidéo est visible (au cas où réutilisée)
      document.getElementById('qr-viewport').classList.remove('hidden');
      document.getElementById('qr-scanner-hint').classList.remove('hidden');
      document.getElementById('qr-ios-steps').classList.add('hidden');
      _openVideoScanner();
    }
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick       = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closeModal();

    // iOS : « Saisir le code » ferme le modal et ouvre le champ code
    const iosCode = document.getElementById('btn-ios-use-code');
    if (iosCode) iosCode.onclick = () => {
      _closeModal();
      const collapse = document.getElementById('join-code-collapse');
      if (collapse && !collapse.classList.contains('open')) {
        document.getElementById('btn-toggle-code-input').click();
      } else {
        document.getElementById('join-code-input').focus();
      }
    };
  }

  return { init, open };
})();
