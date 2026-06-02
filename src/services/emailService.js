/**
 * EmailJS Email Service
 * Reusable service for sending emails via EmailJS.
 *
 * Required Vite environment variables:
 *   VITE_EMAILJS_SERVICE_ID
 *   VITE_EMAILJS_TEMPLATE_ID
 *   VITE_EMAILJS_PUBLIC_KEY
 */

import emailjs from '@emailjs/browser';

const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID;
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

/**
 * Sends an email using EmailJS.
 *
 * @param {Object} contact  - Contact object with at least { name, email }.
 * @param {string} message  - The message body to include in the email.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export const sendEmail = async (contact, message) => {
  console.log('✓ Email Send Started');

  // ── Validate recipient email ──
  if (!contact?.email || typeof contact.email !== 'string' || contact.email.trim().length === 0) {
    const error = 'Cannot send email: recipient email is missing.';
    console.error('✓ Email Send Failed:', error);
    return { success: false, error };
  }

  // ── Validate EmailJS configuration ──
  if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
    const error = 'EmailJS is not configured. Check VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID, and VITE_EMAILJS_PUBLIC_KEY.';
    console.error('✓ Email Send Failed:', error);
    return { success: false, error };
  }

  const templateParams = {
    name:    contact.name  ? contact.name.trim()  : 'Unknown',
    email:   contact.email.trim(),
    message: message || '',
  };

  try {
    const response = await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams, PUBLIC_KEY);
    console.log('✓ Email Sent Successfully', response.status, response.text);
    return { success: true };
  } catch (err) {
    const error = err?.text || err?.message || 'Unknown EmailJS error';
    console.error('✓ Email Send Failed:', error);
    return { success: false, error };
  }
};
