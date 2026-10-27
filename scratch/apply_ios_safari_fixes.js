const fs = require('fs');
const path = require('path');

const studentPortalDir = path.resolve(__dirname, '../../WCA-Student_portal');

console.log('Target directory:', studentPortalDir);

// 1. Update web/index.html
const indexPath = path.join(studentPortalDir, 'web/index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf-8');

const iosScript = `  <!-- iOS Safari WebKit Video Playback Enhancer -->
  <script>
    (function() {
      if (window.__wcaIosVideoHookInstalled) return;
      window.__wcaIosVideoHookInstalled = true;

      function enhanceVideo(video) {
        if (!video || video.__wcaEnhanced) return;
        video.__wcaEnhanced = true;

        try {
          video.setAttribute('playsinline', 'true');
          video.setAttribute('webkit-playsinline', 'true');
          video.playsInline = true;
          video.webkitPlaysInline = true;
          if (!video.preload || video.preload === 'none') {
            video.preload = 'auto';
          }
        } catch (e) {}

        var canPlayFired = false;
        video.addEventListener('canplay', function() {
          canPlayFired = true;
        });

        // iOS Safari AVPlayer parses moov on loadedmetadata.
        // If canplay is delayed awaiting user gesture, bridge canplay
        // so video_player_web's _onVideoElementInitialization resolves promptly.
        video.addEventListener('loadedmetadata', function() {
          if (!canPlayFired && video.readyState >= 1) {
            setTimeout(function() {
              if (!canPlayFired && video.readyState >= 1) {
                try {
                  video.dispatchEvent(new Event('canplay'));
                } catch (e) {}
              }
            }, 100);
          }
        });
      }

      try {
        var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        if (desc && desc.set) {
          var origSet = desc.set;
          desc.set = function(val) {
            origSet.call(this, val);
            enhanceVideo(this);
          };
          Object.defineProperty(HTMLMediaElement.prototype, 'src', desc);
        }
      } catch (e) {}

      try {
        var observer = new MutationObserver(function(mutations) {
          for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            for (var j = 0; j < m.addedNodes.length; j++) {
              var node = m.addedNodes[j];
              if (node.nodeName === 'VIDEO') {
                enhanceVideo(node);
              } else if (node.querySelectorAll) {
                var vids = node.querySelectorAll('video');
                for (var k = 0; k < vids.length; k++) {
                  enhanceVideo(vids[k]);
                }
              }
              if (node.shadowRoot) {
                try {
                  observer.observe(node.shadowRoot, { childList: true, subtree: true });
                } catch (e) {}
              }
            }
          }
        });

        if (document.documentElement) {
          observer.observe(document.documentElement, { childList: true, subtree: true });
        } else {
          document.addEventListener('DOMContentLoaded', function() {
            observer.observe(document.documentElement, { childList: true, subtree: true });
          });
        }
      } catch (e) {}
    })();
  </script>`;

if (!indexHtml.includes('window.__wcaIosVideoHookInstalled')) {
  indexHtml = indexHtml.replace('  <title>White Coat Academy', `${iosScript}\n\n  <title>White Coat Academy`);
  fs.writeFileSync(indexPath, indexHtml, 'utf-8');
  console.log('Updated web/index.html');
} else {
  console.log('web/index.html already has hook');
}

// 2. Update lib/utils/web_media_event_tracker.dart
const trackerPath = path.join(studentPortalDir, 'lib/utils/web_media_event_tracker.dart');
let trackerCode = fs.readFileSync(trackerPath, 'utf-8');

