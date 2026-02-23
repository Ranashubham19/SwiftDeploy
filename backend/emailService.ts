import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables in the email service as well
dotenv.config();

const OTP_EXPIRES_MS = 10 * 60 * 1000;
const OTP_MAX_FAILED_ATTEMPTS = 5;
const DEV_OTP_FALLBACK_ENABLED = process.env.ENABLE_DEV_OTP_FALLBACK === 'true';

type OtpRecord = {
  codeHash: Buffer;
  expiresAt: Date;
  failedAttempts: number;
};

// In-memory storage for verification codes (in production, use a proper database)
const verificationCodes = new Map<string, OtpRecord>();
const devPlainCodes = new Map<string, string>();

// In-memory storage for registered users with password hashes (in production, use a proper database)
type User = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
};
const registeredUsers = new Map<string, User>(); // Store registered users with their password hashes
const pendingSignups = new Map<string, { id: string; email: string; name: string; passwordHash: string; createdAt: Date }>();

// Create transporter with secure settings
const createTransport = () => {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);

  if (!smtpUser || !smtpPass) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === 'production'
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
  const normalizedEmail = email.toLowerCase();
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS);
  const codeHash = crypto.createHash('sha256').update(code).digest();
  verificationCodes.set(normalizedEmail, { codeHash, expiresAt, failedAttempts: 0 });
  if (process.env.NODE_ENV !== 'production') {
    devPlainCodes.set(normalizedEmail, code);
  }
};

// Validate verification code
export const validateVerificationCode = (email: string, code: string): { ok: boolean; reason?: 'missing' | 'expired' | 'attempts_exceeded' | 'invalid' } => {
  const normalizedEmail = email.toLowerCase();
  const stored = verificationCodes.get(normalizedEmail);
  
  if (!stored) {
    return { ok: false, reason: 'missing' };
  }
  
  if (new Date() > stored.expiresAt) {
    verificationCodes.delete(normalizedEmail); // Clean up expired code
    pendingSignups.delete(normalizedEmail);
    return { ok: false, reason: 'expired' };
  }

  if (stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    verificationCodes.delete(normalizedEmail);
    pendingSignups.delete(normalizedEmail);
    return { ok: false, reason: 'attempts_exceeded' };
  }
  
  const providedHash = crypto.createHash('sha256').update(code).digest();
  const isValid = providedHash.length === stored.codeHash.length && crypto.timingSafeEqual(providedHash, stored.codeHash);
  
  if (isValid) {
    verificationCodes.delete(normalizedEmail); // Remove used code
    devPlainCodes.delete(normalizedEmail);
    return { ok: true };
  }
  
  stored.failedAttempts += 1;
  if (stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS) {
    verificationCodes.delete(normalizedEmail);
    pendingSignups.delete(normalizedEmail);
    devPlainCodes.delete(normalizedEmail);
  } else {
    verificationCodes.set(normalizedEmail, stored);
  }

  return { ok: false, reason: stored.failedAttempts >= OTP_MAX_FAILED_ATTEMPTS ? 'attempts_exceeded' : 'invalid' };
};

// Check if email is already registered
export const isEmailRegistered = (email: string): boolean => {
  return registeredUsers.has(email.toLowerCase());
};

// Mark email as registered
export const markEmailAsRegistered = (email: string, name: string, passwordHash: string): User => {
  const normalizedEmail = email.toLowerCase();
  const user: User = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name,
    passwordHash
  };
  registeredUsers.set(normalizedEmail, user);
  pendingSignups.delete(normalizedEmail);
  return user;
};

// Get user by email
export const getUserByEmail = (email: string): User | undefined => {
  return registeredUsers.get(email.toLowerCase());
};

// Update password hash for user
export const updateUserPassword = (email: string, newPasswordHash: string): void => {
  const user = registeredUsers.get(email.toLowerCase());
  if (user) {
    registeredUsers.set(email.toLowerCase(), {
      ...user,
      passwordHash: newPasswordHash
    });
  }
};

export const storePendingSignup = (email: string, name: string, passwordHash: string): void => {
  const normalizedEmail = email.toLowerCase();
  pendingSignups.set(normalizedEmail, {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name,
    passwordHash,
    createdAt: new Date()
  });
};

export const getPendingSignup = (email: string): { id: string; email: string; name: string; passwordHash: string; createdAt: Date } | undefined => {
  return pendingSignups.get(email.toLowerCase());
};

export const clearPendingSignup = (email: string): void => {
  pendingSignups.delete(email.toLowerCase());
};

export const clearVerificationState = (email: string): void => {
  const normalizedEmail = email.toLowerCase();
  verificationCodes.delete(normalizedEmail);
  devPlainCodes.delete(normalizedEmail);
};

export const getDevVerificationCode = (email: string): string | undefined => {
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }
  return devPlainCodes.get(email.toLowerCase());
};

export type VerificationSendResult = {
  success: boolean;
  message: string;
  devCode?: string;
};

// Send verification email
export const sendVerificationEmail = async (email: string, name: string): Promise<VerificationSendResult> => {
  try {
    const code = generateVerificationCode();
    storeVerificationCode(email, code);
    
    const transporter = createTransport();
    if (!transporter) {
      if (process.env.NODE_ENV !== 'production' && DEV_OTP_FALLBACK_ENABLED) {
        console.log(`[DEV_OTP] ${email}: ${code}`);
        return { success: true, message: 'OTP generated in local mode', devCode: code };
      }
      clearVerificationState(email);
      return { success: false, message: 'Email service is not configured. Contact support.' };
    }
    
    const emailFrom = process.env.EMAIL_FROM || process.env.SMTP_USER;
    if (!emailFrom) {
      clearVerificationState(email);
      return { success: false, message: 'Email sender is not configured. Contact support.' };
    }

    const mailOptions = {
      from: emailFrom,  // Use the fallback value
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

    // Validate SMTP auth/connectivity before attempting delivery.
    await transporter.verify();
    await transporter.sendMail(mailOptions);
    
    return { success: true, message: 'OTP sent' };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production' && DEV_OTP_FALLBACK_ENABLED) {
      const fallbackCode = getDevVerificationCode(email);
      if (fallbackCode) {
        console.log(`[DEV_OTP_FALLBACK] ${email}: ${fallbackCode}`);
        return { success: true, message: 'OTP generated in local mode', devCode: fallbackCode };
      }
    }

    clearVerificationState(email);
    const err = error as any;
    const code = typeof err?.code === 'string' ? err.code : '';
    if (code === 'EAUTH') {
      return { success: false, message: 'SMTP authentication failed. Update SMTP credentials.' };
    }
    if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET') {
      return { success: false, message: 'Unable to connect to email server. Try again shortly.' };
    }
    return { success: false, message: 'Failed to deliver verification email. Please try again.' };
  }
};

// Send test email
export const sendTestEmail = async (email: string): Promise<boolean> => {
  try {
    const transporter = createTransport();
    if (!transporter) {
      return false;
    }
    
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

    await transporter.sendMail(mailOptions);
    
    return true;
  } catch (error) {
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
