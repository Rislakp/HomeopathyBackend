const { isCloudFrontConfigured, isCloudFrontSigningConfigured, getKeyPairId, getCloudFrontDomain, signCloudFrontPlaybackUrl, resolveCloudFrontPlaybackUrl } = require('../utils/cloudFrontMediaSigner');
require('dotenv').config();

console.log('--- CloudFront Media Signer Config ---');
console.log('Domain:', getCloudFrontDomain());
console.log('KeyPairId present:', Boolean(getKeyPairId()));
console.log('Signing configured:', isCloudFrontSigningConfigured());
console.log('CloudFront configured:', isCloudFrontConfigured());

// Let's test signing a dummy or real key
const testKey = 'videos/1794377388545-409d7492-e1f2-49d3-b8e3-df71d37aec23-1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.mp4';
const resolved = resolveCloudFrontPlaybackUrl(testKey);
// Mask signing secrets in console
const masked = resolved.replace(/(Expires|Key-Pair-Id|Signature)=[^&]+/g, '$1=***');
console.log('Resolved URL format:', masked);

