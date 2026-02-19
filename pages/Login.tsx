import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { User } from '../types';
import { ICONS } from '../constants';
import { apiUrl } from '../utils/api';
import BrandLogo from '../components/BrandLogo';

interface LoginProps {
  onLogin: (user: User) => void;
}

type AuthMode = 'login' | 'register' | 'verify';

type FormErrors = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  terms: string;
};

const initialErrors: FormErrors = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  terms: ''
};

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const requestedMode = (queryParams.get('mode') as AuthMode) || 'login';
  const prefilledEmail = (queryParams.get('email') || '').trim().toLowerCase();
  const modeFromUrl: AuthMode = requestedMode === 'register' ? 'register' : 'login';

  const [mode, setMode] = useState<AuthMode>(modeFromUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: ''
  });
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [errors, setErrors] = useState<FormErrors>(initialErrors);
  const [toastError, setToastError] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpTimer, setOtpTimer] = useState(300);
  const [canResend, setCanResend] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotStep, setForgotStep] = useState<'email' | 'reset'>('email');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState('');
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const firstNameRef = useRef<HTMLInputElement | null>(null);

  const showError = (message: string) => {
    setToastError(message);
  };

  useEffect(() => {
    if (prefilledEmail && validateEmail(prefilledEmail)) {
      setFormData((prev) => ({ ...prev, email: prefilledEmail }));
    }
  }, [prefilledEmail]);

  useEffect(() => {
    if (!toastError) return;
    const timeout = setTimeout(() => setToastError(''), 3000);
    return () => clearTimeout(timeout);
  }, [toastError]);

  useEffect(() => {
    if (mode !== 'verify') return;
    setOtpTimer(300);
    setCanResend(false);
    setOtp(['', '', '', '', '', '']);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'verify' || otpTimer <= 0) return;
    const interval = setInterval(() => {
      setOtpTimer((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, otpTimer]);

  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await fetch(apiUrl('/me'), {
          credentials: 'include'
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.user) return;
        onLogin({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name,
          plan: data.user.plan || 'FREE',
          isSubscribed: Boolean(data.user.isSubscribed)
        });
        navigate('/', { replace: true });
      } catch {
        // Ignore unauthenticated state.
      }
    };

    checkAuthStatus();
  }, [navigate, onLogin]);

  const validateEmail = (email: string) => {
    const value = email.trim();
    if (value.length > 254) return false;
    const regex = /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
    return regex.test(value);
  };

  const validatePassword = (password: string) => {
    const minLength = password.length >= 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /[0-9]/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return {
      isValid: minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      errors: [
        !minLength && 'At least 8 characters',
        !hasUpperCase && 'One uppercase letter',
        !hasLowerCase && 'One lowercase letter',
        !hasNumbers && 'One number',
        !hasSpecialChar && 'One special character'
      ].filter(Boolean)
    };
  };

  const finalizeLogin = (authUser?: { id?: string; email: string; name?: string; plan?: User['plan']; isSubscribed?: boolean }) => {
    const email = authUser?.email || formData.email.trim().toLowerCase();
    const name = authUser?.name || email.split('@')[0];
    onLogin({
      id: authUser?.id || `node_${Math.random().toString(36).slice(2, 11)}`,
      email,
      name,
      plan: authUser?.plan || 'FREE',
      isSubscribed: Boolean(authUser?.isSubscribed)
    });
    setIsSubmitting(false);
    navigate('/', { replace: true });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors(initialErrors);
    setToastError('');

    const email = formData.email.trim().toLowerCase();
    let isValid = true;
    const nextErrors = { ...initialErrors };

    if (!email) {
      nextErrors.email = 'Email is required';
      isValid = false;
    } else if (!validateEmail(email)) {
      nextErrors.email = 'Please enter a valid email address';
      isValid = false;
    }

    if (!formData.password) {
      nextErrors.password = 'Password is required';
      isValid = false;
    } else if (formData.password.length < 8) {
      nextErrors.password = 'Password must be at least 8 characters';
      isValid = false;
    }

    setErrors(nextErrors);
    if (!isValid) {
      showError('Please fix the highlighted fields.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(apiUrl('/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: formData.password }),
        credentials: 'include'
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.success) {
        finalizeLogin(result.user || { email });
        return;
      }

      const message = result.message || 'Invalid email or password';
      showError(message);

      if (response.status === 400 || response.status === 404 || response.status === 401) {
        setErrors((prev) => ({ ...prev, email: 'Invalid email or password', password: 'Invalid email or password' }));
      }
      setIsSubmitting(false);
    } catch {
      showError('Failed to connect to authentication server.');
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors(initialErrors);
    setToastError('');

    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();
    const email = formData.email.trim().toLowerCase();
    const password = formData.password;
    const nextErrors = { ...initialErrors };
    let isValid = true;

    if (!firstName) {
      nextErrors.firstName = 'First name is required';
      isValid = false;
    } else if (!/^[A-Za-z][A-Za-z\s'-]{1,49}$/.test(firstName)) {
      nextErrors.firstName = 'Use 2-50 letters only';
      isValid = false;
    }

    if (!lastName) {
      nextErrors.lastName = 'Last name is required';
      isValid = false;
    } else if (!/^[A-Za-z][A-Za-z\s'-]{1,49}$/.test(lastName)) {
      nextErrors.lastName = 'Use 2-50 letters only';
      isValid = false;
    }

    if (!email) {
      nextErrors.email = 'Email is required';
      isValid = false;
    } else if (!validateEmail(email)) {
      nextErrors.email = 'Invalid email format';
      isValid = false;
    }

    const passwordValidation = validatePassword(password);
    if (!password) {
      nextErrors.password = 'Password is required';
      isValid = false;
    } else if (!passwordValidation.isValid) {
      nextErrors.password = `Must contain: ${passwordValidation.errors.join(', ')}`;
      isValid = false;
    } else if (password.length > 128) {
      nextErrors.password = 'Password must be 128 characters or less';
      isValid = false;
    }

    if (!agreedToTerms) {
      nextErrors.terms = 'You must agree to the Terms of Service';
      isValid = false;
    }

    setErrors(nextErrors);
    if (!isValid) {
      showError('Please correct all required fields.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(apiUrl('/send-verification'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: `${firstName} ${lastName}`,
          password
        }),
        credentials: 'include'
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.success) {
        setMode('verify');
        setFormData((prev) => ({ ...prev, email, password: '' }));
        if (typeof result.devCode === 'string' && /^\d{6}$/.test(result.devCode)) {
          setOtp(result.devCode.split(''));
          showError(`Dev verification code: ${result.devCode}`);
        }
        setIsSubmitting(false);
        return;
      }
      const message = result.message || 'Registration failed.';
      if (response.status === 400 || response.status === 409 || response.status === 429 || response.status === 500) {
        setErrors((prev) => ({ ...prev, email: message }));
      }
      showError(message);
      setIsSubmitting(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to authentication service.';
      showError(message || 'Registration failed. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = () => {
    const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();
    const googleApi = (window as any).google;

    if (googleClientId && googleApi?.accounts?.oauth2) {
      try {
        const tokenClient = googleApi.accounts.oauth2.initTokenClient({
          client_id: googleClientId,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: async (tokenResponse: any) => {
            try {
              const accessToken = tokenResponse?.access_token;
              if (!accessToken) {
                showError('Google sign-in was cancelled.');
                return;
              }

              const res = await fetch(apiUrl('/auth/google/access-token'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ accessToken })
              });
              const result = await res.json().catch(() => ({}));

              if (res.ok && result.success) {
                finalizeLogin(result.user);
                return;
              }
              if (res.status === 404) {
                window.location.href = apiUrl('/auth/google');
                return;
              }
              showError(result.message || 'Google sign-in failed.');
            } catch {
              showError('Google sign-in failed.');
            }
          }
        });

        tokenClient.requestAccessToken();
      } catch {
        showError('Google sign-in failed to initialize.');
      }
      return;
    }

    // Fallback for environments where GIS script is unavailable.
    window.location.href = apiUrl('/auth/google');
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleForgotSendCode = async () => {
    const email = forgotEmail.trim().toLowerCase() || formData.email.trim().toLowerCase();
    setForgotError('');
    setForgotSuccess('');

    if (!email) {
      setForgotError('Enter your account email first.');
      return;
    }
    if (!validateEmail(email)) {
      setForgotError('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(apiUrl('/forgot-password/send-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        setForgotError(result.message || 'Unable to send reset code.');
        return;
      }

      setForgotEmail(email);
      setForgotStep('reset');
      setForgotSuccess('Reset code sent. Check your email.');
    } catch {
      setForgotError('Unable to send reset code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotResetPassword = async () => {
    const email = forgotEmail.trim().toLowerCase();
    const code = forgotCode.trim();
    const password = forgotNewPassword;

    setForgotError('');
    setForgotSuccess('');

    if (!email) {
      setForgotError('Email is required.');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setForgotError('Enter a valid 6-digit reset code.');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      setForgotError(`Password must contain: ${passwordValidation.errors.join(', ')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(apiUrl('/forgot-password/reset'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, code, password })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        setForgotError(result.message || 'Password reset failed.');
        return;
      }

      setForgotSuccess('Password changed successfully. You can sign in now.');
      setShowForgotPassword(false);
      setForgotStep('email');
      setForgotCode('');
      setForgotNewPassword('');
      setFormData((prev) => ({ ...prev, email, password: '' }));
    } catch {
      setForgotError('Password reset failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendOtp = async () => {
    if (!canResend || isSubmitting) return;
    setIsSubmitting(true);
    setToastError('');
    try {
      const response = await fetch(apiUrl('/resend-verification'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase() }),
        credentials: 'include'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        const message = result.message || 'Failed to resend verification code.';
        showError(message);
      } else {
        setOtpTimer(300);
        setCanResend(false);
        setOtp(['', '', '', '', '', '']);
      }
    } catch {
      showError('Failed to resend verification code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyAndFinalize = async () => {
    const code = otp.join('');
    if (!/^\d{6}$/.test(code)) {
      showError('Please enter a valid 6-digit verification code.');
      return;
    }

    setIsSubmitting(true);
    setToastError('');
    try {
      const response = await fetch(apiUrl('/verify-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email.trim().toLowerCase(), code }),
        credentials: 'include'
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok && result.success) {
        finalizeLogin(result.user || { email: formData.email.trim().toLowerCase() });
        return;
      }

      showError(result.message || 'Invalid or expired verification code.');
      setOtp(['', '', '', '', '', '']);
      setIsSubmitting(false);
    } catch {
      showError('Verification failed. Please try again.');
      setOtp(['', '', '', '', '', '']);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050a16] flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-400/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="max-w-xl w-full config-card rounded-[36px] p-8 md:p-10 bg-[#0a1221]/90 relative overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-center mb-8">
          <BrandLogo />
        </div>
        {toastError && (
          <div className="mb-5 p-3 bg-red-500/15 border border-red-500/40 rounded-xl animate-in fade-in slide-in-from-top-2">
            <p className="text-red-300 text-sm font-semibold text-center">{toastError}</p>
          </div>
        )}

        {mode === 'login' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-4xl font-black mb-2 text-white font-heading tracking-tight text-center uppercase">Sign in</h2>
            <p className="text-zinc-400 mb-8 text-center">Access your production fleet</p>

            <form className="space-y-5" onSubmit={handleLogin}>
              <div className="space-y-1">
                <label className="text-sm text-zinc-300 font-semibold">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter your email"
                  className={`w-full bg-[#07111f]/80 border ${errors.email ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none`}
                  autoComplete="email"
                  required
                />
                {errors.email && <p className="text-red-400 text-xs">{errors.email}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-300 font-semibold">Password</label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Enter your password"
                    className={`w-full bg-[#07111f]/80 border ${errors.password ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 pr-12 text-white focus:border-cyan-400 transition-all outline-none`}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-white"
                    aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                  >
                    {showLoginPassword ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 3l18 18" />
                        <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                        <path d="M9.88 5.09A10.94 10.94 0 0112 5c7 0 10 7 10 7a17.1 17.1 0 01-3.34 4.55" />
                        <path d="M6.61 6.61A17.2 17.2 0 002 12s3 7 10 7a10.9 10.9 0 005.39-1.39" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-xs">{errors.password}</p>}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-deploy-gradient disabled:opacity-60 text-white w-full py-3 rounded-xl text-lg font-semibold transition-all active:scale-[0.99]"
              >
                Continue
              </button>
            </form>

            <div className="mt-6 text-center text-zinc-400">
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword((prev) => !prev);
                  setForgotError('');
                  setForgotSuccess('');
                }}
                className="text-cyan-300 font-semibold hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {showForgotPassword && (
              <div className="mt-4 rounded-xl border border-white/15 bg-[#07111f]/70 p-4 space-y-3">
                <p className="text-sm text-zinc-300 font-semibold">Reset your password</p>

                {forgotStep === 'email' && (
                  <>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="Enter your account email"
                      className="w-full bg-[#07111f]/80 border border-white/15 rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleForgotSendCode}
                      disabled={isSubmitting}
                      className="w-full btn-deploy-gradient disabled:opacity-60 text-white py-3 rounded-xl font-semibold"
                    >
                      Send Reset Code
                    </button>
                  </>
                )}

                {forgotStep === 'reset' && (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={forgotCode}
                      onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Enter 6-digit code"
                      className="w-full bg-[#07111f]/80 border border-white/15 rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none"
                    />
                    <div className="relative">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="w-full bg-[#07111f]/80 border border-white/15 rounded-xl px-4 py-3 pr-12 text-white focus:border-cyan-400 transition-all outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword((prev) => !prev)}
                        className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-white"
                        aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                      >
                        {showResetPassword ? (
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 3l18 18" />
                            <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                            <path d="M9.88 5.09A10.94 10.94 0 0112 5c7 0 10 7 10 7a17.1 17.1 0 01-3.34 4.55" />
                            <path d="M6.61 6.61A17.2 17.2 0 002 12s3 7 10 7a10.9 10.9 0 005.39-1.39" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleForgotResetPassword}
                      disabled={isSubmitting}
                      className="w-full btn-deploy-gradient disabled:opacity-60 text-white py-3 rounded-xl font-semibold"
                    >
                      Reset Password
                    </button>
                  </>
                )}

                {forgotError && <p className="text-red-400 text-xs">{forgotError}</p>}
                {forgotSuccess && <p className="text-emerald-300 text-xs">{forgotSuccess}</p>}
              </div>
            )}

            <div className="mt-6 text-center text-zinc-400">
              Don&apos;t have an account?{' '}
              <button onClick={() => setMode('register')} className="text-white font-semibold hover:underline">
                Sign up
              </button>
            </div>
          </div>
        )}

        {mode === 'register' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-5xl font-black mb-2 text-white font-heading tracking-tight text-center">Sign up</h2>
            <p className="text-zinc-400 mb-8 text-center sr-only">Create your account</p>

            <form className="space-y-5 mt-6" onSubmit={handleRegister}>
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full bg-[#181a1d] hover:bg-[#1e2126] border border-white/10 rounded-xl px-4 py-3 text-white font-bold transition-all"
              >
                <span className="inline-flex items-center justify-center gap-3">
                  <span className="w-5 h-5"><ICONS.Google className="w-5 h-5" /></span>
                  <span>Sign up with Google</span>
                </span>
              </button>

              <div className="flex items-center gap-4">
                <div className="h-px bg-white/10 flex-1"></div>
                <span className="text-xs font-black uppercase tracking-widest text-zinc-500">OR</span>
                <div className="h-px bg-white/10 flex-1"></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm text-zinc-300 font-semibold">First Name</label>
                  <input
                    ref={firstNameRef}
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, firstName: e.target.value }))}
                    placeholder="Enter first name"
                    className={`w-full bg-[#07111f]/80 border ${errors.firstName ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none`}
                    maxLength={50}
                    required
                  />
                  {errors.firstName && <p className="text-red-400 text-xs">{errors.firstName}</p>}
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-zinc-300 font-semibold">Last Name</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Enter last name"
                    className={`w-full bg-[#07111f]/80 border ${errors.lastName ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none`}
                    maxLength={50}
                    required
                  />
                  {errors.lastName && <p className="text-red-400 text-xs">{errors.lastName}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-300 font-semibold">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter your email address"
                  className={`w-full bg-[#07111f]/80 border ${errors.email ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 text-white focus:border-cyan-400 transition-all outline-none`}
                  autoComplete="email"
                  required
                />
                {errors.email && <p className="text-red-400 text-xs">{errors.email}</p>}
              </div>

              <div className="space-y-1">
                <label className="text-sm text-zinc-300 font-semibold">Password</label>
                <div className="relative">
                  <input
                    type={showSignupPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Create password"
                    className={`w-full bg-[#07111f]/80 border ${errors.password ? 'border-red-500' : 'border-white/15'} rounded-xl px-4 py-3 pr-12 text-white focus:border-cyan-400 transition-all outline-none`}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword((prev) => !prev)}
                    className="absolute inset-y-0 right-0 px-3 text-zinc-400 hover:text-white"
                    aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                  >
                    {showSignupPassword ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 3l18 18" />
                        <path d="M10.58 10.58a2 2 0 102.83 2.83" />
                        <path d="M9.88 5.09A10.94 10.94 0 0112 5c7 0 10 7 10 7a17.1 17.1 0 01-3.34 4.55" />
                        <path d="M6.61 6.61A17.2 17.2 0 002 12s3 7 10 7a10.9 10.9 0 005.39-1.39" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-xs">{errors.password}</p>}
              </div>

              <label className="flex items-start gap-2 text-sm text-zinc-400">
                <input
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-1 accent-green-500"
                />
                <span>
                  Agree to the <Link to="/terms" className="text-zinc-100 underline">Terms of Service</Link> and <Link to="/privacy" className="text-zinc-100 underline">Privacy Policy</Link>
                </span>
              </label>
              {errors.terms && <p className="text-red-400 text-xs">{errors.terms}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#30d158] hover:bg-[#2bc34f] disabled:opacity-60 text-black w-full py-3 rounded-xl text-3xl font-medium transition-all active:scale-[0.99]"
              >
                Continue
              </button>
            </form>

            <div className="mt-6 text-center text-zinc-400">
              Already have an account?{' '}
              <button onClick={() => setMode('login')} className="text-white font-semibold hover:underline">
                Sign in
              </button>
            </div>
          </div>
        )}

        {mode === 'verify' && (
          <div className="animate-in fade-in text-center">
            <h2 className="text-3xl font-black text-white mb-3 uppercase">Verify Email</h2>
            <p className="text-zinc-500 mb-6">
              Enter the 6-digit code sent to <span className="text-white font-semibold">{formData.email}</span>
            </p>

            <div className="flex justify-between gap-2 mb-6">
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  className="w-full h-12 bg-[#07111f]/80 border border-white/15 rounded-xl text-center text-xl font-semibold text-cyan-300 focus:border-cyan-400 outline-none"
                />
              ))}
            </div>

            <button
              onClick={verifyAndFinalize}
              disabled={otp.some((d) => !d) || isSubmitting}
              className="btn-deploy-gradient disabled:opacity-60 text-white w-full py-3 rounded-xl text-lg font-semibold transition-all"
            >
              Continue
            </button>

            <div className="mt-4 text-sm text-zinc-500">
              {otpTimer > 0 ? (
                <span>
                  Code expires in <span className="text-cyan-300">{Math.floor(otpTimer / 60)}:{(otpTimer % 60).toString().padStart(2, '0')}</span>
                </span>
              ) : (
                <button onClick={resendOtp} className="text-cyan-300 hover:text-cyan-200" disabled={isSubmitting || !canResend}>
                  Resend code
                </button>
              )}
            </div>
          </div>
        )}

        {isSubmitting && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="w-10 h-10 border-4 border-cyan-300 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
