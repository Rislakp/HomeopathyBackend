const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIosEncodeArgs, IOS_ENCODE_PROFILE } = require('../services/videoConversionService');

const argValue = (args, flag) => args[args.indexOf(flag) + 1];

test('iOS rendition always re-encodes (never stream copy)', () => {
  const args = buildIosEncodeArgs('in.mp4', 'out.mp4', '30/1');
  assert.ok(!args.includes('copy'), 'must not use -c copy: it keeps long keyframe gaps');
  assert.equal(argValue(args, '-c:v'), 'libx264');
  assert.equal(argValue(args, '-profile:v'), 'main');
  assert.equal(argValue(args, '-level:v'), '4.0');
  assert.ok(args.includes('+faststart'));
  assert.equal(args[args.length - 1], 'out.mp4');
});

test('keyframe every 2 seconds at a constant frame rate capped at 30', () => {
  const at60 = buildIosEncodeArgs('in.mp4', 'out.mp4', '60/1');
  assert.equal(argValue(at60, '-r'), '30');
  assert.equal(argValue(at60, '-g'), '60');
  assert.equal(argValue(at60, '-keyint_min'), '60');
  assert.equal(argValue(at60, '-sc_threshold'), '0');

  const at24 = buildIosEncodeArgs('in.mp4', 'out.mp4', '24000/1001');
  assert.equal(argValue(at24, '-r'), '24');
  assert.equal(argValue(at24, '-g'), '48');
});

test('encode profile is versioned so old remuxed renditions get rebuilt', () => {
  assert.equal(typeof IOS_ENCODE_PROFILE, 'string');
  assert.ok(IOS_ENCODE_PROFILE.length > 0);
});
