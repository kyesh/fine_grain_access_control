import { SignInButton, SignUpButton, Show } from '@clerk/nextjs';
import Link from 'next/link';

export default async function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-8">
      <div className="max-w-3xl text-center space-y-8">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl bg-clip-text text-transparent bg-gradient-to-r from-brand-purple to-brand-glow">
          Agent Security, Solved.
        </h1>
        <p className="text-xl text-gray-800 max-w-2xl mx-auto">
          Give your AI agents access to Google APIs safely. 
          Use standard Google SDKs while strictly controlling their read, write, and delete permissions.
        </p>
        
        <div className="flex gap-4 justify-center pt-8">
          <Show when="signed-out">
            <Link href="/waitlist">
              <button className="rounded-full bg-brand-purple px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple transition-all">
                Join Beta Waitlist
              </button>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link
              href="/waitlist"
              className="rounded-full bg-brand-purple px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-purple transition-all"
            >
              Join Beta Waitlist
            </Link>
          </Show>
          <Link href="/setup" className="rounded-full px-8 py-3.5 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-brand-purple/20 hover:ring-brand-purple/40">
            Setup Guide
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3 text-left">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-2">Standard Google SDKs</h3>
            <p className="text-sm text-gray-800">Works with official Python and Node.js Google SDKs. Just point the endpoint at your proxy and go.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-2">Content Filtering</h3>
            <p className="text-sm text-gray-800">Use regular expressions to block agents from reading sensitive emails like 2FA or Password Resets.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-2">Deletion Safeguards</h3>
            <p className="text-sm text-gray-800">Whitelist specific domains for deletion and globally block &quot;Empty Trash&quot; commands.</p>
          </div>
        </div>

        {/* Google Data Usage Section */}
        <div className="mt-16 bg-brand-purple/5 border border-brand-purple/20 p-8 rounded-3xl text-left shadow-sm">
          <div className="flex items-start gap-4">
            <div className="bg-brand-purple/10 p-3 rounded-2xl">
              <svg className="w-6 h-6 text-brand-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">How we use Google Data</h3>
              <p className="text-gray-600 mb-4 leading-relaxed">
              FGAC.ai requires access to your Gmail account (via scopes like <code className="bg-brand-purple/10 px-1.5 py-0.5 rounded text-brand-purple text-sm">gmail.readonly</code>, <code className="bg-brand-purple/10 px-1.5 py-0.5 rounded text-brand-purple text-sm">gmail.send</code>, and <code className="bg-brand-purple/10 px-1.5 py-0.5 rounded text-brand-purple text-sm">gmail.modify</code>) to act as a secure proxy between your inbox and your AI agents.
              </p>
              <p className="text-gray-600 leading-relaxed">
              When your AI agent makes an API request, we strictly enforce your custom allowlists and blocklists before forwarding the exact request to the Google API. We never permanently store your email content, and your data is never used to train our AI models. No humans read your emails.
            </p>
            <p className="text-sm">
              Our use of information received from Google APIs will adhere to the <Link href="/privacy" className="underline text-brand-purple hover:text-brand-purple/80">Google API Services User Data Policy</Link>, including the <strong>Limited Use</strong> requirements.
            </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
