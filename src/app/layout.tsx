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
  title: 'Agent Security Proxy',
  description: 'Fine-grained access control for AI Agents using Google APIs.',
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
                        SecureAgent
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
          </div>
        </ClerkProvider>
      </body>
    </html>
  );
}
