const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

async function loadHlsSecrets() {
  if (process.env.NODE_ENV !== "production") return;

  const client = new SecretsManagerClient({ region: "us-east-1" });

  try {
    const response = await client.send(
      new GetSecretValueCommand({
        SecretId: "whitecoat/production/hls-signing",
      })
    );

    if (!response.SecretString) {
      throw new Error("HLS signing secret is empty");
    }

    const secrets = JSON.parse(response.SecretString);

    if (!secrets.CLOUDFRONT_PRIVATE_KEY || !secrets.HLS_WEBHOOK_SECRET) {
      throw new Error("Required HLS signing secrets are missing");
    }

    process.env.CLOUDFRONT_PRIVATE_KEY = secrets.CLOUDFRONT_PRIVATE_KEY;
    process.env.HLS_WEBHOOK_SECRET = secrets.HLS_WEBHOOK_SECRET;

    const { mediaConvertConfig } = require("../config/mediaconvert");
    mediaConvertConfig.cloudFrontPrivateKey = secrets.CLOUDFRONT_PRIVATE_KEY;
    mediaConvertConfig.webhookSecret = secrets.HLS_WEBHOOK_SECRET;

    console.log("[Startup] HLS signing secrets loaded successfully.");
  } finally {
    client.destroy();
  }
}

module.exports = loadHlsSecrets;
