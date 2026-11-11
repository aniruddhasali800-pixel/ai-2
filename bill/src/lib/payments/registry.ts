import type { PaymentProviderAdapter } from './types';
import { upiDirectAdapter } from './upi-direct';

const adapters = new Map<string, PaymentProviderAdapter>();

export function registerPaymentProvider(adapter: PaymentProviderAdapter): void {
  adapters.set(adapter.id.toUpperCase(), adapter);
}

export function paymentProvider(id: string): PaymentProviderAdapter | null {
  return adapters.get(id.toUpperCase()) ?? null;
}

registerPaymentProvider(upiDirectAdapter);
