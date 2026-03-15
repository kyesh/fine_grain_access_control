import Link from 'next/link';

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-slate-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-gray-100 prose prose-slate">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-8">Terms of Service</h1>
        
        <div className="space-y-6 text-gray-700">
          <p>
            Last Updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>
              By accessing and using SecureAgent ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Description of Service</h2>
            <p>
              SecureAgent is a security proxy designed to sit between user-configured AI agents and third-party APIs (such as the Google Gmail API). We provide a platform for you to generate proxy API keys and define filtering rules (allowlists and blocklists) to restrict the actions your AI agents can perform on your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Use of Google Services</h2>
            <p>
              The Service requires you to authenticate with your Google account. Your use of the Service to interact with Google APIs is subject to the <Link href="/privacy" className="text-blue-600 underline">SecureAgent Privacy Policy</Link> and the Google API Services User Data Policy. You maintain full ownership of your data, and we do not claim any rights over the email content processed through the proxy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. User Account and Security</h2>
            <p>
              You are responsible for maintaining the confidentiality of any proxy API keys you generate. You agree to immediately revoke any keys or notify us of any unauthorized use of your account. We are not liable for any loss or damage arising from your failure to protect your API keys.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. acceptable Use</h2>
            <p>You agree not to use the Service to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>Violate any local, state, national, or international law.</li>
              <li>Attempt to bypass, disable, or interfere with security-related features of the Service.</li>
              <li>Use the proxy for sending spam, phishing, or bulk unsolicited emails.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Disclaimer of Warranties and Limitation of Liability</h2>
            <p>
              The Service is provided "AS IS" without warranties of any kind. We do not guarantee that the proxy rules will prevent 100% of unwanted agent actions, as AI behavior and API formats can be unpredictable. In no event shall SecureAgent be liable for any indirect, incidental, special, or consequential damages resulting from the use or inability to use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. We will provide notice of significant changes by updating the date at the top of this page. Your continued use of the Service after such changes constitutes your acceptance of the new Terms of Service.
            </p>
          </section>
        </div>
        
        <div className="mt-12 pt-8 border-t border-gray-100">
          <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium font-sm flex items-center gap-2">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
