import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-emerald-400 text-emerald-950 hover:bg-emerald-300",
        secondary: "bg-white/8 text-slate-100 hover:bg-white/13",
        outline: "border border-white/12 bg-transparent text-slate-100 hover:bg-white/7",
        ghost: "text-slate-300 hover:bg-white/7 hover:text-white",
        destructive: "bg-rose-500 text-white hover:bg-rose-400",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
