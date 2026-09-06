import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind class merge helper used by every component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}