const hookMethod = `  /// Installs global iOS Safari WebKit helper to ensure inline playback attributes,
  /// automatic byte-range preloading, and bridging loadedmetadata -> canplay for video_player_web.
  static void installIosWebVideoHook() {
    if (!kIsWeb) return;
    try {
      final installed = js.context['__wcaIosVideoHookInstalled'];
      if (installed == true) return;
      js.context.callMethod('eval', [
        r'''
        (function() {
          if (window.__wcaIosVideoHookInstalled) return;
          window.__wcaIosVideoHookInstalled = true;

          function enhanceVideo(video) {
            if (!video || video.__wcaEnhanced) return;
            video.__wcaEnhanced = true;

            try {
              video.setAttribute('playsinline', 'true');
              video.setAttribute('webkit-playsinline', 'true');
              video.playsInline = true;
              video.webkitPlaysInline = true;
              if (!video.preload || video.preload === 'none') {
                video.preload = 'auto';
              }
            } catch (e) {}

            var canPlayFired = false;
            video.addEventListener('canplay', function() {
              canPlayFired = true;
            });

            video.addEventListener('loadedmetadata', function() {
              if (!canPlayFired && video.readyState >= 1) {
                setTimeout(function() {
                  if (!canPlayFired && video.readyState >= 1) {
                    try {
                      video.dispatchEvent(new Event('canplay'));
                    } catch (e) {}
                  }
                }, 100);
              }
            });
          }

          try {
            var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
            if (desc && desc.set) {
              var origSet = desc.set;
              desc.set = function(val) {
                origSet.call(this, val);
                enhanceVideo(this);
              };
              Object.defineProperty(HTMLMediaElement.prototype, 'src', desc);
            }
          } catch (e) {}

          try {
            var observer = new MutationObserver(function(mutations) {
              for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                for (var j = 0; j < m.addedNodes.length; j++) {
                  var node = m.addedNodes[j];
                  if (node.nodeName === 'VIDEO') {
                    enhanceVideo(node);
                  } else if (node.querySelectorAll) {
                    var vids = node.querySelectorAll('video');
                    for (var k = 0; k < vids.length; k++) {
                      enhanceVideo(vids[k]);
                    }
                  }
                  if (node.shadowRoot) {
                    try {
                      observer.observe(node.shadowRoot, { childList: true, subtree: true });
                    } catch (e) {}
                  }
                }
              }
            });

            if (document.documentElement) {
              observer.observe(document.documentElement, { childList: true, subtree: true });
            }
            var fvs = document.querySelectorAll('flutter-view');
            for (var f = 0; f < fvs.length; f++) {
              if (fvs[f].shadowRoot) {
                try {
                  observer.observe(fvs[f].shadowRoot, { childList: true, subtree: true });
                } catch (e) {}
              }
            }
          } catch (e) {}

          try {
            var existing = document.querySelectorAll('video');
            for (var e = 0; e < existing.length; e++) {
              enhanceVideo(existing[e]);
            }
          } catch (e) {}
        })();
        '''
      ]);
    } catch (e) {
      debugPrint('[WebMediaEventTracker] installIosWebVideoHook error: $e');
    }
  }

  /// Detects whether running inside Apple Safari or mobile iOS WebKit`;

if (!trackerCode.includes('static void installIosWebVideoHook()')) {
  trackerCode = trackerCode.replace(
    '  /// Detects whether running inside Apple Safari or mobile iOS WebKit',
    hookMethod
  );
}

// In tracker initialize(), ensure installIosWebVideoHook() is called
if (!trackerCode.includes('installIosWebVideoHook();')) {
  trackerCode = trackerCode.replace(
    'void initialize() {\n    if (!kIsWeb) return;',
    'void initialize() {\n    if (!kIsWeb) return;\n    installIosWebVideoHook();'
  );
}

fs.writeFileSync(trackerPath, trackerCode, 'utf-8');
console.log('Updated lib/utils/web_media_event_tracker.dart');

// 3. Update lib/pages/courses/widgets/video_player_modal.dart
const modalPath = path.join(studentPortalDir, 'lib/pages/courses/widgets/video_player_modal.dart');
let modalCode = fs.readFileSync(modalPath, 'utf-8');

// A. In _initPlayer(): call WebMediaEventTracker.installIosWebVideoHook()
if (!modalCode.includes('WebMediaEventTracker.installIosWebVideoHook();')) {
  modalCode = modalCode.replace(
    'void initState() {\n    super.initState();',
    'void initState() {\n    super.initState();\n    if (kIsWeb) {\n      WebMediaEventTracker.installIosWebVideoHook();\n    }'
  );
}

// B. In _initPlayer(), fix _isPlaying initialization on iOS Safari
modalCode = modalCode.replace(
  `        final ctrlDur = _controller!.value.duration;
        setState(() {
          _isInitialized = true;
          _isRetrying = false;
          _hasError = false;
          _errorMessage = '';
          _isPlaying = true;
          _isBuffering = false;`,
  `        final ctrlDur = _controller!.value.duration;
        final bool isSafari = kIsWeb && WebMediaEventTracker.isSafariOrIos();
        setState(() {
          _isInitialized = true;
          _isRetrying = false;
          _hasError = false;
          _errorMessage = '';
          _isPlaying = !isSafari;
          _isBuffering = false;`
);

