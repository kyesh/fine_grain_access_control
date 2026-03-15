import React from "react";
import Link from "next/link";
import { Copy, Terminal, Server, Key, Box, ChevronRight } from "lucide-react";

export const metadata = {
  title: "Setup & Integration | fgac.ai",
  description:
    "Learn how to configure your AI agents with fgac.ai to securely access Gmail.",
};

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 selection:bg-indigo-500/30 font-sans pb-24">
      {/* Premium Header */}
      <div className="relative border-b border-white/5 bg-black/40 backdrop-blur-xl overflow-hidden py-24">
        <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80">
          <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#ff80b5] to-[#9089fc] opacity-20 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"></div>
        </div>
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-6 animate-in slide-in-from-bottom-4 duration-700 ease-out">
            Connect Your Agents ⚡
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed animate-in slide-in-from-bottom-6 duration-700 delay-150 ease-out fill-mode-both">
            Give Claude, Open Claw, or custom Python scripts secure access to
            your inbox in minutes. Protect your credentials with fine-grained
            access control rules.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-6 lg:px-8 mt-16 space-y-24">
        {/* Step 1 & 2 Section */}
        <section className="space-y-12">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
              The Baseline
            </h2>
            <p className="text-slate-400">
              Complete these steps first to generate your proxy key.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6 relative">
            <div className="absolute top-1/2 left-1/2 -translate-y-1/2 -translate-x-1/2 hidden sm:block">
              <ChevronRight className="w-8 h-8 text-white/20" />
            </div>

            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl hover:bg-white/10 transition-colors duration-300 group">
              <div className="w-12 h-12 bg-indigo-500/10 rounded-2xl flex items-center justify-center mb-6 border border-indigo-500/20 group-hover:border-indigo-500/40 transition-colors">
                <Server className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3 flex items-center gap-3">
                <span className="bg-white/10 w-6 h-6 rounded-full inline-flex items-center justify-center text-sm">
                  1
                </span>
                Create Account
              </h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Sign up using the Google Workspace whose Gmail you want agents
                to access. We handle the OAuth token refresh securely behind the
                scenes.
              </p>
              <Link
                href="/sign-up"
                className="inline-flex items-center text-indigo-400 hover:text-indigo-300 font-medium transition-colors group-hover:underline decoration-indigo-400/30 underline-offset-4"
              >
                Go to Dashboard <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </div>

            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl hover:bg-white/10 transition-colors duration-300 group">
              <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6 border border-emerald-500/20 group-hover:border-emerald-500/40 transition-colors">
                <Key className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3 flex items-center gap-3">
                <span className="bg-white/10 w-6 h-6 rounded-full inline-flex items-center justify-center text-sm">
                  2
                </span>
                Generate Key
              </h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Create a new API Key in the dashboard. Select which email
                inboxes this key should have access to (including delegated
                accounts).
              </p>
              <div className="p-3 bg-black/50 border border-white/5 rounded-xl flex items-center justify-between font-mono text-xs text-emerald-400/70">
                <span className="truncate">sk_proxy_****************</span>
                <Copy className="w-4 h-4 opacity-50" />
              </div>
            </div>
          </div>
        </section>

        {/* Multiple Accounts Info */}
        <section className="bg-gradient-to-br from-indigo-900/20 via-purple-900/10 to-transparent border border-indigo-500/20 rounded-3xl p-8 sm:p-12 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2"></div>
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-indigo-500/20 rounded-xl">
                <Box className="w-6 h-6 text-indigo-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">
                Handling Multiple Email Accounts
              </h2>
            </div>
            <p className="text-slate-300 mb-6 leading-relaxed text-lg max-w-2xl">
              A single Proxy Key can grant access to multiple Gmail inboxes if
              the owner delegates access to you. You do not need multiple api
              keys to check different emails.
            </p>

            <div className="bg-black/40 border border-white/10 rounded-2xl p-6 mb-4">
              <h4 className="text-white font-medium mb-3">
                How to query delegated accounts:
              </h4>
              <p className="text-slate-400 mb-4 text-sm">
                Instead of using the &quot;me&quot; shorthand, specify the target email
                address directly in the API path.
              </p>

              <div className="space-y-4">
                <div className="bg-black/60 rounded-xl p-4 border border-white/5 font-mono text-sm">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wider">
                    Querying Your Own Inbox
                  </span>
                  <span className="text-emerald-400">GET</span>{" "}
                  <span className="text-slate-300">
                    https://fgac.ai/api/proxy/gmail/v1/users/me/messages
                  </span>
                </div>
                <div className="bg-black/60 rounded-xl p-4 border border-white/5 font-mono text-sm">
                  <span className="text-slate-500 block mb-1 text-xs uppercase tracking-wider">
                    Querying Delegated Inbox
                  </span>
                  <span className="text-emerald-400">GET</span>{" "}
                  <span className="text-white font-semibold">
                    https://fgac.ai/api/proxy/gmail/v1/users/
                    <span className="text-indigo-400">boss@company.com</span>
                    /messages
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Agent Setup Skills */}
        <section className="space-y-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-4">
              Configure Your Agents
            </h2>
            <p className="text-slate-400 max-w-xl mx-auto">
              We provide ready-to-use &quot;Skills&quot; tailored for popular AI agents.
              Just download and install into your agent&apos;s workspace.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {/* Claude Code */}
            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl flex flex-col items-start hover:bg-white/10 transition-all duration-300 group hover:-translate-y-1">
              <div className="w-12 h-12 bg-orange-500/10 rounded-2xl flex items-center justify-center mb-6 border border-orange-500/20">
                <Terminal className="w-6 h-6 text-orange-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Claude Code</h3>
              <p className="text-sm text-slate-400 mb-8 flex-grow">
                Install as a workspace skill. Instructs Claude on overriding API
                endpoints and headers effectively.
              </p>
              <div className="w-full space-y-3">
                <a
                  href="/skills/claude-code/SKILL.md"
                  target="_blank"
                  className="w-full block text-center py-2.5 bg-orange-500/10 text-orange-400 rounded-xl hover:bg-orange-500/20 font-medium transition-colors border border-orange-500/20"
                >
                  View SKILL.md
                </a>
                <p className="text-xs text-slate-500 text-center">
                  Save to `./.claude/skills/fgac/SKILL.md`
                </p>
              </div>
            </div>

            {/* Claude Cowork */}
            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl flex flex-col items-start hover:bg-white/10 transition-all duration-300 group hover:-translate-y-1">
              <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-6 border border-amber-500/20">
                <Terminal className="w-6 h-6 text-amber-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Claude Cowork
              </h3>
              <p className="text-sm text-slate-400 mb-8 flex-grow">
                Use this skill format in Claude&apos;s desktop interface to provide
                structured workflow instructions.
              </p>
              <div className="w-full space-y-3">
                <a
                  href="/skills/claude-cowork/SKILL.md"
                  target="_blank"
                  className="w-full block text-center py-2.5 bg-amber-500/10 text-amber-400 rounded-xl hover:bg-amber-500/20 font-medium transition-colors border border-amber-500/20"
                >
                  View SKILL.md
                </a>
                <p className="text-xs text-slate-500 text-center">
                  Load as instructions
                </p>
              </div>
            </div>

            {/* Open Claw */}
            <div className="bg-white/5 border border-white/10 p-8 rounded-3xl flex flex-col items-start hover:bg-white/10 transition-all duration-300 group hover:-translate-y-1">
              <div className="w-12 h-12 bg-cyan-500/10 rounded-2xl flex items-center justify-center mb-6 border border-cyan-500/20">
                <Terminal className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Open Claw</h3>
              <p className="text-sm text-slate-400 mb-8 flex-grow">
                A custom skill directory configuration for the open-source agent.
              </p>
              <div className="w-full space-y-3">
                <a
                  href="/skills/open-claw/SKILL.md"
                  target="_blank"
                  className="w-full block text-center py-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl hover:bg-cyan-500/20 font-medium transition-colors border border-cyan-500/20"
                >
                  View SKILL.md
                </a>
                <p className="text-xs text-slate-500 text-center">
                  Place in `skills/fgac/` folder
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
