// Netlify Function: Create Yoco Checkout Session
// Generates payment links for invoices via Yoco Payments API

export async function handler(event) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
    if (!YOCO_SECRET_KEY) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Yoco API key not configured. Set YOCO_SECRET_KEY in Netlify env vars.' })
        };
    }

    try {
        const { amount, currency, invoiceNumber, clientName, successUrl, cancelUrl } = JSON.parse(event.body);

        if (!amount || amount <= 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) };
        }

        // Yoco expects amount in cents (ZAR)
        const amountInCents = Math.round(amount * 100);
        const siteUrl = process.env.URL || 'https://oracle-invoicer-exd.netlify.app';

        const response = await fetch('https://payments.yoco.com/api/checkouts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${YOCO_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amountInCents,
                currency: currency || 'ZAR',
                successUrl: successUrl || `${siteUrl}?payment=success&invoice=${invoiceNumber}`,
                cancelUrl: cancelUrl || `${siteUrl}?payment=cancelled&invoice=${invoiceNumber}`,
                failureUrl: `${siteUrl}?payment=failed&invoice=${invoiceNumber}`,
                metadata: {
                    invoiceNumber: invoiceNumber || '',
                    clientName: clientName || ''
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Yoco API error:', response.status, errorData);
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: `Yoco API error: ${response.status}`, details: errorData })
            };
        }

        const checkout = await response.json();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                checkoutId: checkout.id,
                paymentUrl: checkout.redirectUrl,
                expiresAt: checkout.expiresAt
            })
        };
    } catch (err) {
        console.error('Checkout error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to create checkout', message: err.message })
        };
    }
}
