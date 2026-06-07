import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { productUrl } = await req.json();
    
    if (!productUrl) {
      return Response.json({ error: 'Product URL is required', image_url: null, price: null }, { status: 400 });
    }

    // Fetch the page HTML directly
    const pageResponse = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!pageResponse.ok) {
      return Response.json({ error: `Failed to fetch page: ${pageResponse.status}`, image_url: null, price: null }, { status: 500 });
    }

    const html = await pageResponse.text();
    
    // Extract og:image meta tag (most reliable for main product image)
    const ogImageMatch = html.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                         html.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    
    let imageUrl = null;
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1];
    } else {
      // Extract all image URLs from HTML
      const imgMatches = html.match(/src=["']([^"']+\.jpg[^"']*)["']/gi) || [];
      const imageUrls = [...new Set(imgMatches.map(m => m.replace(/src=["']|["']/gi, '')))];
      
      // Look for images with product-related patterns (large, main, product)
      const productImage = imageUrls.find(url => 
        url.includes('large') || url.includes('product') || url.includes('main')
      );
      
      imageUrl = productImage || imageUrls.find(url => url.startsWith('http'));
    }
    
    // Extract price from page - look for common price patterns
    let price = null;
    
    // Try to find price in common formats: $XX.XX or $X,XXX.XX
    const pricePatterns = [
      /\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/g,
      /price[^>]*["']?\$?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/gi,
      /["']\$([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)["']/g
    ];
    
    for (const pattern of pricePatterns) {
      const matches = html.match(pattern);
      if (matches && matches.length > 0) {
        // Extract just the numeric value from the first match
        const priceMatch = matches[0].match(/\$?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
        if (priceMatch) {
          price = parseFloat(priceMatch[1].replace(/,/g, ''));
          break;
        }
      }
    }
    
    return Response.json({ 
      image_url: imageUrl || null,
      price: price
    });
  } catch (error) {
    console.error('Error scraping product data:', error);
    return Response.json({ error: error.message, image_url: null, price: null }, { status: 500 });
  }
});