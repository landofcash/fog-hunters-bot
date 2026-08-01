import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
  {
    variants: {
      variant: {
        default: "border-emerald-300/20 bg-emerald-400/12 text-emerald-300",
        secondary: "border-white/10 bg-white/6 text-slate-300",
        warning: "border-amber-300/20 bg-amber-400/12 text-amber-200",
        destructive: "border-rose-300/20 bg-rose-400/12 text-rose-200",
        outline: "border-white/15 text-slate-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
