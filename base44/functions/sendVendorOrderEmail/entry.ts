import { createClient } from 'npm:@base44/sdk@0.8.31';

async function generateHmacSignature(message: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const messageData = encoder.encode(message);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    // Only handle POST requests
    if (req.method !== 'POST') {
      // Return 200 for GET requests (browser favicon, etc.)
      return Response.json({ note: 'Use POST to send emails' });
    }

    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    
    if (!appId || !serviceRoleKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const base44 = createClient({ appId, serviceRoleKey });

    const text = await req.text();
    console.log('=== sendVendorOrderEmail ===');
    console.log('Request URL:', req.url);
    console.log('Content-Type header:', req.headers.get('content-type'));
    console.log('Raw text length:', text?.length);
    console.log('Raw text (first 300):', text?.substring(0, 300));
    
    if (!text || text.trim().length === 0) {
      console.log('WARNING: Empty request body');
      return Response.json({ error: 'Empty request body' }, { status: 400 });
    }
    
    let body;
    try {
      body = JSON.parse(text);
      console.log('Parsed body keys:', Object.keys(body));
      console.log('Has payload field?', 'payload' in body);
      if (body.payload) {
        console.log('Payload keys:', Object.keys(body.payload));
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    // Platform wraps payload in 'payload' key - check both locations
    const data = body.payload || body;
    const { orderId, toEmail, ccEmail, subject, htmlBody, logoUrl, appUrl: clientAppUrl } = data;
    
    console.log('Extracted fields:', { 
      orderId: orderId ? 'present' : 'MISSING', 
      toEmail: toEmail ? 'present' : 'MISSING', 
      htmlBody: htmlBody ? `present (${htmlBody.length} chars)` : 'MISSING' 
    });
    
    if (!orderId || !toEmail || !htmlBody) {
      console.error('Validation failed. Full data:', JSON.stringify(data, null, 2).substring(0, 500));
      return Response.json({ error: 'Missing required fields: orderId, toEmail, htmlBody' }, { status: 400 });
    }

    console.log('Fetching company settings...');
    // Fetch company settings for logo
    let emailLogo = logoUrl;
    if (!emailLogo) {
      console.log('Fetching company settings...');
      const settings = await base44.entities.CompanySettings.list();
      console.log('Settings found:', settings?.length);
      if (settings.length > 0 && settings[0].logo_url) {
        emailLogo = settings[0].logo_url;
        console.log('Logo URL found:', emailLogo?.substring(0, 50));
      }
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    console.log('RESEND_API_KEY present:', !!RESEND_API_KEY);
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    // Generate signed token for order viewing
    console.log('Generating HMAC signature...');
    const timestamp = Date.now().toString();
    const message = `${orderId}:${timestamp}`;
    const signature = await generateHmacSignature(message, serviceRoleKey);
    const token = `${orderId}:${timestamp}:${signature}`;
    console.log('Token generated');
    
    // Build order view URL - use app URL from client
    const viewOrderUrl = `${clientAppUrl || 'https://inventory.oldworldcoffeeroasters.com'}/vendor/order?token=${encodeURIComponent(token)}`;
    console.log('View order URL:', viewOrderUrl);

    // Add "View Order" button to email HTML
    const viewOrderButton = `
      <div style="margin: 30px 0; text-align: center;">
        <a href="${viewOrderUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
          View Order Details
        </a>
        <p style="margin-top: 12px; font-size: 13px; color: #6b7280;">Click above to view your order details online</p>
      </div>
    `;

    const emailHtml = emailLogo 
      ? `<div style="margin-bottom: 20px;"><img src="${emailLogo}" alt="Company Logo" style="max-height: 60px; max-width: 200px;" /></div>${htmlBody}`
      : htmlBody;

    const emailWithTracking = emailHtml.replace('TRACKING_PLACEHOLDER_CONFIRM', viewOrderButton);
    console.log('Email HTML prepared, length:', emailWithTracking?.length);

    // Mark order as sent
    console.log('Updating order status...');
    await base44.entities.Order.update(orderId, {
      status: 'sent',
      email_sent_at: new Date().toISOString(),
      sent_to_email: toEmail,
    });
    console.log('Order updated');

    const emailPayload = {
      from: 'InventoryHQ Orders <orders@inventory.oldworldcoffeeroasters.com>',
      to: [toEmail],
      subject: subject || 'Purchase Order',
      html: emailWithTracking,
    };
    if (ccEmail) emailPayload.cc = [ccEmail];
    console.log('Sending email via Resend...');

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    console.log('Resend response status:', resendRes.status);
    const resendData = await resendRes.json();
    console.log('Resend response:', resendData);

    if (!resendRes.ok) {
      console.error('Resend error:', resendData);
      return Response.json({ error: resendData.message || 'Failed to send email' }, { status: 500 });
    }

    console.log('Email sent successfully!');
    return Response.json({ success: true, emailId: resendData.id });
  } catch (error) {
    console.error('sendVendorOrderEmail error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});