import Link from 'next/link';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 sm:p-12 rounded-2xl shadow-sm border border-gray-100 prose prose-slate">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-8">Privacy Policy</h1>
        
        <div className="space-y-6 text-gray-700">
          <p>
            Last Updated: {new Date().toLocaleDateString()}
          </p>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Introduction</h2>
            <p>
              Welcome to SecureAgent ("we", "our", or "us"). We respect your privacy and are committed to protecting your personal data. 
              SecureAgent is designed as a secure proxy that sits between your AI agents and your connected API services, enforcing security rules without unnecessarily storing your data.
            </p>
          </section>

          <section className="bg-blue-50 p-6 rounded-xl border border-blue-100 my-8">
            <h2 className="text-xl font-bold text-blue-900 mb-3">2. Google API Services Limited Use Policy</h2>
            <p className="font-medium text-blue-800">
              SecureAgent's use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800">Google API Services User Data Policy</a>, including the Limited Use requirements.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. How We Access and Use Your Data</h2>
            <p>When you connect your Google Workspace or Gmail account to SecureAgent, we request certain OAuth scopes (such as <code>gmail.readonly</code>, <code>gmail.send</code>, and <code>gmail.modify</code>). We use this access strictly to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>Proxy API requests made by your configured AI agents to the Gmail API.</li>
              <li>Apply your custom security rules (e.g., blocking reads of emails containing 2FA codes, or allowing sending only to whitelisted domains).</li>
            </ul>
            <p className="mt-4 font-semibold text-gray-900">Important limitations on our data use:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li><strong>No Data Storage:</strong> We do not permanently store your email messages, subject lines, attachments, or any other content retrieved from the Gmail API. Content passes through our servers in-memory purely to evaluate your security rules and is then immediately discarded.</li>
              <li><strong>No Human Access:</strong> No humans read your email data.</li>
              <li><strong>No AI Training:</strong> We never use your emails or any Google Workspace data to train, fine-tune, or improve our own or third-party AI models.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Information We Store</h2>
            <p>To provide our service, we strictly store:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>Your account identifier (Internal ID and Email Address) used for login.</li>
              <li>Your OAuth access tokens and refresh tokens (securely managed via Clerk).</li>
              <li>The proxy API keys you create and the security rules you define (Regex patterns, target emails).</li>
              <li>Metadata regarding proxy requests (e.g., timestamp, matched rule name, success/failure status) for your dashboard logs. We do <strong>not</strong> log the body or content of the emails in these logs.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Deletion of Data</h2>
            <p>
              You can revoke SecureAgent's access to your Google account at any time via your Google Account Security settings. If you delete your SecureAgent account, all associated API keys, defined security rules, access logs, and metadata will be permanently deleted from our databases.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Contact Us</h2>
            <p>
              If you have any questions or concerns about this privacy policy, please contact support.
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
