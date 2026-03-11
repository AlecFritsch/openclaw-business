/**
 * Superchat webhook and API types.
 * Aligned with developers.superchat.com/reference/webhook-payload-model
 */

/** Webhook event types per developers.superchat.com/reference/createwebhook */
export type SuperchatWebhookEvent =
  | 'message_inbound'
  | 'message_outbound'
  | 'message_failed'
  | 'contact_created'
  | 'contact_updated'
  | 'note_created'
  | 'conversation_done'
  | 'conversation_opened'
  | 'conversation_snoozed';

/** Generic webhook payload for flexibility with other events */
export interface SuperchatWebhookPayload {
  id?: string;
  event?: SuperchatWebhookEvent | string;
  conversation?: { id?: string; [key: string]: unknown };
  message?: {
    id?: string;
    content?: { type?: string; body?: string; [key: string]: unknown };
    conversation_id?: string;
    from?: { id?: string; identifier?: string; [key: string]: unknown };
    to?: { channel_id?: string } | Array<{ id?: string; identifier?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
