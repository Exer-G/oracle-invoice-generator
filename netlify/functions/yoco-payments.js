// Netlify Function: Fetch Yoco Payment History
// Check payment statuses and sync

export async function handler(event) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY;
    if (!YOCO_SECRET_KEY) {
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Yoco API key not configured' })
        };
    }

    try {
        const limit = event.queryStringParameters?.limit || 50;

        const response = await fetch(`https://api.yoco.com/v1/payments/?limit=${limit}`, {
            headers: {
                'Authorization': `Bearer ${YOCO_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            return {
                statusCode: response.status,
                headers,
                body: JSON.stringify({ error: `Yoco API error: ${response.status}`, details: errText })
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify(data)
        };
    } catch (err) {
        console.error('Yoco payments error:', err);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch payments', message: err.message })
        };
    }
}
