import { addActionToQueue, getQueue, removeActionFromQueue, updateQueueItem, saveContactToDB, getContactsFromDB } from '../storage/db';
import { createZohoLead } from '../services/zohoApi';
import { searchZohoDuplicate } from '../services/zohoSearchService';

const MAX_RETRIES = 3;

// Simulate sending a WhatsApp message
export const simulateSendWhatsApp = async (contact) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 90% success rate to simulate reality
      if (Math.random() > 0.1) resolve({ status: 'sent' });
      else reject(new Error('WhatsApp network failure'));
    }, 1500);
  });
};

// Simulate sending an Email
export const simulateSendEmail = async (contact) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.1) resolve({ status: 'sent' });
      else reject(new Error('Email server network failure'));
    }, 1200);
  });
};

// Simulate syncing to Zoho CRM
export const simulateSyncZoho = async (contact) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (Math.random() > 0.1) resolve({ status: 'synced' });
      else reject(new Error('Zoho CRM sync connection failure'));
    }, 1000);
  });
};

let isProcessing = false;

export const enqueueAction = async (actionType, payload) => {
  const queue = await getQueue();
  const exists = queue.some(item => 
    item.type === actionType && 
    (item.contactId === payload.contactId || item.payload?.contactId === payload.contactId)
  );
  if (!exists) {
    if (actionType === 'SYNC_ZOHO') {
      const queueItem = {
        type: 'SYNC_ZOHO',
        createdAt: new Date().toISOString(),
        contactId: payload.contactId,
        contact: {
          name: payload.contactData?.name || '',
          company: payload.contactData?.company || '',
          email: payload.contactData?.email || '',
          phone: payload.contactData?.phone || ''
        },
        status: 'pending',
        retryCount: 0
      };
      await addActionToQueue(queueItem);
      console.log('✓ SYNC_ZOHO Queued', queueItem);
    } else {
      await addActionToQueue({ type: actionType, payload });
    }
  }
};

/**
 * Process the offline queue when connection is restored.
 * @param {Function} onQueueProcessed - Called after all items are processed with the updated contacts list.
 * @param {Function} onSyncResult - Called per SYNC_ZOHO item with (contact, status) where status is 'synced' | 'duplicate' | 'failed'.
 */
