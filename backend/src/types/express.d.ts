import type { Role } from './constants';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        restaurantId: string;
        role: Role;
        name: string;
      };
    }
  }
}

export {};
