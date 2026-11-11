import type { PaymentStatus } from './status';

export interface ProviderIntent {
  upiUri: string;
  qrDataUrl: string;
  payeeVpaMasked: string;
  payeeName: string;
  amountPaise: number;
}

/**
 * The order flow only knows this interface. A gateway that can confirm money moving
 * (Razorpay, Cashfree) is added by implementing it with `canSettle = true` and a real
 * `queryStatus`, then registering it — nothing in the state machine changes.
 */
export interface PaymentProviderAdapter {
  readonly id: string;
  readonly label: string;
  /** false => this provider can never produce PAID on its own word. */
  readonly canSettle: boolean;
  create(params: {
    amountPaise: number;
    vpa: string;
    payeeName: string;
    note: string;
    transactionRef: string;
  }): Promise<ProviderIntent>;
  queryStatus?(transactionRef: string): Promise<PaymentStatus | null>;
}
