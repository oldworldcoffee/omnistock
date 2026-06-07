import { createClient } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get('order_id');
    const appId = url.searchParams.get('app_id');
    const isConfirmLink = url.searchParams.get('confirm') === '1';

    if (!orderId || !appId) {
      return new Response('Missing parameters', { status: 400 });
    }

    // Use service role key to update order without user auth
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
      return new Response('Server error', { status: 500 });
    }

    // Fetch order via Base44 REST API
    const orderRes = await fetch(`https://api.base44.com/api/apps/${appId}/entities/Order/${orderId}`, {
      headers: { 'api-key': serviceRoleKey },
    });

    if (!orderRes.ok) {
      return new Response('Not found', { status: 404 });
    }

    const order = await orderRes.json();

    // Update order status to 'viewed' if it was 'sent'
    if (order.status === 'sent') {
      await fetch(`https://api.base44.com/api/apps/${appId}/entities/Order/${orderId}`, {
        method: 'PATCH',
        headers: {
          'api-key': serviceRoleKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'viewed',
          email_read_at: new Date().toISOString(),
        }),
      });
    }

    // If clicked as a confirm link, show a simple confirmation page
    if (isConfirmLink) {
      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px;color:#333;">
        <h2 style="color:#16a34a;">✓ Order Confirmed</h2>
        <p>Order <strong>${order.order_number || orderId}</strong> has been marked as received by your team.</p>
        <p style="color:#888;font-size:14px;">You can close this tab.</p>
      </body></html>`;
      return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    // Otherwise return a 1x1 transparent GIF pixel
    const pixel = new Uint8Array([
      71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,1,68,0,59
    ]);
    return new Response(pixel, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    return new Response('', { status: 500 });
  }
});