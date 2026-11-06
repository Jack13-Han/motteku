import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-lg border-0 px-4 py-2.5 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500', {
  variants: { variant: { default: 'bg-violet-600 text-white hover:bg-violet-700', outline: 'border border-violet-200 bg-white text-violet-700 hover:bg-violet-50', destructive: 'bg-red-600 text-white hover:bg-red-700' } },
  defaultVariants: { variant: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, asChild = false, type = 'button', ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, className }))} ref={ref} {...(!asChild ? { type } : {})} {...props} />;
});
Button.displayName = 'Button';
export { Button, buttonVariants };
