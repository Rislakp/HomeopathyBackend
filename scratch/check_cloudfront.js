const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { CloudFrontClient, ListDistributionsCommand } = require('@aws-sdk/client-cloudfront');

async function run() {
  const cf = new CloudFrontClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
  });

  try {
    const res = await cf.send(new ListDistributionsCommand({}));
    console.log('CloudFront distributions count:', res.DistributionList?.Items?.length || 0);
    for (const d of (res.DistributionList?.Items || [])) {
      console.log({
        Id: d.Id,
        DomainName: d.DomainName,
        Origins: d.Origins?.Items?.map(o => ({ Id: o.Id, DomainName: o.DomainName })),
        Status: d.Status,
        Enabled: d.Enabled,
        Aliases: d.Aliases?.Items,
      });
    }
  } catch (err) {
    console.log('CloudFront error:', err.message);
  }
}

run();

