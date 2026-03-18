import {
  ClerkProvider,
  SignUpButton,
  Show,
  UserButton
} from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';
import { PostHogProviderWrapper } from './providers';
import SuspendedPostHogPageView from './PostHogPageView';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FGAC.ai | Fine Grain Access Control for AI',
  description: 'Fine Grain Access Control proxy for AI Agents using Google APIs.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className={`${inter.className} h-full`}>
        <ClerkProvider>
          <div className="min-h-full">
            <nav className="border-b border-gray-200 bg-white">
              <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 justify-between">
                  <div className="flex">
                      <div className="flex flex-shrink-0 items-center">
                        <Link href="/" className="flex items-center space-x-3">
                          <img src="/logo-v2.png" alt="FGAC.ai Logo" className="h-12 w-auto" />
                          <div className="flex flex-col">
                            <span className="text-xl font-bold tracking-tight text-brand-purple leading-none">FGAC.ai</span>
                            <span className="text-xs font-semibold text-brand-teal leading-tight mt-1">Fine Grain Access Control</span>
                          </div>
                        </Link>
                      </div>
                    <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                      <Link
                        href="/setup"
                        className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-800 hover:border-brand-purple hover:text-brand-purple"
                      >
                        Setup Guide
                      </Link>
                    </div>
                    <Show when="signed-in">
                      <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                        <Link
                          href="/dashboard"
                          className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-800 hover:border-brand-purple hover:text-brand-purple"
                        >
                          Dashboard
                        </Link>
                      </div>
                    </Show>
                  </div>
                  <div className="flex items-center">
                    <Show when="signed-out">
                      <SignUpButton mode="modal">
                        <button className="text-sm font-medium text-gray-800 hover:text-brand-purple">Sign Up</button>
                      </SignUpButton>
                    </Show>
                    <Show when="signed-in">
                      <UserButton />
                    </Show>
                  </div>
                </div>
              </div>
            </nav>
            <main>
              <PostHogProviderWrapper>
                <SuspendedPostHogPageView />
                {children}
              </PostHogProviderWrapper>
            </main>
            <footer className="bg-white border-t border-gray-200 mt-auto">
              <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 flex flex-col sm:flex-row justify-between items-center text-sm text-gray-500 gap-4 sm:gap-0">
                <p>&copy; {new Date().getFullYear()} FGAC.ai. All rights reserved.</p>
                <div className="flex space-x-8">
                  <Link href="/privacy" className="hover:text-gray-900 border-b border-transparent hover:border-gray-400">Privacy Policy</Link>
                  <Link href="/terms" className="hover:text-gray-900 border-b border-transparent hover:border-gray-400">Terms of Service</Link>
                </div>
              </div>
            </footer>
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
