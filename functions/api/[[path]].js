import axios from 'axios';
import * as cheerio from 'cheerio';

export async function onRequest(context) {
    const { request, env, params } = context;
    const path = params.path.join('/');

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers });

    // Roteamento simples por enquanto
    if (path === 'process-query') {
        return handleProcessQuery(request, env, headers);
    }
    
    return new Response(JSON.stringify({ error: 'Endpoint not found' }), { status: 404, headers });
}

async function handleProcessQuery(request, env, headers) {
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });

    try {
        const { query } = await request.json();
        if (!query) return new Response(JSON.stringify({ error: 'Query is required' }), { status: 400, headers });
        
        // Obter Alvos
        const ddgResponse = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
        const targets = (ddgResponse.data.RelatedTopics || [])
            .filter(t => t.FirstURL)
            .map(t => t.FirstURL)
            .slice(0, 5); // Pega 5 alvos

        if (targets.length === 0) {
            return new Response(JSON.stringify({ error: 'No sources found.' }), { status: 404, headers });
        }

        // Fazer Scraping
        const scrapePromises = targets.map(scrapeUrl);
        const articles = (await Promise.all(scrapePromises)).filter(Boolean);

        if (articles.length === 0) {
            return new Response(JSON.stringify({ error: 'Could not retrieve content.' }), { status: 502, headers });
        }

        // Retorna os artigos brutos. A IA será feita no front-end por enquanto.
        return new Response(JSON.stringify({ articles }), { status: 200, headers });

    } catch (error) {
        console.error("Backend Error:", error);
        return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), { status: 500, headers });
    }
}

async function scrapeUrl(url) {
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 InsightSphere/CF-Worker' } });
        const $ = cheerio.load(data);
        const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled';
        let content = '';
        $('article p, main p').each((i, elem) => { content += $(elem).text().trim() + '\n\n'; });
        return (content.length < 200) ? null : { sourceUrl: url, title, content };
    } catch {
        return null;
    }
}