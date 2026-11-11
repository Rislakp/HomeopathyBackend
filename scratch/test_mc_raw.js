require('dotenv').config();
const { MediaConvertClient, DescribeEndpointsCommand } = require('@aws-sdk/client-mediaconvert');

const client = new MediaConvertClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});

client.send(new DescribeEndpointsCommand({ MaxResults: 1 }))
  .then(res => console.log('DescribeEndpoints success:', res))
  .catch(err => {
    console.log('Error name:', err.name);
    console.log('Error message:', err.message);
    if (err.$response) {
      console.log('Response status:', err.$response.statusCode);
      console.log('Response headers:', err.$response.headers);
      if (err.$response.body) {
        console.log('Response body type:', typeof err.$response.body);
      }
    }
  });

