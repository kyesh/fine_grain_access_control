"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function WaitlistPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [email, setEmail] = useState("");
  const [numAccounts, setNumAccounts] = useState("");
  const [priceTooCheap, setPriceTooCheap] = useState("");
  const [priceBargain, setPriceBargain] = useState("");
  const [priceExpensive, setPriceExpensive] = useState("");
  const [priceTooExpensive, setPriceTooExpensive] = useState("");
  const [pricingModelPreference, setPricingModelPreference] = useState("");
  const [wantsBeta, setWantsBeta] = useState<boolean | null>(null);
  const [agreedToInterview, setAgreedToInterview] = useState(false);
  const [agreedToBetaPricing, setAgreedToBetaPricing] = useState(false);

  // Auto-save logic
  const saveProgress = async (currentStatus: "partial" | "completed" = "partial") => {
    setIsSubmitting(true);
    try {
      const payload = {
        id: submissionId,
        email,
        numAccounts,
        priceTooCheap,
        priceBargain,
        priceExpensive,
        priceTooExpensive,
        pricingModelPreference,
        wantsBeta: wantsBeta !== null ? wantsBeta.toString() : undefined,
        agreedToInterview: agreedToInterview.toString(),
        agreedToBetaPricing: agreedToBetaPricing.toString(),
        status: currentStatus,
      };

      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.id && !submissionId) {
        setSubmissionId(data.id);
      }
    } catch (e) {
      console.error("Auto-save failed", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNext = async () => {
    if (step === 1 && !email) return;
    if (step === 2 && !numAccounts) return;
    if (step === 3 && (!priceTooCheap || !priceBargain || !priceExpensive || !priceTooExpensive || !pricingModelPreference)) return;
    
    await saveProgress("partial");
    setStep(step + 1);
  };

  const handleSubmit = async () => {
    if (wantsBeta) {
      if (!agreedToInterview || !agreedToBetaPricing) {
        alert("Please agree to the beta requirements before submitting.");
        return;
      }
    } else if (wantsBeta === null) {
      alert("Please select whether you want to join the waitlist or the active beta group.");
      return;
    }

    await saveProgress("completed");
    setStep(5); // Success state
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-xl w-full bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-6 text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
          Join Early Access
        </h1>

        {/* Step 1: Email */}
        {step === 1 && (
          <div className="space-y-6">
            <p className="text-gray-700 text-center">We are currently restricting access while pending Google API Verification. Join the waitlist to be notified.</p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button 
              onClick={handleNext}
              disabled={!email || isSubmitting}
              className="w-full rounded-full bg-blue-600 px-8 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
            >
              Continue &rarr;
            </button>
          </div>
        )}

        {/* Step 2: Accounts */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">How many Google Workspace or Gmail accounts do you plan to connect with AI Agents?</label>
              <input 
                type="number" 
                min="1"
                value={numAccounts}
                onChange={(e) => setNumAccounts(e.target.value)}
                placeholder="e.g. 1"
                className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setStep(1)}
                className="flex-1 rounded-full bg-white py-3.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                Back
              </button>
              <button 
                onClick={handleNext}
                disabled={!numAccounts || isSubmitting}
                className="flex-1 rounded-full bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
              >
                Continue &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Pricing Survey */}
        {step === 3 && (
          <div className="space-y-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">Pricing Feedback</h3>
              <p className="text-sm text-gray-600 mb-6">To help us build a sustainable business model, please share your thoughts on our future pricing.</p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">At what price (per month) would you consider this so cheap that you would doubt its quality and security?</label>
                  <input type="number" value={priceTooCheap} onChange={e => setPriceTooCheap(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2" placeholder="$" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">At what price (per month) would you consider this a bargain or great buy for the money?</label>
                  <input type="number" value={priceBargain} onChange={e => setPriceBargain(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2" placeholder="$" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">At what price (per month) would this start to get expensive, but you'd still consider buying it?</label>
                  <input type="number" value={priceExpensive} onChange={e => setPriceExpensive(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2" placeholder="$" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">At what price (per month) would it be too expensive to consider?</label>
                  <input type="number" value={priceTooExpensive} onChange={e => setPriceTooExpensive(e.target.value)} className="w-full rounded-lg border border-gray-300 px-4 py-2" placeholder="$" />
                </div>
                
                <div className="pt-4 border-t border-gray-100">
                  <label className="block text-sm font-bold text-gray-900 mb-3">Which pricing model do you prefer?</label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-blue-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="pricingModel" value="Seat-based" checked={pricingModelPreference === "Seat-based"} onChange={e => setPricingModelPreference(e.target.value)} className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-800">Flat Seat-Based Subscription (per connected Gmail account)</span>
                    </label>
                    <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-blue-50 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="pricingModel" value="Usage-based" checked={pricingModelPreference === "Usage-based"} onChange={e => setPricingModelPreference(e.target.value)} className="w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-800">Usage-Based Cost (per API call made by your agent)</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button onClick={() => setStep(2)} className="flex-1 rounded-full bg-white py-3.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Back</button>
              <button 
                onClick={handleNext}
                disabled={!priceTooCheap || !priceBargain || !priceExpensive || !priceTooExpensive || !pricingModelPreference || isSubmitting}
                className="flex-1 rounded-full bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
              >
                Continue &rarr;
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Beta Group vs Waitlist */}
        {step === 4 && (
          <div className="space-y-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Final Step: Beta Access</h3>
            <p className="text-sm text-gray-600 mb-6">We are looking for power users to help shape the product during our verification phase.</p>

            <div className="space-y-3">
              <div 
                onClick={() => setWantsBeta(false)}
                className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${wantsBeta === false ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <h4 className="font-bold text-gray-900">Join Waitlist Only</h4>
                <p className="text-sm text-gray-600">I just want to be notified when FGAC.ai is public and verified by Google.</p>
              </div>

              <div 
                onClick={() => setWantsBeta(true)}
                className={`p-4 border-2 rounded-xl cursor-pointer transition-all ${wantsBeta === true ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="font-bold text-blue-900">Join the Active Beta Group</h4>
                  <span className="bg-blue-600 text-white text-[10px] uppercase font-bold px-2 py-0.5 rounded">Exclusive</span>
                </div>
                <p className="text-sm text-gray-700 mb-4">Get immediate access today, bypass the waitlist, and help us test the platform.</p>
                
                {wantsBeta === true && (
                  <div className="space-y-3 bg-white p-4 rounded-lg border border-blue-200 mt-4" onClick={e => e.stopPropagation()}>
                    <p className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-2">Beta Requirements</p>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" checked={agreedToInterview} onChange={e => setAgreedToInterview(e.target.checked)} className="mt-1 w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-800">I agree to participate in a 30-minute user feedback interview with the founders.</span>
                    </label>
                    <label className="flex items-start gap-3">
                      <input type="checkbox" checked={agreedToBetaPricing} onChange={e => setAgreedToBetaPricing(e.target.checked)} className="mt-1 w-4 h-4 text-blue-600" />
                      <span className="text-sm text-gray-800">I agree to the beta pricing of $5/month per connected Gmail account.</span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button onClick={() => setStep(3)} className="w-[100px] rounded-full bg-white py-3.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50">Back</button>
              <button 
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 rounded-full bg-blue-600 py-3.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Submit Application'}
              </button>
            </div>
          </div>
        )}

        {/* Step 5: Success */}
        {step === 5 && (
          <div className="text-center py-8 space-y-6">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">You're on the list!</h2>
            <p className="text-gray-600">
              {wantsBeta 
                ? "Thank you for applying to the Active Beta. We will be reaching out to the email you provided shortly with your onboarding details and interview scheduling link." 
                : "Thank you for joining our waitlist! We will notify you as soon as we officially launch and complete our Google security verification."}
            </p>
            <div className="pt-8">
              <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
                &larr; Return Home
              </Link>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
