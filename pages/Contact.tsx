import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';

const Contact: React.FC = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus('idle');

    try {
      // Simulate form submission
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // In a real app, you would send this to your backend
      console.log('Contact form submitted:', formData);
      
      setSubmitStatus('success');
      setFormData({ name: '', email: '', subject: '', message: '' });
      
      // Reset success message after 3 seconds
      setTimeout(() => setSubmitStatus('idle'), 3000);
    } catch (error) {
      console.error('Form submission error:', error);
      setSubmitStatus('error');
      
      // Reset error message after 3 seconds
      setTimeout(() => setSubmitStatus('idle'), 3000);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050a16] via-[#0a1426] to-[#050a16] flex flex-col items-center justify-center p-6 relative font-sans overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-blue-500 rounded-full mix-blend-soft-light filter blur-3xl opacity-20 animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-teal-500 rounded-full mix-blend-soft-light filter blur-3xl opacity-20 animate-pulse animation-delay-2000"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500 rounded-full mix-blend-soft-light filter blur-3xl opacity-10 animate-ping"></div>
      </div>
      
      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[length:50px_50px]"></div>
      
      {/* Floating Particles */}
      <div className="absolute inset-0">
        {[...Array(20)].map((_, i) => (
          <div 
            key={i}
            className="absolute w-1 h-1 bg-blue-400 rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${3 + Math.random() * 4}s`
            }}
          ></div>
        ))}
      </div>
      
      {/* Back Button */}
      <button 
        onClick={() => navigate(-1)}
        className="absolute top-8 left-8 flex items-center gap-2 text-zinc-500 hover:text-white transition-colors font-bold text-sm uppercase tracking-widest"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="w-full max-w-4xl bg-[#0c0c0e]/90 backdrop-blur-xl border border-white/10 rounded-[40px] shadow-[0_60px_120px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-700 hover:shadow-[0_80px_160px_rgba(59,130,246,0.1)] transition-all duration-500 relative">
        {/* Glow Effect */}
        <div className="absolute inset-0 rounded-[40px] bg-gradient-to-r from-cyan-500/10 to-teal-500/10 opacity-0 hover:opacity-100 transition-opacity duration-500"></div>
        {/* Header */}
        <div className="p-12 md:p-16 border-b border-white/5">
          <div className="text-center mb-8 relative">
            {/* Animated Icon */}
            <div className="relative w-20 h-20 bg-gradient-to-br from-cyan-500 to-teal-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_40px_rgba(30,168,255,0.4)] animate-pulse hover:animate-none transition-all duration-300 group cursor-pointer">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-300 to-teal-300 opacity-0 group-hover:opacity-100 transition-opacity duration-300 animate-ping"></div>
              <svg className="w-10 h-10 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            
            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight uppercase mb-4 bg-gradient-to-r from-white via-cyan-100 to-teal-200 bg-clip-text text-transparent animate-gradient">
              Get in <span className="text-transparent bg-gradient-to-r from-cyan-300 to-teal-400 bg-clip-text">Touch</span>
            </h1>
            
            <div className="relative max-w-2xl mx-auto">
              <p className="text-zinc-400 font-medium text-lg leading-relaxed relative z-10">
                Have questions about our <span className="text-blue-400 font-bold">autonomous bot infrastructure</span>? 
                Our team is ready to help you <span className="text-teal-300 font-bold">deploy at scale</span>.
              </p>
              
              {/* Decorative Elements */}
              <div className="absolute -top-2 -left-4 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
              <div className="absolute -bottom-2 -right-4 w-2 h-2 bg-teal-500 rounded-full animate-pulse animation-delay-1000"></div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row">
          {/* Contact Form */}
          <div id="contact-form" className="flex-1 p-12 md:p-16">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-zinc-600 mb-3">
                    Full Name
                  </label>
                  <div className="relative group">
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-[#141416] border border-white/10 rounded-2xl px-6 py-4 text-white font-medium focus:outline-none focus:border-blue-500/70 focus:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300 placeholder:text-zinc-600 group-hover:border-white/20"
                      placeholder="John Doe"
                    />
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-zinc-600 mb-3">
                    Email Address
                  </label>
                  <div className="relative group">
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      className="w-full bg-[#141416] border border-white/10 rounded-2xl px-6 py-4 text-white font-medium focus:outline-none focus:border-blue-500/70 focus:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300 placeholder:text-zinc-600 group-hover:border-white/20"
                      placeholder="john@company.com"
                    />
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-zinc-600 mb-3">
                  Subject
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    name="subject"
                    value={formData.subject}
                    onChange={handleInputChange}
                    required
                    className="w-full bg-[#141416] border border-white/10 rounded-2xl px-6 py-4 text-white font-medium focus:outline-none focus:border-blue-500/70 focus:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300 placeholder:text-zinc-600 group-hover:border-white/20"
                    placeholder="How can we help you?"
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-zinc-600 mb-3">
                  Message
                </label>
                <div className="relative group">
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    required
                    rows={6}
                    className="w-full bg-[#141416] border border-white/10 rounded-2xl px-6 py-4 text-white font-medium focus:outline-none focus:border-blue-500/70 focus:shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all duration-300 placeholder:text-zinc-600 resize-none group-hover:border-white/20"
                    placeholder="Tell us about your project, questions, or feedback..."
                  />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"></div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                      className="w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-white py-5 rounded-2xl font-black text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(30,168,255,0.3)] hover:shadow-[0_0_60px_rgba(30,168,255,0.45)] active:scale-95 uppercase group relative overflow-hidden"
              >
                {/* Animated Background */}
                <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
                
                {isSubmitting ? (
                  <>
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Sending Message</span>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="relative z-10">Send Message</span>
                    <svg className="w-5 h-5 relative z-10 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>

              {submitStatus === 'success' && (
                <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                  <p className="text-green-400 text-sm font-bold text-center flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Message sent successfully! We'll get back to you soon.
                  </p>
                </div>
              )}

              {submitStatus === 'error' && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm font-bold text-center flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Failed to send message. Please try again.
                  </p>
                </div>
              )}
            </form>
          </div>

          {/* Contact Info */}
          <div className="lg:w-[420px] p-10 md:p-12 bg-[#09090b] border-t lg:border-t-0 lg:border-l border-white/5">
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-black text-white uppercase tracking-tight">
                  Contact Information
                </h3>
                <span className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-300 bg-cyan-400/10 border border-cyan-300/20 px-3 py-1 rounded-full">
                  Priority
                </span>
              </div>

              <div className="space-y-4">
                <div className="bg-[#0f1013] border border-white/10 rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-cyan-400/20">
                    <svg className="w-6 h-6 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-black text-xs uppercase tracking-widest mb-2">Email</p>
                    <a href="mailto:ops@swiftdeploy.ai" className="text-zinc-300 hover:text-white transition-colors font-semibold break-all">
                      ops@swiftdeploy.ai
                    </a>
                  </div>
                </div>

                <div className="bg-[#0f1013] border border-white/10 rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-cyan-400/20">
                    <svg className="w-6 h-6 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-black text-xs uppercase tracking-widest mb-2">Support Hours</p>
                    <p className="text-zinc-300 font-semibold leading-relaxed">24/7 priority support for Pro Fleet users</p>
                  </div>
                </div>

                <div className="bg-[#0f1013] border border-white/10 rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-12 h-12 bg-cyan-500/10 rounded-xl flex items-center justify-center flex-shrink-0 border border-cyan-400/20">
                    <svg className="w-6 h-6 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-black text-xs uppercase tracking-widest mb-2">Response Time</p>
                    <p className="text-zinc-300 font-semibold leading-relaxed">Under 2 hours for critical issues</p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
