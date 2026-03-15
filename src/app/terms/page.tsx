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
              By accessing and using FGAC.ai ("the Service"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Description of Service</h2>
            <p>
              FGAC.ai is a security proxy designed to sit between user-configured AI agents and third-party APIs (such as the Google Gmail API). We provide a platform for you to generate proxy API keys and define filtering rules (allowlists and blocklists) to restrict the actions your AI agents can perform on your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Use of Google Services</h2>
            <p>
              The Service requires you to authenticate with your Google account. Your use of the Service to interact with Google APIs is subject to the <Link href="/privacy" className="text-blue-600 underline">FGAC.ai Privacy Policy</Link> and the Google API Services User Data Policy. You maintain full ownership of your data, and we do not claim any rights over the email content processed through the proxy.
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
            <p className="font-bold text-red-600 mb-2">
              THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND.
            </p>
            <p>
              FGAC.ai strictly disclaims all warranties, express or implied. Under no circumstances, including negligence, shall FGAC.ai or its developers be liable for any direct, indirect, incidental, special, punitive, or consequential damages (including, but not limited to, data loss, unauthorized AI agent actions, permanent deletion of emails, or API quota overages) arising out of or in connection with the use of the Service. You acknowledge that controlling AI agents is inherently unpredictable and you assume all risk associated with granting them proxy access to your accounts.
            </p>
          </section>
          
          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless FGAC.ai, its authors, and affiliates from and against any and all claims, damages, obligations, losses, liabilities, costs, or debt, and expenses (including but not limited to attorney's fees) arising from: (i) your use of and access to the Service; (ii) your violation of any term of these Terms of Service; (iii) any actions taken by AI agents utilizing your generated proxy keys; or (iv) your violation of any third-party right, including without limitation any copyright, property, or privacy right.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Changes to Terms</h2>
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
