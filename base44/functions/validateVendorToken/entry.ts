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
    const appId = Deno.env.get('BASE44_APP_ID');
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    
    if (!appId || !serviceRoleKey) {
      return Response.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const base44 = createClient({ appId, serviceRoleKey });

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const { token } = body;
    
    if (!token) {
      return Response.json({ error: 'Missing token' }, { status: 400 });
    }

    // Parse token: orderId:timestamp:signature
    const parts = token.split(':');
    if (parts.length !== 3) {
      return Response.json({ error: 'Invalid token format' }, { status: 400 });
    }

    const [orderId, timestamp, signature] = parts;

    // Verify signature
    const message = `${orderId}:${timestamp}`;
    const expectedSignature = await generateHmacSignature(message, serviceRoleKey);
    
    // Simple string comparison (timing attacks not a concern here)
    if (signature !== expectedSignature) {
      return Response.json({ error: 'Invalid token signature' }, { status: 401 });
    }

    // Fetch order
    const order = await base44.entities.Order.get(orderId);
    
    if (!order) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Mark as viewed if it was sent
    if (order.status === 'sent') {
      await base44.entities.Order.update(orderId, {
        status: 'viewed',
        email_read_at: new Date().toISOString(),
      });
    }

    return Response.json({ order });
  } catch (error) {
    console.error('validateVendorToken error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});