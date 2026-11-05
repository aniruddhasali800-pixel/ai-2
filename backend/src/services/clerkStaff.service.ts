import { createClerkClient } from '@clerk/backend';
import { env } from '../config/env';

/**
 * Initializes Clerk Backend SDK using the secret key from environment variables.
 */
function getClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY || env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  return createClerkClient({ secretKey });
}

export interface ClerkStaffResult {
  clerkUserId?: string | null;
  invitationId?: string | null;
  status: 'ACTIVE' | 'PENDING';
  message: string;
}

/**
 * Ensures a staff email exists in Clerk:
 * 1. If user already exists in Clerk, links their clerkUserId and updates role metadata.
 * 2. If user does not exist, sends an official Clerk invitation and provisions the identity for passwordless email login.
 */
export async function syncOrInviteClerkStaff(input: {
  email: string;
  name: string;
  role: string;
  restaurantId: string;
  redirectUrl?: string;
}): Promise<ClerkStaffResult> {
  const cleanEmail = input.email.trim().toLowerCase();
  const clerk = getClerkClient();

  if (!clerk) {
    console.warn(
      `[clerk] CLERK_SECRET_KEY is not set in backend/.env. Simulated Clerk invitation for ${cleanEmail}. Add CLERK_SECRET_KEY to send real Clerk invitations.`,
    );
    return {
      clerkUserId: null,
      invitationId: null,
      status: 'PENDING',
      message: 'Staff saved. Add CLERK_SECRET_KEY in backend/.env to connect to live Clerk API.',
    };
  }

  try {
    // 1. Check if user already exists in Clerk
    const userList = await clerk.users.getUserList({ emailAddress: [cleanEmail] });
    const existingUser = (userList as any)?.data?.[0] || (Array.isArray(userList) ? userList[0] : null);

    if (existingUser) {
      console.log(`[clerk] Found existing Clerk user for ${cleanEmail} (ID: ${existingUser.id})`);
      // Update metadata with restaurant role
      try {
        await clerk.users.updateUserMetadata(existingUser.id, {
          publicMetadata: {
            restaurantId: input.restaurantId,
            role: input.role,
          },
        });
      } catch (metaErr) {
        console.warn('[clerk] Could not update user metadata:', metaErr);
      }

      return {
        clerkUserId: existingUser.id,
        invitationId: null,
        status: 'ACTIVE',
        message: 'Existing Clerk account found and linked.',
      };
    }

    // 2. User does not exist in Clerk yet.
    // Send official Clerk invitation so employee receives an onboarding email.
    let invitationId: string | null = null;
    const redirectUrl = input.redirectUrl || `${env.PUBLIC_BASE_URL}/login`;

    try {
      const invitation = await clerk.invitations.createInvitation({
        emailAddress: cleanEmail,
        redirectUrl,
        publicMetadata: {
          restaurantId: input.restaurantId,
          role: input.role,
        },
        notify: true,
      });
      invitationId = invitation.id;
      console.log(`[clerk] Created Clerk invitation for ${cleanEmail} (Invite ID: ${invitation.id})`);
    } catch (inviteErr: any) {
      // If invitation already exists or invitations not enabled, log and continue
      console.warn(`[clerk] Invitation call warning for ${cleanEmail}:`, inviteErr?.message || inviteErr);
    }

    // 3. Provision the Clerk user identity with passwordless email OTP capability
    try {
      const nameParts = input.name.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Staff';
      const lastName = nameParts.slice(1).join(' ') || undefined;

      const newUser = await clerk.users.createUser({
        emailAddress: [cleanEmail],
        firstName,
        lastName,
        skipPasswordRequirement: true,
        publicMetadata: {
          restaurantId: input.restaurantId,
          role: input.role,
        },
      });

      console.log(`[clerk] Created Clerk user for ${cleanEmail} (ID: ${newUser.id})`);
      return {
        clerkUserId: newUser.id,
        invitationId,
        status: 'ACTIVE',
        message: 'Created Clerk user account with passwordless email login.',
      };
    } catch (createErr: any) {
      // If createUser failed because of invites-only setting, fallback to pending invitation
      console.log(`[clerk] createUser deferred to invitation flow for ${cleanEmail}:`, createErr?.message || createErr);
      return {
        clerkUserId: null,
        invitationId,
        status: 'PENDING',
        message: 'Clerk invitation sent to employee email.',
      };
    }
  } catch (err: any) {
    console.error(`[clerk] Error syncing ${cleanEmail} with Clerk API:`, err);
    return {
      clerkUserId: null,
      invitationId: null,
      status: 'PENDING',
      message: `Clerk API error: ${err?.message || 'Could not reach Clerk'}`,
    };
  }
}
