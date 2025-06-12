import axios from 'axios';
import * as cheerio from 'cheerio';
// Importa as bibliotecas de IA
import * as tf from '@tensorflow/tfjs-node';
import * as qna from '@tensorflow-models/qna';

let qnaModel; // O modelo será carregado uma vez e reutilizado

// --- Funções Auxiliares ---
async function scrapeUrl(url) {
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 InsightSphere/CF-Worker-AI' } });
        const $ = cheerio.load(data);
        const title = $('h1').first().text().trim() || $('title').text().trim() || 'Untitled';
        let content = '';
        $('article p, main p').each((i, elem) => { content += $(elem).text().trim() + '\n\n'; });
        return (content.length < 200) ? null : { sourceUrl: url, title, content };
    } catch { return null; }
}

async function analyzeAndRank(query, articles) {
    if (!articles || articles.length === 0) return [];
    
    // Carrega o modelo de IA na primeira vez que for necessário
    if (!qnaModel) {
        console.log("Loading QnA model on backend...");
        qnaModel = await qna.load();
        console.log("QnA model loaded.");
    }

    const analysisPromises = articles.map(async (article) => {
        try {
            const answers = await qnaModel.findAnswers(query, article.content);
            const topAnswer = answers.length > 0 ? answers.sort((a, b) => b.score - a.score)[0] : { text: 'No specific answer found.', score: 0 };
            // Remove o conteúdo bruto para economizar dados na resposta
            delete article.content; 
            return { ...article, relevanceScore: topAnswer.score, bestAnswer: topAnswer.text };
        } catch (e) {
            console.error(`Error analyzing article: ${article.title}`, e);
            return { ...article, relevanceScore: 0, bestAnswer: 'Analysis failed for this article.' };
        }
    });
    
    const ranked = await Promise.all(analysisPromises);
    return ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// --- Roteador Principal do Worker ---
export async function onRequest(context) {
    const { request } = context;
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };
    
    if (request.method === 'OPTIONS') return new Response(null, { headers });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });

    try {
        const { query, detailLevel = 3 } = await request.json();
        if (!query) return new Response(JSON.stringify({ error: 'Query is required' }), { status: 400, headers });

        // FASE 1: Obter Alvos
        const ddgResponse = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
        const targets = (ddgResponse.data.RelatedTopics || [])
            .filter(t => t.FirstURL)
            .map(t => t.FirstURL)
            .slice(0, {1: 3, 2: 5, 3: 8, 4: 10, 5: 15}[detailLevel] ?? 8);

        if (targets.length === 0) {
            return new Response(JSON.stringify({ error: 'No potential sources found.' }), { status: 404, headers });
        }

        // FASE 2: Fazer Scraping
        const scrapePromises = targets.map(scrapeUrl);
        const articles = (await Promise.all(scrapePromises)).filter(Boolean);

        if (articles.length === 0) {
            return new Response(JSON.stringify({ error: 'Could not retrieve content from any source.' }), { status: 502, headers });
        }
        
        // FASE 3: Análise de IA no Back-end
        const rankedArticles = await analyzeAndRank(query, articles);

        // O back-end envia o relatório final, já processado e ranqueado.
        return new Response(JSON.stringify({ rankedArticles }), { status: 200, headers });

    } catch (error) {
        console.error("Backend Error:", error);
        return new Response(JSON.stringify({ error: `An internal server error occurred: ${error.message}` }), { status: 500, headers });
    }
}
