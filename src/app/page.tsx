import { SignInButton, SignUpButton, Show } from '@clerk/nextjs';
import Link from 'next/link';

export default async function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-64px)] p-8">
      <div className="max-w-3xl text-center space-y-8">
        <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl bg-clip-text text-transparent bg-gradient-to-r from-brand-blue to-brand-orange">
          Agent Security, Solved.
        </h1>
        <p className="text-xl text-gray-800 max-w-2xl mx-auto">
          Give your AI agents access to Google APIs safely. 
          Use standard Google SDKs while strictly controlling their read, write, and delete permissions.
        </p>
        
        <div className="flex gap-4 justify-center pt-8">
          <Show when="signed-out">
            <Link href="/waitlist">
              <button className="rounded-full bg-brand-blue px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue transition-all">
                Join Beta Waitlist
              </button>
            </Link>
          </Show>
          <Show when="signed-in">
            <Link 
              href="/dashboard"
              className="rounded-full bg-brand-blue px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue transition-all"
            >
              Go to Dashboard
            </Link>
          </Show>
          <Link 
            href="/setup"
            className="rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 transition-all"
          >
            Setup Guide
          </Link>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 sm:grid-cols-3 text-left">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-2">Off-The-Shelf Libraries</h3>
            <p className="text-sm text-gray-800">Agents can use the official Python and Node.js Google SDKs with zero code changes required.</p>
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
        <div className="mt-16 bg-brand-blue/5 border border-brand-blue/20 p-8 rounded-3xl text-left shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">How We Use Google Data</h2>
          <div className="space-y-4 text-gray-800">
            <p>
              FGAC.ai requires access to your Gmail account (via scopes like <code className="bg-brand-blue/10 px-1.5 py-0.5 rounded text-brand-blue text-sm">gmail.readonly</code>, <code className="bg-brand-blue/10 px-1.5 py-0.5 rounded text-brand-blue text-sm">gmail.send</code>, and <code className="bg-brand-blue/10 px-1.5 py-0.5 rounded text-brand-blue text-sm">gmail.modify</code>) to act as a secure proxy between your inbox and your AI agents.
            </p>
            <p>
              When your AI agent makes an API request, we strictly enforce your custom allowlists and blocklists before forwarding the exact request to the Google API. We never permanently store your email content, and your data is never used to train our AI models. No humans read your emails.
            </p>
            <p className="text-sm">
              Our use of information received from Google APIs will adhere to the <Link href="/privacy" className="underline text-brand-blue hover:text-brand-blue/80">Google API Services User Data Policy</Link>, including the <strong>Limited Use</strong> requirements.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
