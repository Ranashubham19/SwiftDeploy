
import React, { useState, useEffect, useRef } from 'react';
import { User } from '../types';
import { useNavigate, useLocation } from 'react-router-dom';
import { ICONS } from '../constants';

interface LoginProps {
  onLogin: (user: User) => void;
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  photo?: string;
}

declare global {
  interface Window {
    google: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, options: any) => void;
          prompt: () => void;
        };
      };
    };
  }
  
  interface ImportMetaEnv {
    readonly VITE_GOOGLE_CLIENT_ID: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

// Use environment variable for client ID
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "476474075650-7dp4j8e8m4v8bp3aqv2hcmduainvcc22.apps.googleusercontent.com";

type AuthMode = 'login' | 'register' | 'verify' | 'oauth-consent';

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const initialMode = (queryParams.get('mode') as AuthMode) || 'login';

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [nodeLog, setNodeLog] = useState<string>("Awaiting Handshake Initialization...");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  // Check authentication status on component mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/me`, {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data.user);
          // If user is authenticated, redirect to dashboard
          if (data.user) {
            const userObj: User = {
              id: data.user.id,
              email: data.user.email,
              name: data.user.name,
              plan: 'PRO',
              isSubscribed: true
            };
            onLogin(userObj);
            navigate('/dashboard');
          }
        }
      } catch (error) {
        console.log('Not authenticated');
      }
    };

    checkAuthStatus();
  }, [navigate, onLogin]);
  
  // Form States
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });
  
  // OTP State
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const handleGoogleCallback = (response: any) => {
    try {
      setNodeLog("Decoding Neural Token...");
      setGoogleError(null);
      
      if (!response.credential) {
        throw new Error("No credential received from Google");
      }
      
      const payload = decodeJwt(response.credential);
      if (payload && payload.email) {
        setFormData(prev => ({ ...prev, name: payload.name || payload.email.split('@')[0], email: payload.email }));
        setMode('oauth-consent');
        setNodeLog("Identity Bound Successfully.");
      } else {
        throw new Error("Invalid payload from Google");
      }
    } catch (error) {
      console.error("Google Sign-In Error:", error);
      setGoogleError("Failed to authenticate with Google. Please try again.");
      setNodeLog("Authentication Failed");
      setIsLoggingIn(false);
    }
  };

  const decodeJwt = (token: string) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) { return null; }
  };

  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return;
    
    let retryCount = 0;
    const maxRetries = 10;
    
    const initializeGoogleAuth = () => {
      if (window.google && window.google.accounts && window.google.accounts.id) {
        try {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: handleGoogleCallback,
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          
          if (googleBtnRef.current) {
            window.google.accounts.id.renderButton(googleBtnRef.current, {
              theme: "outline",
              size: "large",
              shape: "pill",
              text: "signin_with",
              logo_alignment: "left",
              width: "100%"
            });
          }
          
          setGoogleError(null);
        } catch (error) {
          console.error("Failed to initialize Google Auth:", error);
          setGoogleError("Failed to load Google authentication");
        }
      } else if (retryCount < maxRetries) {
        retryCount++;
        setTimeout(initializeGoogleAuth, 300);
      } else {
        setGoogleError("Google authentication library failed to load");
      }
    };
    
    // Check if Google script is loaded
    if (typeof window.google === 'undefined') {
      setGoogleError("Google authentication library is still loading...");
      const checkInterval = setInterval(() => {
        if (window.google && window.google.accounts) {
          clearInterval(checkInterval);
          initializeGoogleAuth();
        }
      }, 100);
      
      // Cleanup interval after 5 seconds
      setTimeout(() => clearInterval(checkInterval), 5000);
    } else {
      initializeGoogleAuth();
    }
  }, [mode, handleGoogleCallback]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setNodeLog("Dispatching Verification Signal...");
    
    try {
      // Send verification email
      const response = await fetch(`${import.meta.env.VITE_API_URL}/send-verification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          name: formData.name
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        setIsLoggingIn(false);
        setMode('verify');
      } else {
        throw new Error(result.error || 'Failed to send verification email');
      }
    } catch (error) {
      console.error('Registration failed:', error);
      setGoogleError('Failed to send verification email. Please try again.');
      setIsLoggingIn(false);
      setNodeLog("Authentication Failed");
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (isNaN(Number(value))) return;
    const newOtp = [...otp];
    newOtp[index] = value.substring(value.length - 1);
    setOtp(newOtp);

    // Auto-focus next
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const verifyAndFinalize = async () => {
    const code = otp.join('');
    setIsLoggingIn(true);
    setNodeLog("Validating Node Integrity...");
    
    try {
      // Verify the code with backend
      const response = await fetch(`${import.meta.env.VITE_API_URL}/verify-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          code: code
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        finalizeLogin(formData.email, formData.name);
      } else {
        throw new Error(result.error || 'Invalid verification code');
      }
    } catch (error) {
      console.error('Verification failed:', error);
      setGoogleError('Invalid or expired verification code. Please try again.');
      setIsLoggingIn(false);
      setNodeLog("Authentication Failed");
    }
  };

  const finalizeLogin = (userEmail: string, userName?: string) => {
    const userObj: User = {
      id: 'node_' + Math.random().toString(36).substr(2, 9),
      email: userEmail,
      name: userName || userEmail.split('@')[0],
      plan: 'PRO',
      isSubscribed: true
    };
    onLogin(userObj);
    setIsLoggingIn(false);
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen bg-[#020202] flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="max-w-xl w-full config-card rounded-[48px] p-12 md:p-16 bg-[#06060c]/90 relative overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.6)]">
        
        {/* Sign In View */}
        {mode === 'login' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-5xl font-black italic mb-2 text-white font-heading tracking-tighter uppercase text-center">Sign In</h2>
            <p className="text-zinc-500 font-bold mb-10 italic text-center">Access your production fleet</p>
            
            <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); finalizeLogin(formData.email); }}>
              <div className="space-y-4">
                <input 
                  type="email" 
                  value={formData.email} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="Email Address"
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-blue-500 transition-all outline-none font-bold"
                  required
                />
                <input 
                  type="password" 
                  value={formData.password} 
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  placeholder="Password"
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-blue-500 transition-all outline-none font-bold"
                  required
                />
              </div>
              <button className="bg-white hover:bg-zinc-200 text-black w-full py-5 rounded-2xl text-xl font-black italic shadow-xl transition-all active:scale-95">
                Initialize Session
              </button>
            </form>

            <div className="mt-8 text-center">
              <button onClick={() => setMode('register')} className="text-sm font-bold text-zinc-500 hover:text-white transition-colors">
                New operative? <span className="text-blue-500 underline underline-offset-4">Register Account</span>
              </button>
            </div>

            <div className="mt-12 pt-10 border-t border-white/5 space-y-6 text-center">
              <div className="flex justify-center">
                <button 
                  onClick={() => window.location.href = `${import.meta.env.VITE_API_URL}/auth/google`}
                  className="w-full max-w-xs py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
              </div>
              
              {googleError && (
                <div className="mt-4 space-y-3">
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <p className="text-red-400 text-sm font-bold flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {googleError}
                    </p>
                  </div>
                  
                  <button 
                    onClick={() => {
                      if (window.google && window.google.accounts) {
                        window.google.accounts.id.prompt();
                      }
                    }}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Try Google Sign-In Again
                  </button>
                </div>
              )}
              
              <div className="text-xs text-zinc-600 font-medium mt-4">
                <p>Secure authentication powered by Google</p>
              </div>
            </div>
          </div>
        )}

        {/* Register View */}
        {mode === 'register' && (
          <div className="animate-in fade-in slide-in-from-bottom-4">
            <h2 className="text-5xl font-black italic mb-2 text-white font-heading tracking-tighter uppercase text-center">Get Started</h2>
            <p className="text-zinc-500 font-bold mb-10 italic text-center">Join the autonomous intelligence grid</p>
            
            <form className="space-y-6" onSubmit={handleRegister}>
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={formData.name} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  placeholder="Full Name"
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-blue-500 transition-all outline-none font-bold"
                  required
                />
                <input 
                  type="email" 
                  value={formData.email} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="Operational Email"
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-blue-500 transition-all outline-none font-bold"
                  required
                />
                <input 
                  type="password" 
                  value={formData.password} 
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  placeholder="Create Password"
                  className="w-full bg-black/50 border border-white/10 rounded-2xl px-6 py-5 text-white focus:border-blue-500 transition-all outline-none font-bold"
                  required
                />
              </div>
              <button className="bg-blue-600 hover:bg-blue-500 text-white w-full py-5 rounded-2xl text-xl font-black italic shadow-xl transition-all active:scale-95">
                Create Account
              </button>
            </form>

            <div className="mt-8 text-center">
              <button onClick={() => setMode('login')} className="text-sm font-bold text-zinc-500 hover:text-white transition-colors">
                Already registered? <span className="text-white border-b border-zinc-800">Sign In</span>
              </button>
            </div>
          </div>
        )}

        {/* Verification View */}
        {mode === 'verify' && (
          <div className="animate-in zoom-in-95 text-center">
             <div className="w-20 h-20 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-8 border border-blue-500/20">
                <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
             </div>
             <h3 className="text-4xl font-black text-white mb-4 italic tracking-tighter uppercase">Verify Signal</h3>
             <p className="text-zinc-500 mb-12 italic text-sm leading-relaxed px-4">
               We've dispatched a 6-digit verification code to <span className="text-white font-bold">{formData.email}</span>. Please enter it below to activate your node.
             </p>
             
             <div className="flex justify-between gap-3 mb-12">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    // Fix: Return void from ref callback to satisfy TypeScript's Ref expectation
                    ref={el => { otpRefs.current[i] = el; }}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-full h-16 bg-black border border-white/10 rounded-2xl text-center text-2xl font-black text-blue-500 focus:border-blue-500 outline-none transition-all shadow-lg"
                  />
                ))}
             </div>

             <button onClick={verifyAndFinalize} disabled={otp.some(d => !d)} className="bg-white hover:bg-zinc-200 disabled:opacity-20 text-black w-full py-5 rounded-2xl text-xl font-black italic shadow-2xl transition-all active:scale-95">
               Validate & Join Grid
             </button>
             
             <button onClick={() => setMode('register')} className="mt-8 text-xs font-bold text-zinc-700 hover:text-white uppercase tracking-widest transition-colors">
               Incorrect email? Back to start
             </button>
          </div>
        )}

        {mode === 'oauth-consent' && (
          <div className="text-center animate-in zoom-in-95">
             <div className="w-24 h-24 rounded-full border-4 border-blue-500 mx-auto mb-8 overflow-hidden shadow-[0_0_30px_rgba(59,130,246,0.5)]">
               <img src={`https://ui-avatars.com/api/?name=${formData.name}&background=000&color=fff&size=128`} className="w-full h-full object-cover" alt="User avatar" />
             </div>
             <h3 className="text-3xl font-black text-white mb-4 italic tracking-tighter">Identity Authorized</h3>
             <p className="text-zinc-500 mb-10 italic">Welcome back, {formData.name.split(' ')[0]}. Initializing neural sync.</p>
             <button onClick={() => finalizeLogin(formData.email, formData.name)} className="bg-white hover:bg-zinc-200 text-black w-full py-5 rounded-2xl text-xl font-black italic shadow-2xl transition-all">
               Launch Dashboard
             </button>
          </div>
        )}

        {isLoggingIn && (
          <div className="absolute inset-0 bg-black/95 flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-8"></div>
            <p className="text-white font-black italic tracking-tighter animate-pulse text-lg uppercase tracking-widest">{nodeLog}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
