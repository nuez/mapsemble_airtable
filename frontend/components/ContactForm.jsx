import React, { useState } from 'react';
import { Box, Text, Button, FormField, Input } from '@airtable/blocks/ui';
import { MAPSEMBLE_URL } from '../services/mapsemble';

export default function ContactForm({ onClose }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [errorText, setErrorText] = useState('');

  async function handleSubmit() {
    setStatus('sending');
    setErrorText('');
    try {
      const res = await fetch(`${MAPSEMBLE_URL}/api/v1/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, website }),
      });
      if (res.ok) {
        setStatus('sent');
      } else {
        const body = await res.json().catch(() => ({}));
        const msg = body.errors
          ? body.errors.join(' ')
          : body.error || 'Something went wrong. Please try again.';
        setErrorText(msg);
        setStatus('error');
      }
    } catch (_err) {
      setErrorText('Could not reach Mapsemble. Check your internet connection.');
      setStatus('error');
    }
  }

  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      display="flex"
      flexDirection="column"
      style={{ backgroundColor: '#fff', zIndex: 100 }}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        paddingX={3}
        paddingY={2}
        borderBottom="default"
        flexShrink={0}
      >
        <Text fontWeight="strong">Contact & Feedback</Text>
        <Button onClick={onClose} variant="default" size="small">
          Close
        </Button>
      </Box>

      <Box flex="auto" padding={3} style={{ overflowY: 'auto' }}>
        {status === 'sent' ? (
          <Box>
            <Text size="large" fontWeight="strong" className="text-gray-700 !mb-2">
              Thank you!
            </Text>
            <Text className="text-gray-500 !mt-2">
              Your message has been sent. We'll get back to you soon.
            </Text>
            <Button onClick={onClose} variant="default" marginTop={3}>
              Close
            </Button>
          </Box>
        ) : (
          <Box>
            <Text size="default" className="text-gray-500 !mb-3">
              Have a question, suggestion, or ran into an issue? We'd love to hear from you.
            </Text>

            {/* Honeypot - hidden from humans via CSS */}
            <div style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, overflow: 'hidden' }} aria-hidden="true" tabIndex={-1}>
              <label htmlFor="contact-website">Website</label>
              <input
                id="contact-website"
                type="text"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                autoComplete="off"
              />
            </div>

            <FormField label="Name (optional)">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                disabled={status === 'sending'}
              />
            </FormField>

            <FormField label="Email" marginTop={2}>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                disabled={status === 'sending'}
              />
            </FormField>

            <FormField label="Message" marginTop={2}>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="How can we help?"
                rows={5}
                disabled={status === 'sending'}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
              />
            </FormField>

            {errorText && (
              <Text size="small" className="text-red-600" marginTop={2}>
                {errorText}
              </Text>
            )}

            <Button
              onClick={handleSubmit}
              variant="primary"
              marginTop={3}
              disabled={status === 'sending' || !email.trim() || !message.trim()}
            >
              {status === 'sending' ? 'Sending...' : 'Send Message'}
            </Button>
          </Box>
        )}
      </Box>
    </Box>
  );
}
