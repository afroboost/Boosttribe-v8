import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track 
      data-slot="slider-track"
      className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-white/10"
    >
      <SliderPrimitive.Range 
        data-slot="slider-range"
        className="absolute h-full bg-gradient-to-r from-[#8A2EFF] to-[#FF2FB3]" 
      />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb 
      data-slot="slider-thumb"
      className="block h-3.5 w-3.5 rounded-full border border-white/20 bg-white shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#8A2EFF] disabled:pointer-events-none disabled:opacity-50" 
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
