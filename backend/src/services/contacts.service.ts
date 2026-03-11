// Contacts Service - Omnichannel contact management
// Contacts are automatically created when someone talks to an agent.
// Supports cross-channel merge via phone number or identifier.

import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database.js';

export interface Contact {
  _id?: ObjectId;
  organizationId: string;
  name?: string;
  channels: {
    type: string; // whatsapp, telegram, discord, etc.
    userId: string; // channel-specific user ID
  }[];
  tags: string[];
  notes: string;
  conversationCount: number;
  lastConversationAt?: Date;
  lastChannel?: string;
  firstSeenAt: Date;
  updatedAt: Date;
}

export class ContactsService {
  private get collection() {
    return getDatabase().collection<Contact>('contacts');
  }

  /**
   * Find or create a contact for a channel user.
   * Called automatically when a new conversation starts.
   */
  async findOrCreate(
    organizationId: string,
    channelType: string,
    channelUserId: string,
    displayName?: string
  ): Promise<Contact> {
    // Try to find existing contact by channel identity
    const existing = await this.collection.findOne({
      organizationId,
      'channels.type': channelType,
      'channels.userId': channelUserId,
    });

    if (existing) {
      // Update last seen
      await this.collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            lastConversationAt: new Date(),
            lastChannel: channelType,
            updatedAt: new Date(),
            ...(displayName && !existing.name ? { name: displayName } : {}),
          },
          $inc: { conversationCount: 1 },
        }
      );
      return existing as unknown as Contact;
    }

    // Create new contact
    const contact: Contact = {
      organizationId,
      name: displayName || undefined,
      channels: [{ type: channelType, userId: channelUserId }],
      tags: [],
      notes: '',
      conversationCount: 1,
      lastConversationAt: new Date(),
      lastChannel: channelType,
      firstSeenAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.collection.insertOne(contact as any);
    contact._id = result.insertedId as any;
    return contact;
  }

  /**
   * List contacts for an organization with search and filter.
   */
  async listContacts(
    organizationId: string,
    options?: {
      search?: string;
      tag?: string;
      channel?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<{ contacts: Contact[]; total: number }> {
    const query: any = { organizationId };

    if (options?.search) {
      query.$or = [
        { name: { $regex: options.search, $options: 'i' } },
        { 'channels.userId': { $regex: options.search, $options: 'i' } },
        { notes: { $regex: options.search, $options: 'i' } },
      ];
    }

    if (options?.tag) {
      query.tags = options.tag;
    }

    if (options?.channel) {
      query['channels.type'] = options.channel;
    }

    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const [contacts, total] = await Promise.all([
      this.collection
        .find(query)
        .sort({ lastConversationAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments(query),
    ]);

    return { contacts: contacts as unknown as Contact[], total };
  }

  /**
   * Get a single contact by ID.
   */
  async getContact(contactId: string, organizationId: string): Promise<Contact | null> {
    return this.collection.findOne({
      _id: new ObjectId(contactId) as any,
      organizationId,
    }) as unknown as Contact | null;
  }

  /**
   * Update a contact (name, tags, notes).
   */
  async updateContact(
    contactId: string,
    organizationId: string,
    updates: { name?: string; tags?: string[]; notes?: string }
  ): Promise<Contact | null> {
    const result = await this.collection.findOneAndUpdate(
      { _id: new ObjectId(contactId) as any, organizationId },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    return result as unknown as Contact | null;
  }

  /**
   * Merge two contacts (cross-channel dedup).
   * Moves all channels from source to target and deletes source.
   */
  async mergeContacts(
    targetId: string,
    sourceId: string,
    organizationId: string
  ): Promise<Contact | null> {
    const [target, source] = await Promise.all([
      this.getContact(targetId, organizationId),
      this.getContact(sourceId, organizationId),
    ]);

    if (!target || !source) {
      throw new Error('One or both contacts not found');
    }

    // Merge channels, tags, notes, conversation count
    const mergedChannels = [...target.channels, ...source.channels];
    const mergedTags = Array.from(new Set([...target.tags, ...source.tags]));
    const mergedNotes = [target.notes, source.notes].filter(Boolean).join('\n---\n');

    await this.collection.updateOne(
      { _id: new ObjectId(targetId) as any },
      {
        $set: {
          channels: mergedChannels,
          tags: mergedTags,
          notes: mergedNotes,
          conversationCount: target.conversationCount + source.conversationCount,
          updatedAt: new Date(),
        },
      }
    );

    // Delete source
    await this.collection.deleteOne({ _id: new ObjectId(sourceId) as any });

    return this.getContact(targetId, organizationId);
  }

  /**
   * Delete a contact.
   */
  async deleteContact(contactId: string, organizationId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({
      _id: new ObjectId(contactId) as any,
      organizationId,
    });
    return result.deletedCount > 0;
  }
}

export const contactsService = new ContactsService();
