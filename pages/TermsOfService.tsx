import React from 'react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';

const TermsOfService: React.FC = () => {
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
          <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-2">Terms of Service</h1>
          <p className="text-zinc-400 text-sm mb-8">Effective date: {effectiveDate}</p>

          <div className="space-y-6 text-sm leading-7 text-zinc-300">
            <section>
              <h2 className="text-white font-bold mb-2">1. Acceptance of Terms</h2>
              <p>By accessing or using SwiftDeploy, you agree to these Terms of Service and our Privacy Policy. If you do not agree, do not use the service.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">2. Account and Security</h2>
              <p>You are responsible for maintaining account credentials, controlling access to your account, and all activity under your account.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">3. Permitted Use</h2>
              <p>You may use SwiftDeploy only for lawful purposes. You must not use the service for fraud, abuse, unauthorized access, spam, malware, or illegal content distribution.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">4. Plans, Billing, and Upgrades</h2>
              <p>Free plan usage is limited. Paid plans are billed based on selected cycle and are subject to payment provider terms. You are responsible for taxes and billing accuracy.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">5. Service Availability</h2>
              <p>We may update, suspend, or discontinue features at any time. We do not guarantee uninterrupted or error-free operation.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">6. Intellectual Property</h2>
              <p>SwiftDeploy branding, code, designs, and content remain the property of SwiftDeploy or its licensors. You receive a limited, non-exclusive right to use the service.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">7. Limitation of Liability</h2>
              <p>To the maximum extent permitted by law, SwiftDeploy is not liable for indirect, incidental, special, or consequential damages arising from service use.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">8. Termination</h2>
              <p>We may suspend or terminate accounts that violate these terms or create security risk. You may stop using the service at any time.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">9. Changes to Terms</h2>
              <p>We may revise these terms from time to time. Continued use after updates means you accept the revised terms.</p>
            </section>

            <section>
              <h2 className="text-white font-bold mb-2">10. Contact</h2>
              <p>For legal or compliance questions, contact: <a href="mailto:ops@swiftdeploy.ai" className="text-cyan-300 hover:text-cyan-200">ops@swiftdeploy.ai</a>.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
