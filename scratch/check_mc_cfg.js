const { mediaConvertConfig } = require('../config/mediaconvert');
console.log('mediaConvertConfig keys:', Object.keys(mediaConvertConfig));
console.log('has cloudFrontKeyPairId:', Boolean(mediaConvertConfig.cloudFrontKeyPairId));
console.log('has cloudFrontPrivateKey:', Boolean(mediaConvertConfig.cloudFrontPrivateKey));
console.log('cloudFrontDomain:', mediaConvertConfig.cloudFrontDomain);
console.log('cookieDomain:', mediaConvertConfig.cookieDomain);

