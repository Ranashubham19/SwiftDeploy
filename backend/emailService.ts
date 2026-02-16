import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// In-memory storage for verification codes (in production, use a proper database)
const verificationCodes = new Map<string, { code: string; expiresAt: Date }>();

// Create transporter with secure settings
const createTransport = () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false // Only for development - set to true in production
    }
  });

  return transporter;
};

// Generate 6-digit verification code
const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store verification code with 10-minute expiry
const storeVerificationCode = (email: string, code: string): void => {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  verificationCodes.set(email, { code, expiresAt });
  console.log(`[EMAIL] Stored verification code for ${email}: ${code} (expires at ${expiresAt.toISOString()})`);
};

// Validate verification code
export const validateVerificationCode = (email: string, code: string): boolean => {
  const stored = verificationCodes.get(email);
  
  if (!stored) {
    console.log(`[EMAIL] No verification code found for ${email}`);
    return false;
  }
  
  if (new Date() > stored.expiresAt) {
    console.log(`[EMAIL] Verification code for ${email} has expired`);
    verificationCodes.delete(email); // Clean up expired code
    return false;
  }
  
  const isValid = stored.code === code;
  console.log(`[EMAIL] Verification code validation for ${email}: ${isValid ? 'SUCCESS' : 'FAILED'}`);
  
  if (isValid) {
    verificationCodes.delete(email); // Remove used code
  }
  
  return isValid;
};

// Send verification email
export const sendVerificationEmail = async (email: string, name: string): Promise<boolean> => {
  try {
    console.log(`[EMAIL] Generating verification code for ${email}`);
    const code = generateVerificationCode();
    storeVerificationCode(email, code);
    
    console.log(`[EMAIL] Sending verification email to ${email}`);
    
    const transporter = createTransport();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'SwiftDeploy - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">SwiftDeploy</h1>
            <p style="color: #bfdbfe; margin: 10px 0 0 0; font-size: 16px;">AI Bot Deployment Platform</p>
          </div>
          
          <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #1e293b; margin-top: 0;">Hello ${name}!</h2>
            
            <p style="color: #64748b; line-height: 1.6; margin: 20px 0;">
              Welcome to SwiftDeploy! Please use the verification code below to complete your account setup.
            </p>
            
            <div style="background: white; border: 2px dashed #3b82f6; border-radius: 8px; padding: 25px; text-align: center; margin: 30px 0;">
              <p style="color: #64748b; margin: 0 0 10px 0; font-size: 14px;">Your Verification Code</p>
              <h2 style="color: #1e40af; font-size: 36px; letter-spacing: 8px; margin: 0; font-weight: bold;">${code}</h2>
            </div>
            
            <p style="color: #64748b; line-height: 1.6; margin: 20px 0;">
              This code will expire in 10 minutes. If you didn't request this verification, please ignore this email.
            </p>
            
            <div style="background: #f1f5f9; padding: 20px; border-radius: 8px; margin-top: 30px;">
              <p style="color: #64748b; margin: 0; font-size: 14px;">
                <strong>Need help?</strong> Contact our support team at ops@swiftdeploy.ai
              </p>
            </div>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #94a3b8; font-size: 12px;">
            <p>© 2025 SwiftDeploy Operations Group LLC. All rights reserved.</p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Verification email sent successfully to ${email}`);
    console.log(`[EMAIL] Message ID: ${info.messageId}`);
    
    return true;
  } catch (error) {
    console.error(`[EMAIL] Failed to send verification email to ${email}:`, error);
    return false;
  }
};

// Send test email
export const sendTestEmail = async (email: string): Promise<boolean> => {
  try {
    console.log(`[EMAIL] Sending test email to ${email}`);
    
    const transporter = createTransport();
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'SwiftDeploy - Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #10b981 0%, #34d399 100%); padding: 30px; text-align: center; border-radius: 10px;">
            <h1 style="color: white; margin: 0; font-size: 28px;">✅ Email Test Successful!</h1>
            <p style="color: #d1fae5; margin: 10px 0 0 0; font-size: 16px;">SwiftDeploy Email System is Working</p>
          </div>
          
          <div style="background: #f0fdf4; padding: 30px; border: 1px solid #bbf7d0; border-top: none; border-radius: 0 0 10px 10px; margin-top: 20px;">
            <h2 style="color: #065f46; margin-top: 0;">Test Email Confirmation</h2>
            
            <p style="color: #065f46; line-height: 1.6; margin: 20px 0;">
              This is a test email from SwiftDeploy to confirm that your email configuration is working properly.
            </p>
            
            <div style="background: white; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <p style="color: #065f46; margin: 0; font-size: 14px;">
                <strong>Configuration Status:</strong> ✅ Active
              </p>
              <p style="color: #065f46; margin: 5px 0 0 0; font-size: 14px;">
                <strong>Timestamp:</strong> ${new Date().toISOString()}
              </p>
            </div>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Test email sent successfully to ${email}`);
    console.log(`[EMAIL] Message ID: ${info.messageId}`);
    
    return true;
  } catch (error) {
    console.error(`[EMAIL] Failed to send test email to ${email}:`, error);
    return false;
  }
};

// Get pending verification codes (for debugging)
export const getPendingVerifications = (): Array<{email: string, expiresAt: string}> => {
  return Array.from(verificationCodes.entries()).map(([email, data]) => ({
    email,
    expiresAt: data.expiresAt.toISOString()
  }));
};