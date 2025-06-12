document.addEventListener('DOMContentLoaded', () => {
    // Nosso back-end agora tem apenas um endpoint poderoso
    const API_ENDPOINT = '/api/process-query'; // Vamos dar um nome mais genérico

    const textarea = document.getElementById('editor');
    const submitBtn = document.getElementById('submit-button');
    const statusSection = document.getElementById('status-section');
    const responseSection = document.getElementById('response-section');
    
    let isSearching = false;

    // --- Funções de UI ---
    function showStatusMessage(text) {
        statusSection.style.display = 'block';
        statusSection.innerHTML = `<div class="status-item"><div class="spinner"></div><div class="text">${text}</div></div>`;
    }

    function renderFinalReport(rankedArticles) {
        responseSection.innerHTML = '';
        statusSection.style.display = 'none';

        const reportContainer = document.createElement('div');
        reportContainer.className = 'final-report';
        
        if (!rankedArticles || rankedArticles.length === 0) {
            reportContainer.innerHTML = `<div class="report-section"><p>The search could not find any relevant articles. Please try rephrasing your query.</p></div>`;
        } else {
            const bestAnswerOverall = rankedArticles[0];
            let directAnswerHTML = `<div class="report-section direct-answer"><h2>Direct Answer</h2>`;
            if (bestAnswerOverall.relevanceScore > 0.15) {
                const highlightedSnippet = bestAnswerOverall.bestAnswer.replace(new RegExp(bestAnswerOverall.bestAnswer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `<span class="highlight">${bestAnswerOverall.bestAnswer}</span>`);
                directAnswerHTML += `<p>${highlightedSnippet}</p><span class="source-link">Source: <a href="${bestAnswerOverall.sourceUrl}" target="_blank" rel="noopener noreferrer">${bestAnswerOverall.title}</a></span>`;
            } else {
                directAnswerHTML += `<p>A single, high-confidence answer could not be extracted. Please review the top-ranked articles below.</p>`;
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
        
        responseSection.innerHTML = reportHTML;
        setTimeout(() => {
            const finalReportElement = responseSection.querySelector('.final-report');
            if(finalReportElement) finalReportElement.classList.add('visible');
        }, 100);
    }

    function renderError(message) {
        statusSection.style.display = 'none';
        responseSection.innerHTML = `<div class="report-section final-report visible"><p class="error-message">An error occurred: ${message}</p></div>`;
    }

    // --- Lógica Principal ---
    async function handleSubmit() {
        const query = textarea.value.trim();
        if (!query || isSearching) return;

        isSearching = true;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<div class="spinner"></div>';
        responseSection.innerHTML = '';
        
        document.body.classList.add('submitted');
        showStatusMessage('Sending query to AI backend for analysis...');

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Server responded with status ${response.status}`);
            }

            const { rankedArticles } = await response.json();
            renderFinalReport(rankedArticles);

        } catch (error) {
            console.error('Search process failed:', error);
            renderError(error.message);
        } finally {
            isSearching = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-search"></i>';
        }
    }

    submitBtn.addEventListener('click', handleSubmit);
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    });

});