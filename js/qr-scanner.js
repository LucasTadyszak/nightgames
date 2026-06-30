// ══════════════════════════════════════
// qr-scanner.js
// iOS     → input capture="environment" (ouvre l'app Appareil Photo native,
//            qui détecte le QR et affiche une notif pour ouvrir le lien)
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
  // iOS — ouvre l'Appareil Photo natif
  // La caméra détecte le QR et affiche une bannière système.
  // En tapant la bannière, Safari charge ?code=XXXX → _onCode via app.js.
  // ══════════════════════════════════════
  function _openIOSCamera() {
    const input = document.createElement('input');
    input.type    = 'file';
    input.accept  = 'image/*';
    input.capture = 'environment';
    // Pas besoin de decoder : la bannière iOS gère la navigation
    input.click();
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
      _openIOSCamera();
    } else {
      _openVideoScanner();
    }
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick       = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closeModal();
  }

  return { init, open };
})();
