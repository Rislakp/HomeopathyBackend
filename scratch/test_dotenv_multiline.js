const dotenv = require('dotenv');
const testEnv = `
FOO=BAR
CLOUDFRONT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC
-----END PRIVATE KEY-----"
`;
const parsed = dotenv.parse(testEnv);
console.log('Parsed lines:', parsed.CLOUDFRONT_PRIVATE_KEY.split('\n').length);
console.log('Starts with header:', parsed.CLOUDFRONT_PRIVATE_KEY.startsWith('-----BEGIN'));
console.log('Ends with footer:', parsed.CLOUDFRONT_PRIVATE_KEY.endsWith('-----END PRIVATE KEY-----'));