// C. In _initPlayer(), guard autoplay on iOS Safari to avoid triggering NotAllowedError
modalCode = modalCode.replace(
  `        if (kIsWeb) {
          if (MediaDurationFormatter.isValidDuration(_controller!.value.duration) &&
              _controller!.value.duration > Duration.zero &&
              _controller!.value.position != _controller!.value.duration) {
            _controller!.play().catchError((e) {
              debugPrint('[VideoPlayerModal] web play error: $e');
              if (_isAutoplayNotAllowedError(e.toString())) {
                if (mounted) {
                  setState(() {
                    _isPlaying = false;
                    _isBuffering = false;
                  });
                  _triggerCenterControls();
                }
              }
            });
          }
        }`,
  `        if (kIsWeb) {
          final bool isSafari = WebMediaEventTracker.isSafariOrIos();
          if (!isSafari &&
              MediaDurationFormatter.isValidDuration(_controller!.value.duration) &&
              _controller!.value.duration > Duration.zero &&
              _controller!.value.position != _controller!.value.duration) {
            _controller!.play().catchError((e) {
              debugPrint('[VideoPlayerModal] web play error: $e');
              if (_isAutoplayNotAllowedError(e.toString())) {
                if (mounted) {
                  try {
                    _controller?.value = _controller!.value.copyWith(errorDescription: null);
                  } catch (_) {}
                  setState(() {
                    _isPlaying = false;
                    _isBuffering = false;
                  });
                  _triggerCenterControls();
                }
              }
            });
          } else if (isSafari) {
            _isPlaying = false;
            _triggerCenterControls();
          }
        }`
);

// D. In _playerListener(), clear errorDescription when NotAllowedError is handled
modalCode = modalCode.replace(
  `      if (_isAutoplayNotAllowedError(value.errorDescription)) {
        debugPrint('[VideoPlayerModal] Browser autoplay blocked (NotAllowedError). Awaiting user gesture.');
        setState(() {
          _isPlaying = false;
          _isBuffering = false;
        });
        _triggerCenterControls();
        return;
      }`,
  `      if (_isAutoplayNotAllowedError(value.errorDescription)) {
        debugPrint('[VideoPlayerModal] Browser autoplay blocked (NotAllowedError). Awaiting user gesture.');
        try {
          controller.value = controller.value.copyWith(errorDescription: null);
        } catch (_) {}
        setState(() {
          _isPlaying = false;
          _isBuffering = false;
        });
        _triggerCenterControls();
        return;
      }`
);

// E. In _resumeVideo() and _togglePlayPause(), clear any stale error from controller
modalCode = modalCode.replace(
  `    final Duration targetPos = (_savedPlaybackPosition != null &&
            _savedPlaybackPosition! > Duration.zero)
        ? _savedPlaybackPosition!
        : _position;`,
  `    try {
      controller.value = controller.value.copyWith(errorDescription: null);
    } catch (_) {}

    final Duration targetPos = (_savedPlaybackPosition != null &&
            _savedPlaybackPosition! > Duration.zero)
        ? _savedPlaybackPosition!
        : _position;`
);

// F. In _applyNoDownloadRestrictions(), search shadow roots as well
modalCode = modalCode.replace(
  `  void _applyNoDownloadRestrictions() {
    if (!kIsWeb || _downloadRestrictionsApplied) return;
    try {
      final videoElements = html.document.getElementsByTagName('video');
      if (videoElements.isNotEmpty) {
        for (final node in videoElements) {
          if (node is html.Element) {
            node.setAttribute('controlsList', 'nodownload');
            node.setAttribute('disablePictureInPicture', 'true');
            node.style.objectFit = 'contain';
            if (node.getAttribute('data-context-blocked') != 'true') {
              node.setAttribute('data-context-blocked', 'true');
              node.onContextMenu.listen((e) => e.preventDefault());
            }
          }
        }
        _downloadRestrictionsApplied = true;
      }
    } catch (_) {}
  }`,
  `  void _applyNoDownloadRestrictions() {
    if (!kIsWeb || _downloadRestrictionsApplied) return;
    try {
      void applyTo(dynamic node) {
        if (node == null) return;
        try {
          if (node is html.Element) {
            node.setAttribute('controlsList', 'nodownload');
            node.setAttribute('disablePictureInPicture', 'true');
            node.style.objectFit = 'contain';
            if (node.getAttribute('data-context-blocked') != 'true') {
              node.setAttribute('data-context-blocked', 'true');
              node.onContextMenu.listen((e) => e.preventDefault());
            }
          }
        } catch (_) {}
      }

      final videoElements = html.document.getElementsByTagName('video');
      for (final node in videoElements) {
        applyTo(node);
      }
      final flutterViews = html.document.querySelectorAll('flutter-view');
      for (final fv in flutterViews) {
        final sr = fv.shadowRoot;
        if (sr != null) {
          final shadowVideos = sr.querySelectorAll('video');
          for (final sv in shadowVideos) {
            applyTo(sv);
          }
        }
      }
      _downloadRestrictionsApplied = true;
    } catch (_) {}
  }`
);

fs.writeFileSync(modalPath, modalCode, 'utf-8');
console.log('Updated lib/pages/courses/widgets/video_player_modal.dart');
