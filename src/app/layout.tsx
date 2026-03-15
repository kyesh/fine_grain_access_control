import {
  ClerkProvider,
  SignInButton,
  Show,
  UserButton
} from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Link from 'next/link';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FGAC.ai | Fine Grain Access Control for AI',
  description: 'Fine-grained access control proxy for AI Agents using Google APIs.',
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
                      <Link href="/" className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
                        FGAC.ai
                      </Link>
                    </div>
                    <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                      <Link
                        href="/setup"
                        className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-800 hover:border-gray-400 hover:text-gray-900"
                      >
                        Setup Guide
                      </Link>
                    </div>
                    <Show when="signed-in">
                      <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                        <Link
                          href="/dashboard"
                          className="inline-flex items-center border-b-2 border-transparent px-1 pt-1 text-sm font-medium text-gray-800 hover:border-gray-400 hover:text-gray-900"
                        >
                          Dashboard
                        </Link>
                      </div>
                    </Show>
                  </div>
                  <div className="flex items-center">
                    <Show when="signed-out">
                      <SignInButton mode="modal">
                        <button className="text-sm font-medium text-gray-800 hover:text-gray-900">Sign In</button>
                      </SignInButton>
                    </Show>
                    <Show when="signed-in">
                      <UserButton />
                    </Show>
                  </div>
                </div>
              </div>
            </nav>
            <main>
              {children}
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
