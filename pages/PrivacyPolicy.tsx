import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const PrivacyPolicy: React.FC = () => {
  const effectiveDate = 'February 18, 2026';

  return (
    <div className="min-h-screen bg-[#050a16] text-zinc-100 px-6 py-10 md:px-12 md:py-14">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-10">
          <BrandLogo />
          <Link to="/login?mode=register" className="text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white">
            Back
          </Link>
        </div>

        <div className="config-card rounded-3xl p-7 md:p-10">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-zinc-400 text-sm mb-8">Effective date: {effectiveDate}</p>

          <div className="space-y-6 text-sm leading-7 text-zinc-300">
            <section>
              <h2 className="text-white font-bold mb-2">1. Information We Collect</h2>
              <p>We collect account details (name, email), authentication data, billing metadata, and service usage data needed to provide and secure SwiftDeploy.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">2. How We Use Data</h2>
              <p>We use data to operate the platform, authenticate users, prevent abuse, process payments, provide support, and improve reliability and performance.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">3. Payments</h2>
              <p>Payments are processed by third-party providers (for example Stripe). We do not store full card numbers or payment instrument secrets on our servers.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">4. Security</h2>
              <p>We apply technical and organizational controls including authentication checks, rate limits, and session protections. No system is completely risk-free.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">5. Data Sharing</h2>
              <p>We share data only with trusted service providers required for infrastructure, analytics, security, and payment processing, or when required by law.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">6. Data Retention</h2>
              <p>We retain data only as long as needed for service delivery, legal obligations, dispute resolution, and security auditing.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">7. Your Rights</h2>
              <p>You may request access, correction, or deletion of personal data where applicable by contacting us using the email below.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">8. Policy Updates</h2>
              <p>We may update this policy from time to time. Updated versions will be posted with a revised effective date.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">9. Contact</h2>
              <p>For privacy requests, contact: <a href="mailto:ops@swiftdeploy.ai" className="text-cyan-300 hover:text-cyan-200">ops@swiftdeploy.ai</a>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