export const processQueue = async (onQueueProcessed, onSyncResult) => {
  if (isProcessing) return;
  if (!navigator.onLine) return;
  
  isProcessing = true;
  console.log('✓ Queue Processing Started');
  
  try {
    let queue = await getQueue();
    if (queue.length === 0) {
      console.log('✓ Queue Processing Complete');
      return;
    }

    console.log('✓ Pending Items Found', queue.length);

    const contacts = await getContactsFromDB();
    const contactsMap = new Map(contacts.map(c => [c.id, c]));
    const processedIds = new Set();

    while (queue.length > 0) {
      // Filter out items we've already tried in this run to avoid infinite loops on failures
      const pendingItems = queue.filter(item => !processedIds.has(item.id));
      if (pendingItems.length === 0) break;

      for (const item of pendingItems) {
        processedIds.add(item.id);
        
        // For SYNC_ZOHO: skip items that are completed, failed (max retries), or deleted
        if (item.type === 'SYNC_ZOHO') {
          if (item.status === 'completed') {
            continue;
          }
          if (item.status === 'failed' && (item.retryCount || 0) >= MAX_RETRIES) {
            continue;
          }
        }

        const { type, payload } = item;
        const contactId = payload?.contactId || item.contactId;
        let contact = contactsMap.get(contactId);
        
        if (!contact) {
          // If the contact was deleted, remove it from queue
          await removeActionFromQueue(item.id);
          continue;
        }

        try {
          if (type === 'SEND_WHATSAPP') {
            contact = { ...contact, whatsappStatus: 'sending' };
            contactsMap.set(contact.id, contact);
            await saveContactToDB(contact);

            await simulateSendWhatsApp(contact);
            
            contact = { ...contact, whatsappStatus: 'sent' };
            contactsMap.set(contact.id, contact);
            await saveContactToDB(contact);
            await removeActionFromQueue(item.id);
          } else if (type === 'SEND_EMAIL') {
            contact = { ...contact, emailStatus: 'sending' };
            contactsMap.set(contact.id, contact);
            await saveContactToDB(contact);

            await simulateSendEmail(contact);
            
            contact = { ...contact, emailStatus: 'sent' };
            contactsMap.set(contact.id, contact);
            await saveContactToDB(contact);
            await removeActionFromQueue(item.id);
          } else if (type === 'SYNC_ZOHO') {
            if (contact.zohoLeadId) {
              console.log('✓ Zoho Lead ID already exists, skipping lead creation');
              contact = { 
                ...contact, 
                zohoStatus: 'synced', 
                syncStatus: 'synced', 
                syncedToZoho: true,
                lastSyncAt: contact.lastSyncAt || new Date().toISOString()
              };
              contactsMap.set(contact.id, contact);
              await saveContactToDB(contact);
              await removeActionFromQueue(item.id);
              if (onSyncResult) {
                onSyncResult(contact, 'synced');
              }
              continue;
            }

            contact = { ...contact, zohoStatus: 'sending', syncStatus: 'pending' };
            contactsMap.set(contact.id, contact);
            await saveContactToDB(contact);

            // Duplicate detection check before creating lead
            const duplicateCheck = await searchZohoDuplicate(contact);
            if (duplicateCheck.duplicate && duplicateCheck.lead) {
              console.log('✓ Duplicate detected in Zoho CRM, skipping lead creation');
              contact = { 
                ...contact, 
                zohoStatus: 'synced', 
                syncStatus: 'synced', 
                zohoLeadId: duplicateCheck.lead.id,
                syncedToZoho: true,
                duplicateDetected: true,
                lastSyncAt: new Date().toISOString()
              };
              console.log('✓ Contact Updated');
              contactsMap.set(contact.id, contact);
              await saveContactToDB(contact);
              await removeActionFromQueue(item.id);
              console.log('✓ Queue Item Removed');
              if (onSyncResult) {
                onSyncResult(contact, 'duplicate');
              }
            } else {
              console.log('✓ Duplicate Check Passed');
              // Call Lead Creation API
              const res = await createZohoLead(contact);
              console.log('✓ Zoho Lead Created');
              console.log('✓ Lead ID Extracted');
              
              contact = { 
                ...contact, 
                zohoStatus: 'synced', 
                syncStatus: 'synced', 
                zohoLeadId: res.zohoLeadId,
                syncedToZoho: true,
                lastSyncAt: new Date().toISOString()
              };
              console.log('✓ Contact Updated');
              console.log('✓ Zoho Lead ID Stored');
              
              contactsMap.set(contact.id, contact);
              await saveContactToDB(contact);
              await removeActionFromQueue(item.id);
              console.log('✓ Queue Item Removed');
              if (onSyncResult) {
                onSyncResult(contact, 'synced');
              }
            }
          }
        } catch (err) {
          console.error(`Failed to process queued action ${type}:`, err);
          // Update status to failed so the user knows it failed and can manually retry
          if (type === 'SEND_WHATSAPP') {
            contact = { ...contact, whatsappStatus: 'failed' };
          } else if (type === 'SEND_EMAIL') {
            contact = { ...contact, emailStatus: 'failed' };
          } else if (type === 'SYNC_ZOHO') {
            contact = { ...contact, zohoStatus: 'failed' };
            
            // Increment retry count
            const newRetryCount = (item.retryCount || 0) + 1;
            item.retryCount = newRetryCount;
            item.status = newRetryCount >= MAX_RETRIES ? 'failed' : 'pending';
            await updateQueueItem(item);
            
            if (onSyncResult) {
              onSyncResult(contact, 'failed');
            }
          }
          contactsMap.set(contact.id, contact);
          await saveContactToDB(contact);
        }
      }

      // Re-read queue list to check for updates
      queue = await getQueue();
      // If all remaining items in queue are already in processedIds, stop loop
      const remainingUnprocessed = queue.filter(item => !processedIds.has(item.id));
      if (remainingUnprocessed.length === 0) break;
    }

    if (onQueueProcessed) {
      onQueueProcessed(Array.from(contactsMap.values()));
    }
  } finally {
    isProcessing = false;
    console.log('✓ Queue Processing Complete');
  }
};
