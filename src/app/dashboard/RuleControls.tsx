"use client";

import { useState, useTransition } from "react";
import { applyRecommendedSecurityRules, createRule } from "./actions";

export function RuleControls() {
  const [isPending, startTransition] = useTransition();
  const [isModalOpen, setIsModalOpen] = useState(false);

  async function onSubmit(formData: FormData) {
     startTransition(async () => {
         await createRule(formData);
         setIsModalOpen(false);
         // The server action automatically revalidates the cache!
     });
  }

  return (
     <>
       <div className="flex gap-2">
         <button 
           onClick={() => startTransition(() => applyRecommendedSecurityRules())}
           disabled={isPending}
           className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50 transition-all border border-indigo-200">
           {isPending ? "Applying..." : "+ Quick Add 2FA Block"}
         </button>
         <button 
           onClick={() => setIsModalOpen(true)}
           className="bg-blue-600 text-white hover:bg-blue-500 px-4 py-2 text-sm font-medium rounded-md transition-all shadow-sm">
           Create Custom Rule
         </button>
       </div>

       {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-all">
             <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200 border border-slate-200">
                 <h3 className="text-xl font-bold text-slate-900 mb-1">Create Custom Rule</h3>
                 <p className="text-sm text-slate-800 mb-5">Define your fine-grained access regex pattern.</p>
                 
                 <form action={onSubmit} className="flex flex-col gap-5">
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-1.5">Rule Name</label>
                       <input type="text" name="ruleName" required className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm" placeholder="e.g. Block Project X" />
                     </div>
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-1.5">Service</label>
                       <select name="service" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm">
                          <option value="gmail">Gmail</option>
                          <option value="drive">Google Drive (Coming Soon)</option>
                          <option value="calendar">Calendar (Coming Soon)</option>
                       </select>
                     </div>
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action Type</label>
                       <select name="actionType" className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm">
                          <option value="read_blacklist">Read Blacklist (Inbound Regex)</option>
                          <option value="send_whitelist">Send Whitelist (Outbound To:)</option>
                          <option value="delete_whitelist">Delete Whitelist (From:)</option>
                       </select>
                     </div>
                     <div>
                       <label className="block text-sm font-semibold text-slate-700 mb-1.5">Regex Pattern</label>
                       <input type="text" name="regexPattern" required className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm" placeholder="e.g. *@competitor.com" />
                     </div>

                     <div className="mt-4 flex justify-end gap-3 pt-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 rounded-md transition-colors">Cancel</button>
                        <button type="submit" disabled={isPending} className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md disabled:opacity-50 shadow-sm transition-colors">
                           {isPending ? "Saving..." : "Save Rule"}
                        </button>
                     </div>
                 </form>
             </div>
          </div>
       )}
     </>
  );
}
