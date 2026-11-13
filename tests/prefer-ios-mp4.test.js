const test = require('node:test');
const assert = require('node:assert/strict');
const { preferIosMp4OverHls } = require('../controllers/studentCurriculumController');

test('lesson with an _ios.mp4 plays MP4, not HLS', () => {
  const lesson = {
    playbackType: 'hls',
    hlsMasterUrl: 'https://media.example/hls/a.m3u8',
    hlsPlaybackUrl: 'https://media.example/hls/a.m3u8',
    m4vUrl: 'https://media.example/videos/a_ios.mp4',
    videoUrl: 'https://media.example/videos/a_ios.mp4',
    streamUrl: 'https://meet.example/live',
    videoParts: [{
      playbackType: 'hls',
      hlsMasterUrl: 'https://media.example/hls/a.m3u8',
      m4vUrl: 'https://media.example/videos/a_ios.mp4',
    }],
  };
  preferIosMp4OverHls(lesson);
  assert.equal(lesson.playbackType, 'mp4');
  assert.equal(lesson.hlsMasterUrl, '');
  assert.equal(lesson.hlsPlaybackUrl, '');
  assert.equal(lesson.videoUrl, 'https://media.example/videos/a_ios.mp4');
  assert.equal(lesson.streamUrl, 'https://meet.example/live', 'live class link is untouched');
  assert.equal(lesson.videoParts[0].playbackType, 'mp4');
  assert.equal(lesson.videoParts[0].hlsMasterUrl, '');
});

test('lesson without an _ios.mp4 keeps HLS', () => {
  const lesson = {
    playbackType: 'hls',
    hlsMasterUrl: 'https://media.example/hls/b.m3u8',
    videoParts: [{ playbackType: 'hls', hlsMasterUrl: 'https://media.example/hls/b.m3u8' }],
  };
  preferIosMp4OverHls(lesson);
  assert.equal(lesson.playbackType, 'hls');
  assert.equal(lesson.hlsMasterUrl, 'https://media.example/hls/b.m3u8');
  assert.equal(lesson.videoParts[0].hlsMasterUrl, 'https://media.example/hls/b.m3u8');
});
