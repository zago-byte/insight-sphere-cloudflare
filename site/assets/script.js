document.addEventListener('DOMContentLoaded', () => {
    // Endpoints relativos. Cloudflare Pages roteará isso para nossa pasta /functions
    const PLAN_API = '/api/generate-plan';
    const EXECUTE_API = '/api/execute-search';
    const QUALITY_THRESHOLD = 0.60;

    const textarea = document.getElementById('editor');
    const submitBtn = document.getElementById('submit-button');
    const dynamicContent = document.getElementById('dynamic-content');
    
    let qnaModel;
    let isBusy = false;

    async function initializeApp() {
        try {
            qnaModel = await qna.load();
            textarea.disabled = false;
            submitBtn.disabled = false;
            textarea.placeholder = "Ask anything... e.g., what are the risks of AI?";
        } catch (error) {
            console.error('QnA Model Init Failed:', error);
            textarea.placeholder = "Error: AI model failed to load.";
        }
    }

    function renderPlan(plan) {
        dynamicContent.innerHTML = `
            <div class="plan-section">
                <h2>Proposed Action Plan</h2>
                <p>To answer your query about "<strong>${plan.mainTerm}</strong>", I will investigate:</p>
                <ul class="plan-checklist">
                    ${plan.steps.map((step, index) => `<li id="step-${index}"><i class="far fa-square"></i> <span>${step}</span></li>`).join('')}
                </ul>
                <div class="plan-actions">
                    <button id="cancel-plan-btn" class="icon-btn">Cancel</button>
                    <button id="execute-plan-btn" class="submit-btn" style="background: var(--success-color);">Execute Plan</button>
                </div>
            </div>`;
        dynamicContent.classList.add('visible');
        document.getElementById('execute-plan-btn').addEventListener('click', () => executePlan(plan));
        document.getElementById('cancel-plan-btn').addEventListener('click', resetState);
    }

    async function executePlan(plan) {
        isBusy = true;
        document.querySelector('.plan-actions').style.display = 'none';
        const checklistItems = document.querySelectorAll('.plan-checklist li');
        const query = textarea.value.trim();

        const executionPromise = (async () => {
            try {
                const response = await fetch(EXECUTE_API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ planSteps: plan.steps })
                });
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.error || 'Backend failed to execute the search.');
                }
                const { articles } = await response.json();
                const rankedArticles = await analyzeAndRankArticles(query, articles);
                renderFinalReport(query, rankedArticles);
            } catch (error) {
                renderError(error.message);
            }
        })();

        for (let i = 0; i < checklistItems.length; i++) {
            const item = checklistItems[i];
            item.classList.add('processing');
            item.querySelector('i').className = 'fas fa-spinner fa-spin'; // Adiciona animação de spin
            await new Promise(resolve => setTimeout(resolve, 800)); // Simula trabalho para o efeito visual
            item.classList.remove('processing');
            item.classList.add('completed');
            item.querySelector('i').className = 'fas fa-check-square';
        }
        await executionPromise; // Espera a busca real terminar
    }

    async function analyzeAndRankArticles(query, articles) {
        if (!articles || articles.length === 0) return [];
        const analysisPromises = articles.map(async (article) => {
            const answers = await qnaModel.findAnswers(query, article.content);
            const topAnswer = answers.length > 0 ? answers.sort((a, b) => b.score - a.score)[0] : { text: 'No specific answer found.', score: 0 };
            return { ...article, relevanceScore: topAnswer.score, bestAnswer: topAnswer.text };
        });
        const ranked = await Promise.all(analysisPromises);
        return ranked.sort((a, b) => b.relevanceScore - a.relevanceScore);
    }

    function renderFinalReport(query, rankedArticles) {
        let reportHTML = '';
        if (!rankedArticles || rankedArticles.length === 0) {
            reportHTML = `<div class="report-section"><p>The search could not find any relevant articles to generate a report. Please try rephrasing your query.</p></div>`;
        } else {
            const bestAnswerOverall = rankedArticles[0];
            let directAnswerHTML = `<div class="report-section direct-answer"><h2>Direct Answer</h2>`;
            if (bestAnswerOverall.relevanceScore > 0.15) {
                const highlightedSnippet = bestAnswerOverall.bestAnswer.replace(new RegExp(bestAnswerOverall.bestAnswer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `<span class="highlight">${bestAnswerOverall.bestAnswer}</span>`);
                directAnswerHTML += `<p>${highlightedSnippet}</p><span class="source-link">Source: <a href="${bestAnswerOverall.sourceUrl}" target="_blank" rel="noopener noreferrer">${bestAnswerOverall.title}</a></span>`;
            } else {
                directAnswerHTML += `<p>A single, high-confidence answer could not be extracted. Please review the top-ranked articles below for detailed information.</p>`;
            }
            directAnswerHTML += `</div>`;

            let topSourcesHTML = `<div class="report-section"><h2>Ranked Sources</h2>`;
            rankedArticles.slice(0, 5).forEach(article => {
                let scoreClass = 'low'; let scoreIcon = 'fa-thumbs-down';
                if (article.relevanceScore > 0.5) { scoreClass = 'high'; scoreIcon = 'fa-check-circle'; }
                else if (article.relevanceScore > 0.15) { scoreClass = 'medium'; scoreIcon = 'fa-minus-circle'; }
                topSourcesHTML += `<div class="ranked-article"><div class="article-header"><h3><a href="${article.sourceUrl}" target="_blank" rel="noopener noreferrer">${article.title}</a></h3><div class="relevance-score ${scoreClass}"><i class="fas ${scoreIcon} icon"></i><span>${(article.relevanceScore * 100).toFixed(0)}% Match</span></div></div><div class="article-snippet"><strong>Best snippet:</strong> <em>"${article.bestAnswer}"</em></div></div>`;
            });
            topSourcesHTML += `</div>`;

            reportHTML = directAnswerHTML + topSourcesHTML;
        }
        dynamicContent.innerHTML = reportHTML;
        dynamicContent.classList.add('visible');
    }

    function renderError(message) {
        dynamicContent.innerHTML = `<div class="report-section"><p class="error-message">An error occurred: ${message}</p></div>`;
        dynamicContent.classList.add('visible');
    }

    async function handleInitialSubmit() {
        const query = textarea.value.trim();
        if (!query || isBusy) return;
        isBusy = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner"></div>';
        dynamicContent.innerHTML = '';
        dynamicContent.classList.remove('visible');
        try {
            const response = await fetch(PLAN_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
            if (!response.ok) {
                 const err = await response.json();
                 throw new Error(err.error || "Could not generate a plan.");
            }
            const plan = await response.json();
            renderPlan(plan);
        } catch (error) {
            console.error('Failed to generate plan:', error);
            renderError(error.message);
            resetState();
        } finally {
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
            submitBtn.disabled = false;
        }
    }

    function resetState() {
        isBusy = false;
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        dynamicContent.innerHTML = '';
        dynamicContent.classList.remove('visible');
        textarea.value = '';
    }

    submitBtn.addEventListener('click', handleInitialSubmit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInitialSubmit(); }
    });

    initializeApp();
});