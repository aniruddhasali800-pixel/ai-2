/** Every phone comparison in the app goes through this: keep the digits, drop the formatting. */
export function phoneDigits(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '');
}

/** A usable mobile number for this app: nothing but digits, 8 to 15 of them. */
export function isUsablePhone(value?: string | null): boolean {
  const digits = phoneDigits(value);
  return digits.length >= 8 && digits.length <= 15;
}
