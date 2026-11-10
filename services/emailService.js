const nodemailer = require('nodemailer');

/**
 * In-memory buffer of sent emails for testing, debugging, and verification
 * when external SMTP or SES credentials are not configured.
 */
const sentEmailsBuffer = [];

/**
 * Check if SMTP delivery is fully configured in the environment.
 */
const isSmtpConfigured = () => {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
};

/**
 * Creates a Nodemailer transport instance based on current environment variables.
 */
const createTransporter = () => {
  if (isSmtpConfigured()) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    const isSecure = process.env.SMTP_SECURE === 'true' || port === 465;

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: isSecure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }

  return null;
};

/**
 * Formats a clean, responsive HTML email for admin password reset.
 */
const renderPasswordResetHtml = ({ name, resetUrl, resetToken, expiresInMinutes }) => {
  const adminName = name ? String(name).trim() : 'Admin';
  const expiry = expiresInMinutes || 15;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>White Coat Academy - Password Reset</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      background-color: #f4f6f9;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 30px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      border: 1px solid #e5e7eb;
    }
    .header {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      color: #ffffff;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header p {
      margin: 6px 0 0;
      font-size: 14px;
      opacity: 0.9;
    }
    .content {
      padding: 32px 30px;
    }
    .content p {
      margin: 0 0 16px;
      font-size: 15px;
      color: #4b5563;
    }
    .button-container {
      text-align: center;
      margin: 28px 0;
    }
    .btn {
      display: inline-block;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: 0.2px;
    }
    .token-box {
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 16px;
      margin: 20px 0;
      text-align: center;
    }
    .token-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .token-code {
      font-family: 'Courier New', Courier, monospace;
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: 1px;
      word-break: break-all;
    }
    .notice {
      background: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 12px 16px;
      margin: 24px 0 16px;
      border-radius: 0 6px 6px 0;
    }
    .notice p {
      margin: 0;
      font-size: 13px;
      color: #991b1b;
    }
    .url-fallback {
      font-size: 12px;
      color: #6b7280;
      word-break: break-all;
      margin-top: 20px;
    }
    .footer {
      background-color: #f9fafb;
      padding: 20px 30px;
      text-align: center;
      border-top: 1px solid #e5e7eb;
      font-size: 13px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>White Coat Academy</h1>
      <p>Admin Portal Security</p>
    </div>
    <div class="content">
      <p>Hello <strong>${adminName}</strong>,</p>
      <p>We received a request to reset the password for your White Coat Academy administrator account.</p>
      
      <div class="button-container">
        <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">Reset Admin Password</a>
      </div>

      <div class="token-box">
        <div class="token-label">Password Reset Token (if prompted directly)</div>
        <div class="token-code">${resetToken}</div>
      </div>

      <div class="notice">
        <p><strong>Security Notice:</strong> This reset link is valid for <strong>${expiry} minutes</strong> and can only be used once. If you did not request this password reset, please ignore this email or notify security immediately. Your account remains secure.</p>
      </div>

      <div class="url-fallback">
        <p>If the button above does not work, copy and paste this URL into your browser:</p>
        <p><a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a></p>
      </div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} White Coat Academy. All rights reserved.<br>
      Automated system message. Please do not reply to this email.
    </div>
  </div>
</body>
</html>`;
};

/**
 * Formats a plain text version of the password reset email.
 */
const renderPasswordResetText = ({ name, resetUrl, resetToken, expiresInMinutes }) => {
  const adminName = name ? String(name).trim() : 'Admin';
  const expiry = expiresInMinutes || 15;

  return `Hello ${adminName},

We received a request to reset the password for your White Coat Academy administrator account.

To reset your password, please click the link below (or copy and paste it into your browser):
${resetUrl}

Alternatively, you can enter the following verification token in the reset screen:
${resetToken}

SECURITY NOTICE:
- This reset link and token are valid for ${expiry} minutes.
- The link can only be used once.
- If you did not request this reset, no action is required. Your current password remains secure.

White Coat Academy Security Team
`;
};

/**
 * Sends a password reset email to the specified recipient.
 * If SMTP credentials are configured in .env, transmits via Nodemailer.
 * If SMTP credentials are not configured (e.g. development/testing/audit),
 * captures the message safely in memory and logs a diagnostic message without crashing.
 *
 * @param {Object} options
 * @param {string} options.to Recipient email address
 * @param {string} options.name Recipient admin name
 * @param {string} options.resetToken Plain-text single-use reset token
 * @param {string} options.resetUrl Fully qualified password reset link
 * @param {number} options.expiresInMinutes Expiration window in minutes
 * @returns {Promise<Object>} Delivery result metadata
 */
const sendPasswordResetEmail = async ({ to, name, resetToken, resetUrl, expiresInMinutes = 15 }) => {
  if (!to || typeof to !== 'string') {
    throw new Error('Recipient email address is required');
  }

  const cleanTo = to.trim().toLowerCase();
  const subject = 'White Coat Academy - Admin Password Reset Request';
  const from = process.env.EMAIL_FROM || '"White Coat Academy" <noreply@whitecoat.academy>';

  const html = renderPasswordResetHtml({ name, resetUrl, resetToken, expiresInMinutes });
  const text = renderPasswordResetText({ name, resetUrl, resetToken, expiresInMinutes });

  const mailOptions = {
    from,
    to: cleanTo,
    subject,
    text,
    html,
  };

  const transporter = createTransporter();

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EmailService] Password reset email sent via SMTP to ${cleanTo} (id: ${info.messageId})`);
      return {
        success: true,
        messageId: info.messageId,
        simulated: false,
      };
    } catch (error) {
      console.error(`[EmailService] SMTP delivery failed for ${cleanTo}:`, error.message);
      throw error;
    }
  }

  // Fallback: development / testing / unconfigured SMTP mode
  const record = {
    to: cleanTo,
    subject,
    resetToken,
    resetUrl,
    expiresInMinutes,
    sentAt: new Date(),
    simulated: true,
  };

  sentEmailsBuffer.push(record);
  console.log(`[EmailService] SMTP not configured. Simulated reset email recorded for ${cleanTo}. Token: ${resetToken.slice(0, 8)}... (URL: ${resetUrl})`);

  return {
    success: true,
    messageId: `simulated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    simulated: true,
  };
};

/**
 * Retrieve simulated sent emails (useful for test assertions).
 */
const getSentEmails = () => [...sentEmailsBuffer];

/**
 * Clear the simulated email buffer.
 */
const clearSentEmails = () => {
  sentEmailsBuffer.length = 0;
};

module.exports = {
  sendPasswordResetEmail,
  isSmtpConfigured,
  getSentEmails,
  clearSentEmails,
};

