// ══════════════════════════════════════
// qr-scanner.js — scan live via getUserMedia + jsQR
// Marche sur iOS Safari ET Android (BarcodeDetector n'existe pas sur
// iOS Safari, donc on décode les pixels nous-mêmes avec jsQR).
// Si la caméra est refusée/indisponible → repli : instructions + code.
// ══════════════════════════════════════

const QRScanner = (() => {
  let _stream = null;
  let _timer  = null;
  let _canvas = null;
  let _ctx    = null;

  // ── Chargement paresseux de jsQR ──
  function _loadJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) { resolve(); return; }
      const s = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s.onload  = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

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

  // ── Cycle de vie ─────────────────────────────────────────────
  function _stop() {
    clearInterval(_timer); _timer = null;
    if (_stream) { _stream.getTracks().forEach(t => t.stop()); _stream = null; }
  }

  function _closeModal() {
    _stop();
    document.getElementById('qr-scanner-modal').classList.add('hidden');
  }

  // Affiche le repli (instructions + bouton code) quand la caméra échoue
  function _showFallback(msg) {
    _stop();
    document.getElementById('qr-viewport').classList.add('hidden');
    const hint = document.getElementById('qr-scanner-hint');
    if (msg) { hint.textContent = msg; hint.classList.remove('hidden'); }
    else     { hint.classList.add('hidden'); }
    document.getElementById('qr-ios-steps').classList.remove('hidden');
  }

  // ══════════════════════════════════════
  // Scan live (iOS + Android)
  // ══════════════════════════════════════
  async function open() {
    const modal = document.getElementById('qr-scanner-modal');
    const video = document.getElementById('qr-video');
    const hint  = document.getElementById('qr-scanner-hint');

    // Réinitialise l'affichage (vue vidéo visible, repli caché)
    document.getElementById('qr-viewport').classList.remove('hidden');
    document.getElementById('qr-ios-steps').classList.add('hidden');
    hint.classList.remove('hidden');
    hint.textContent = 'Chargement…';
    modal.classList.remove('hidden');

    try { await _loadJsQR(); }
    catch (_) { _showFallback('⚠️ Scanner indisponible. Ouvre ton Appareil Photo :'); return; }

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width:  { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (_) {
      _showFallback('⚠️ Caméra refusée. Ouvre ton Appareil Photo :');
      return;
    }

    video.srcObject = _stream;
    video.setAttribute('playsinline', '');   // requis iOS Safari
    try { await video.play(); } catch (_) {}

    if (!_canvas) {
      _canvas = document.createElement('canvas');
      _ctx    = _canvas.getContext('2d', { willReadFrequently: true });
    }

    // Fast-path natif (Android/Chrome) : décodage GPU, bien plus rapide
    // que jsQR. Absent sur iOS Safari → on retombe sur jsQR.
    let detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const fmts = await BarcodeDetector.getSupportedFormats();
        if (fmts.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
      } catch (_) {}
    }

    hint.textContent = 'Pointe sur le QR code du host';

    const T   = 512;     // côté du carré décodé
    let busy  = false;   // évite d'empiler les décodages

    _timer = setInterval(async () => {
      if (busy) return;
      if (video.readyState < video.HAVE_ENOUGH_DATA || !video.videoWidth) return;
      busy = true;
      try {
        // ── Fast-path natif ──
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length && codes[0].rawValue) {
            _stop(); _closeModal(); _onCode(codes[0].rawValue); return;
          }
          busy = false; return;
        }

        // ── jsQR : recadre le carré central (ce que l'utilisateur vise) et
        // le décode en 512px → QR net, peu de pixels = rapide ET fiable. ──
        const side = Math.min(video.videoWidth, video.videoHeight);
        const sx   = (video.videoWidth  - side) / 2;
        const sy   = (video.videoHeight - side) / 2;
        _canvas.width = _canvas.height = T;
        _ctx.drawImage(video, sx, sy, side, side, 0, 0, T, T);

        const px = _ctx.getImageData(0, 0, T, T);
        const result = jsQR(px.data, T, T, { inversionAttempts: 'onlyInvert' });
        if (result && result.data) {
          _stop(); _closeModal(); _onCode(result.data); return;
        }
      } catch (_) {}
      busy = false;
    }, 80);
  }

  function init() {
    document.getElementById('btn-scan-qr').onclick       = () => open();
    document.getElementById('btn-close-scanner').onclick = () => _closeModal();

    // Repli : « Saisir le code » ferme le modal et ouvre le champ code
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
