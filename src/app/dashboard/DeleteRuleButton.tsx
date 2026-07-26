"use client";

import { useTransition } from "react";
import { deleteRule } from "./actions";

export function DeleteRuleButton({ id }: { id: string }) {
   const [isPending, startTransition] = useTransition();

   return (
       <button 
          onClick={() => startTransition(() => deleteRule(id))}
          disabled={isPending}
          className="text-[11px] font-semibold text-destructive hover:opacity-80 disabled:opacity-50 transition-opacity"
       >
          {isPending ? "..." : "Delete"}
       </button>
   );
}
