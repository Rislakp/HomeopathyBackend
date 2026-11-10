const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { s3Client, bucket } = require('../config/s3');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

async function getS3Text(key) {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return await res.Body.transformToString();
}

async function run() {
  const masterKey = 'hls/PHARMACY-4/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4.m3u8';
  console.log('=== MASTER PLAYLIST ===');
  const master = await getS3Text(masterKey);
  console.log(master);

  const var360Key = 'hls/PHARMACY-4/1792646336243-cd382b58-b74b-439b-a662-4ee16630dd1e-PHARMACY-4_360p.m3u8';
  console.log('\n=== FIRST 25 LINES OF 360p PLAYLIST ===');
  const var360 = await getS3Text(var360Key);
  console.log(var360.split('\n').slice(0, 25).join('\n'));
}

run().catch(e => console.error(e));

