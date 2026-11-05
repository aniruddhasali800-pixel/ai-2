import type { NextFunction, Request, Response } from 'express';
import { webhooksAreAccepted } from '../config/env';

/**
 * Shuts a webhook route while this host still verifies with a value printed in this repository.
 *
 * A webhook has no login behind it: the HMAC signature is the whole authentication, so a signing key
 * that anybody can read out of the source means the route has no authentication at all. Answering 401
 * to every delivery would not help either — a gateway reads that as a broken endpoint and stops
 * sending real events. 503 says the door is shut on this host's configuration rather than on the
 * sender's credentials, and it is answered before a single body byte is parsed, so nothing untrusted
 * can reach a payment or an order while the key is a placeholder.
 */
export function rejectUntrustedWebhooks(kind: 'Payment' | 'Delivery') {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (webhooksAreAccepted) {
      next();
      return;
    }
    res.status(503).json({
      ok: false,
      message:
        `${kind} webhooks are disabled here: the webhook secret on this host is still a published default. ` +
        'Set a secret of its own for every provider in the hosting environment — the names of the ones ' +
        'missing are in the server log, and no value is ever printed there.',
    });
  };
}
