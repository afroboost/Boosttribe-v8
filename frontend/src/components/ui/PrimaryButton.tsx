import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { theme } from "@/context/ThemeContext";

const primaryButtonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7A5CFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // "gradient" = CTA d'accent PLEIN (sobre) — le vrai dégradé est réservé à "hero"
        gradient: "text-white border-none",
        hero: "text-white border-none",
        outline: "bg-transparent border border-white/10 text-white hover:border-white/20 hover:bg-white/5",
        ghost: "bg-transparent text-white/70 hover:text-white hover:bg-white/[0.06]",
      },
      size: {
        sm: "h-9 px-4 text-sm rounded-full",
        md: "h-11 px-6 text-base rounded-full",
        lg: "h-14 px-8 text-lg rounded-full",
      },
    },
    defaultVariants: {
      variant: "gradient",
      size: "md",
    },
  }
);

export interface PrimaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof primaryButtonVariants> {
  asChild?: boolean;
}

const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => {
    const isHero = variant === "hero";
    // "gradient" (défaut) et "hero" ont un fond porté ; outline/ghost non.
    const isFilled = isHero || variant === "gradient" || !variant;
    const { colors } = theme;

    // Accent plein sobre par défaut ; dégradé réservé au moment fort (hero).
    const restShadow = isHero
      ? `0 8px 28px rgba(122, 92, 255, 0.18)`
      : `0 6px 20px rgba(122, 92, 255, 0.14)`;
    const hoverShadow = isHero
      ? `0 12px 40px rgba(122, 92, 255, 0.22)`
      : `0 8px 26px rgba(122, 92, 255, 0.18)`;

    return (
      <button
        className={cn(primaryButtonVariants({ variant, size, className }))}
        ref={ref}
        style={
          isFilled
            ? {
                background: isHero ? colors.gradient.primary : colors.primary,
                boxShadow: restShadow,
              }
            : undefined
        }
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.currentTarget.style.transform = "translateY(-1px)";
          if (isFilled) e.currentTarget.style.boxShadow = hoverShadow;
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.currentTarget.style.transform = "translateY(0)";
          if (isFilled) e.currentTarget.style.boxShadow = restShadow;
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

PrimaryButton.displayName = "PrimaryButton";

export { PrimaryButton, primaryButtonVariants };
