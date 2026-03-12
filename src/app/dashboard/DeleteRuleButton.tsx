"use client";

import { useTransition } from "react";
import { deleteRule } from "./actions";

export function DeleteRuleButton({ id }: { id: string }) {
   const [isPending, startTransition] = useTransition();

   return (
       <button 
          onClick={() => startTransition(() => deleteRule(id))}
          disabled={isPending}
          className="text-red-600 hover:text-red-900 text-sm font-medium disabled:opacity-50 transition-opacity"
       >
          {isPending ? "..." : "Delete"}
       </button>
   );
}
