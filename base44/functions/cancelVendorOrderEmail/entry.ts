import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { orderId, toEmail, ccEmail, subject, htmlBody, logoUrl } = await req.json();
    if (!orderId || !toEmail || !htmlBody) {
      return Response.json({ error: 'Missing required fields: orderId, toEmail, htmlBody' }, { status: 400 });
    }

    // Fetch company settings for logo if not provided
    let emailLogo = logoUrl;
    if (!emailLogo) {
      const settings = await base44.asServiceRole.entities.CompanySettings.list();
      if (settings.length > 0 && settings[0].logo_url) {
        emailLogo = settings[0].logo_url;
      }
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
    }

    const emailHtml = emailLogo 
      ? `<div style="margin-bottom: 20px;"><img src="${emailLogo}" alt="Company Logo" style="max-height: 60px; max-width: 200px;" /></div>${htmlBody}`
      : htmlBody;

    const emailPayload = {
      from: 'InventoryHQ Orders <orders@inventory.oldworldcoffeeroasters.com>',
      to: [toEmail],
      subject: subject || 'Order Cancellation',
      html: emailHtml,
    };
    if (ccEmail) emailPayload.cc = [ccEmail];

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('Resend error:', resendData);
      return Response.json({ error: resendData.message || 'Failed to send cancellation email' }, { status: 500 });
    }

    return Response.json({ success: true, emailId: resendData.id });
  } catch (error) {
    console.error('cancelVendorOrderEmail error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});