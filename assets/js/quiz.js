/* ==========================================================================
   Daily quiz frontend. Fetches data/quiz/YYYY-MM-DD.json (written by
   tools/generate_quiz.py via the daily-quiz GitHub Action) and renders it
   one question at a time. Progress for "today" is cached in localStorage
   so a refresh mid-quiz doesn't lose your place, and a completed quiz
   shows the result screen again instead of letting you replay it.
   ========================================================================== */

const WCA_QUIZ = (() => {
    const STORAGE_KEY = "wca_quiz_progress";
    const STORAGE_HISTORY_KEY = "wca_quiz_history"; // {date: score} map, used for streaks

    let quiz = null;
    let current = 0;
    let answers = []; // array of booleans, one per answered question
    let root = null;

    // "Today" is anchored to UTC, not the visitor's local clock -- this is
    // a shared daily puzzle ("same questions for everyone"), so it has to
    // change at the same real-world instant for every visitor, the same
    // way Wordle/Connections-style daily games work. Using local time here
    // would give visitors east of UTC (NZ, Kiribati, etc.) a shrunk
    // window each day -- sometimes many hours shorter -- since their local
    // calendar date rolls over well before the UTC-anchored file exists.
    // UTC anchoring means everyone gets a full, equal 24 hours; the only
    // cost is the date label won't always match your own local calendar
    // right at the boundary.
    function todayISO() {
        const d = new Date();
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const day = String(d.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    // Testing aid: ?date=YYYY-MM-DD loads a specific generated quiz instead
    // of today's, and &reset=1 ignores any saved progress for that date so
    // you can replay it. Neither touches real "today" data unless the date
    // param happens to equal today. Not linked from anywhere in the UI --
    // it's a URL you type deliberately.
    function resolveDate() {
        const params = new URLSearchParams(window.location.search);
        const override = params.get("date");
        if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
            return { date: override, isOverride: true };
        }
        return { date: todayISO(), isOverride: false };
    }

    function wantsReset() {
        const params = new URLSearchParams(window.location.search);
        const v = params.get("reset");
        return v === "1" || v === "true";
    }

    function loadProgress(date) {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed.date !== date) return null;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function saveProgress(date, answersArr, currentIdx) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                date, answers: answersArr, current: currentIdx,
            }));
        } catch (e) { /* ignore quota/private-mode errors */ }
    }

    function recordHistory(date, score, total) {
        try {
            const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
            const hist = raw ? JSON.parse(raw) : {};
            hist[date] = { score, total };
            localStorage.setItem(STORAGE_HISTORY_KEY, JSON.stringify(hist));
        } catch (e) { /* ignore */ }
    }

    function computeStreak() {
        try {
            const raw = localStorage.getItem(STORAGE_HISTORY_KEY);
            if (!raw) return 0;
            const hist = JSON.parse(raw);
            let streak = 0;
            let d = new Date();
            for (;;) {
                const y = d.getUTCFullYear();
                const m = String(d.getUTCMonth() + 1).padStart(2, "0");
                const day = String(d.getUTCDate()).padStart(2, "0");
                const iso = `${y}-${m}-${day}`;
                if (hist[iso]) {
                    streak++;
                    d.setUTCDate(d.getUTCDate() - 1);
                } else {
                    break;
                }
            }
            return streak;
        } catch (e) {
            return 0;
        }
    }

    async function fetchQuiz(date) {
        const resp = await fetch(`data/quiz/${date}.json`, { cache: "no-store" });
        if (!resp.ok) throw new Error("not found");
        return resp.json();
    }

    function render() {
        if (current >= quiz.questions.length) {
            renderResult();
            return;
        }
        const q = quiz.questions[current];
        const total = quiz.questions.length;
        const pct = Math.round((current / total) * 100);

        root.innerHTML = `
            <div class="wca-quiz-progress">Question ${current + 1} of ${total}</div>
            <div class="wca-quiz-progress-bar"><div class="wca-quiz-progress-fill" style="width:${pct}%"></div></div>
            <div class="wca-quiz-card">
                <div class="wca-quiz-question">${escapeHtml(q.question)}</div>
                <div id="quizOptions"></div>
                <div id="quizExplanation"></div>
                <div id="quizNextWrap" class="wca-quiz-next"></div>
            </div>
        `;

        const optionsWrap = document.getElementById("quizOptions");
        q.options.forEach((opt, i) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "wca-quiz-option";
            btn.textContent = opt;
            btn.addEventListener("click", () => selectAnswer(i));
            optionsWrap.appendChild(btn);
        });
    }

    function selectAnswer(i) {
        const q = quiz.questions[current];
        const buttons = document.querySelectorAll("#quizOptions .wca-quiz-option");
        const correct = i === q.answer_index;

        buttons.forEach((btn, idx) => {
            btn.disabled = true;
            if (idx === q.answer_index) btn.classList.add("correct");
            else if (idx === i) btn.classList.add("incorrect");
        });

        const explWrap = document.getElementById("quizExplanation");
        if (q.explanation) {
            explWrap.innerHTML = `<div class="wca-quiz-explanation">${escapeHtml(q.explanation)}</div>`;
        }

        answers[current] = correct;
        saveProgress(quiz.date, answers, current);

        const nextWrap = document.getElementById("quizNextWrap");
        const isLast = current === quiz.questions.length - 1;
        const nextBtn = document.createElement("button");
        nextBtn.type = "button";
        nextBtn.className = "btn btn-warning";
        nextBtn.textContent = isLast ? "See results" : "Next question";
        nextBtn.addEventListener("click", () => {
            current++;
            saveProgress(quiz.date, answers, current);
            render();
        });
        nextWrap.appendChild(nextBtn);
    }

    function renderResult() {
        const total = quiz.questions.length;
        const score = answers.filter(Boolean).length;
        recordHistory(quiz.date, score, total);
        const streak = computeStreak();

        const grid = answers.map(a => (a ? "🟩" : "🟥")).join("");
        const shareText =
            `Women's Provincial Cricket Quiz — ${quiz.date}\n${score}/${total}\n${grid}\nhttps://womenscricketdb.github.io/quiz.html`;

        root.innerHTML = `
            <div class="wca-quiz-card wca-quiz-result">
                <h2>Quiz complete</h2>
                <div class="wca-quiz-score">${score} / ${total}</div>
                <div class="wca-quiz-grid">${grid}</div>
                ${streak > 1 ? `<p class="wca-quiz-progress">🔥 ${streak}-day streak</p>` : ""}
                <button type="button" class="btn btn-warning" id="quizShareBtn">Copy result to share</button>
                <p class="wca-quiz-progress" style="margin-top:1rem;">A new quiz is generated every day from the site's data.</p>
            </div>
        `;

        document.getElementById("quizShareBtn").addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(shareText);
                const btn = document.getElementById("quizShareBtn");
                const original = btn.textContent;
                btn.textContent = "Copied!";
                setTimeout(() => { btn.textContent = original; }, 1500);
            } catch (e) {
                alert(shareText);
            }
        });
    }

    function renderError(message) {
        root.innerHTML = `<div class="wca-quiz-error">${escapeHtml(message)}</div>`;
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    async function init() {
        root = document.getElementById("quizRoot");
        const { date, isOverride } = resolveDate();
        const reset = wantsReset();

        const dateLabelEl = document.getElementById("quizDateLabel");
        dateLabelEl.textContent =
            new Date(date + "T00:00:00").toLocaleDateString(undefined, {
                weekday: "long", year: "numeric", month: "long", day: "numeric",
            });
        if (isOverride) {
            const banner = document.createElement("div");
            banner.className = "wca-quiz-progress";
            banner.style.color = "var(--wca-gold)";
            banner.textContent = reset
                ? `🧪 Testing ${date} — progress reset for this load.`
                : `🧪 Testing ${date} — add &reset=1 to the URL to replay it.`;
            dateLabelEl.insertAdjacentElement("afterend", banner);
        }

        try {
            quiz = await fetchQuiz(date);
        } catch (e) {
            renderError(
                isOverride
                    ? `No quiz file found for ${date} — generate it with tools/generate_quiz.py --date ${date} first.`
                    : "Today's quiz hasn't been generated yet — check back soon."
            );
            return;
        }

        if (reset) {
            answers = [];
            current = 0;
        } else {
            const saved = loadProgress(date);
            if (saved) {
                answers = saved.answers || [];
                current = saved.current || 0;
            } else {
                answers = [];
                current = 0;
            }
        }
        render();
    }

    return { init };
})();
