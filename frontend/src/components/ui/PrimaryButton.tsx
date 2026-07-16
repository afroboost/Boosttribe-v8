import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { theme } from "@/context/ThemeContext";

const primaryButtonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-all duration-250 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        gradient: "text-white border-none",
        outline: "bg-transparent border border-white/10 text-white hover:border-white/20 hover:bg-white/5",
        ghost: "bg-transparent text-white/70 hover:text-white hover:bg-white/5",
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
    const isGradient = variant === "gradient" || !variant;
    const { colors } = theme;

    return (
      <button
        className={cn(primaryButtonVariants({ variant, size, className }))}
        ref={ref}
        style={
          isGradient
            ? {
                background: colors.gradient.primary,
                boxShadow: `0 4px 24px ${colors.gradient.glow}`,
              }
            : undefined
        }
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (isGradient) {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow =
              `0 8px 32px ${colors.gradient.glow}, 0 0 60px rgba(226, 74, 158, 0.25)`;
          } else {
            e.currentTarget.style.transform = "translateY(-2px)";
          }
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
          if (isGradient) {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = `0 4px 24px ${colors.gradient.glow}`;
          } else {
            e.currentTarget.style.transform = "translateY(0)";
          }
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
