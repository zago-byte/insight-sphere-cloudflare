import axios from 'axios';
import cheerio from 'cheerio';

export async function onRequest(context) {
    const { request, env, params } = context;
    const path = params.path.join('/');

    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }

    try {
        if (path === 'generate-plan') {
            return handleResponse(await generatePlan(request, env), headers);
        }
        if (path === 'execute-search') {
            return handleResponse(await executeSearch(request, env), headers);
        }
        return handleResponse({ error: 'Endpoint not found' }, headers, 404);
    } catch (error) {
        console.error(`Error for path ${path}:`, error);
        return handleResponse({ error: 'An internal server error occurred.' }, headers, 500);
    }
}

function handleResponse(body, headers, status = 200) {
    return new Response(JSON.stringify(body), { status, headers });
}

async function generatePlan(request, env) {
    if (request.method !== 'POST') return { error: 'Method Not Allowed' };
    const { query } = await request.json();
    if (!query) return { error: 'Query is required' };

    const WIT_AI_TOKEN = env.WIT_AI_API_KEY;
    if (!WIT_AI_TOKEN) return { error: 'Server configuration error: API key not set.' };
    
    const witResponse = await axios.get(`https://api.wit.ai/message?v=20250505&q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${WIT_AI_TOKEN}` }
    });
    
    const entities = witResponse.data.entities;
    const mainTerm = entities['search_term:search_term']?.[0]?.value || query;
    
    return {
        mainTerm,
        steps: [
            `Define what "${mainTerm}" is.`,
            `Investigate the core principles and history of "${mainTerm}".`,
            `Analyze the main challenges or benefits related to "${mainTerm}".`,
            `Explore real-world applications or examples of "${mainTerm}".`
        ]
    };
}

async function executeSearch(request, env) {
    if (request.method !== 'POST') return { error: 'Method Not Allowed' };
    const { planSteps } = await request.json();
    if (!planSteps || !Array.isArray(planSteps)) return { error: 'Plan steps are required' };

    let allArticles = [];
    for (const step of planSteps) {
        try {
            const ddgResponse = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(step)}&format=json&no_html=1`);
            const targets = (ddgResponse.data.RelatedTopics || [])
                .filter(t => t.FirstURL)
                .map(t => t.FirstURL)
                .slice(0, 2);
            
            const scrapePromises = targets.map(scrapeUrl);
            const articlesForStep = (await Promise.all(scrapePromises)).filter(Boolean);
            allArticles.push(...articlesForStep);
        } catch (e) {
            console.error(`Failed to process step "${step}":`, e.message);
        }
    }
    const uniqueArticles = Array.from(new Map(allArticles.map(item => [item['sourceUrl'], item])).values());
    return { articles: uniqueArticles };
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