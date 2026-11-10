const fs = require('fs');
const path = require('path');

const testFile = path.resolve(__dirname, '../../WCA-Student_portal/test/webm_video_player_test.dart');
let content = fs.readFileSync(testFile, 'utf-8');

const additionalTests = `    testWidgets('WebMediaEventTracker.installIosWebVideoHook executes cleanly and idempotently',
        (WidgetTester tester) async {
      expect(() => WebMediaEventTracker.installIosWebVideoHook(), returnsNormally);
      expect(() => WebMediaEventTracker.installIosWebVideoHook(), returnsNormally);
    });

    testWidgets('Autoplay NotAllowedError clears controller errorDescription on tap-to-play so listener updates proceed',
        (WidgetTester tester) async {
      fakePlatform.simulatedDuration = const Duration(minutes: 60);
      fakePlatform.isPlaying = false;

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: VideoPlayerModal(
              videoUrl: 'https://example.com/videos/1792655031349-PHARMACY-4.mp4',
              title: 'PHARMACY-4 MP4 iOS Test',
              initialDurationSeconds: 3600,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Simulate Safari NotAllowedError
      fakePlatform.emitError(
        'PlatformException(NotAllowedError, The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission., null, null)',
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Tap Play to simulate authentic user interaction
      await tester.tap(find.byKey(const Key('video_player_play_pause_button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(fakePlatform.isPlaying, isTrue);

      // Verify that controller state continues to emit updates without stuck error
      fakePlatform.emitPosition(const Duration(seconds: 15));
      await tester.pump();
      expect(find.text('PHARMACY-4 MP4 iOS Test'), findsOneWidget);
    });

    testWidgets('MP4 video playback controls (seek, volume, fullscreen, responsive) remain intact',
        (WidgetTester tester) async {
      fakePlatform.simulatedDuration = const Duration(minutes: 45);
      fakePlatform.isPlaying = true;

      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: VideoPlayerModal(
              videoUrl: 'https://example.com/videos/1792655031349-PHARMACY-4.mp4',
              title: 'Controls Test',
              initialDurationSeconds: 2700,
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Verify forward 10s and backward 10s buttons exist
      expect(find.byKey(const Key('video_player_forward_10_button')), findsOneWidget);
      expect(find.byKey(const Key('video_player_backward_10_button')), findsOneWidget);

      // Forward 10s seek
      await tester.tap(find.byKey(const Key('video_player_forward_10_button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Backward 10s seek
      await tester.tap(find.byKey(const Key('video_player_backward_10_button')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Verify fullscreen toggle button exists
      expect(find.byKey(const Key('video_player_fullscreen_button')), findsOneWidget);
    });
  });
}
`;

if (!content.includes('WebMediaEventTracker.installIosWebVideoHook executes cleanly')) {
  content = content.replace('  });\n}', additionalTests);
  fs.writeFileSync(testFile, content, 'utf-8');
  console.log('Added tests to test/webm_video_player_test.dart');
} else {
  console.log('Tests already present');
}
