import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, BookOpenText, CaretDown,
  ChartLineUp, CheckCircle, Command, Database, FileMagnifyingGlass, FilePdf,
  Info, MagnifyingGlass, SlidersHorizontal, Sparkle,
  UploadSimple, WarningCircle
} from "@phosphor-icons/react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

function prettyDocument(item) {
  if (typeof item === "string") return { id: item.replace(/\.pdf$/i, ""), name: item, filename: item };
  const id = item?.document_id || item?.id || item?.filename || item?.name || "unknown document";
  const name = item?.filename || item?.name || item?.title || id;
  return { ...item, id, name, filename: item?.filename || name };
}

function extractDocuments(payload) {
  if (Array.isArray(payload)) return payload.map(prettyDocument);
  for (const key of ["documents", "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key].map(prettyDocument);
  }
  return [];
}

function App() {
  const [activeTab, setActiveTab] = useState("home");
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("collection");
  const [selectedDocument, setSelectedDocument] = useState("");
  const [retrievalK, setRetrievalK] = useState(50);
  const [finalK, setFinalK] = useState(10);
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [apiStatus, setApiStatus] = useState("checking");
  const [apiHealth, setApiHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [showAllDocuments, setShowAllDocuments] = useState(false);

  useEffect(() => {
    let alive = true;
    async function loadData() {
      try {
        const [healthRes, docsRes] = await Promise.all([
          fetch(API_BASE + "/health"),
          fetch(API_BASE + "/api/documents")
        ]);
        if (!healthRes.ok) throw new Error("The API health check failed.");
        const health = await healthRes.json();
        const docsPayload = docsRes.ok ? await docsRes.json() : {};
        if (!alive) return;
        setApiHealth(health);
        setApiStatus(health.retrieval_ready ? "connected" : "degraded");
        const parsed = extractDocuments(docsPayload);
        setDocuments(parsed);
        if (parsed.length) setSelectedDocument(parsed[0].id);
      } catch {
        if (alive) setApiStatus("offline");
      } finally {
        if (alive) setDocumentsLoading(false);
      }
    }
    loadData();
    return () => { alive = false; };
  }, []);

  const answer = response?.answer;
  const sources = useMemo(() => {
    const options = [answer?.sources, response?.sources, response?.results, response?.retrieval?.results, response?.evidence];
    return options.find(Array.isArray) || [];
  }, [answer, response]);

  const suggestions = [
    "How much did TCS spend on employee costs in FY2025?",
    "What was TCS's consolidated revenue from operations in FY2025?",
    "Compare employee benefit expenses in FY2024 and FY2025."
  ];

  async function askQuestion(nextQuestion = question) {
    const cleanQuestion = nextQuestion.trim();
    if (!cleanQuestion) {
      setError("Enter a question about the reports.");
      return;
    }
    if (scope === "document" && !selectedDocument) {
      setError("Choose a report or search the full collection.");
      return;
    }
    setLoading(true);
    setError("");
    setResponse(null);
    setQuestion(cleanQuestion);
    try {
      const res = await fetch(API_BASE + "/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: cleanQuestion,
          scope,
          document_id: scope === "document" ? selectedDocument : null,
          retrieval_k: Number(retrievalK),
          final_k: Number(finalK)
        })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || payload?.message || "Request failed (" + res.status + ").");
      setResponse(payload);
    } catch (requestError) {
      setError((requestError.message || "The request failed.") + " Check that the local API is running at " + API_BASE + ".");
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(file) {
    if (!file) return;
    setUploadMessage("");
    setUploadError("");
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Choose a PDF report.");
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    setUploading(true);
    try {
      const res = await fetch(API_BASE + "/api/documents/upload", { method: "POST", body: formData });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.detail || "Upload failed (" + res.status + ").");
      const docsRes = await fetch(API_BASE + "/api/documents");
      if (docsRes.ok) {
        const docsPayload = await docsRes.json();
        const parsed = extractDocuments(docsPayload);
        setDocuments(parsed);
        if (payload.document_id) {
          setSelectedDocument(payload.document_id);
          setScope("document");
        }
      }
      setUploadMessage((payload.filename || file.name) + " is indexed. " +
        (payload.page_count ?? "?") + " pages and " + (payload.chunk_count ?? "?") + " chunks were added.");
    } catch (uploadFailure) {
      setUploadError(uploadFailure.message || "The report could not be added.");
    } finally {
      setUploading(false);
    }
  }

  function chooseDocument(documentId) {
    setSelectedDocument(documentId);
    setActiveTab("research");
    setScope("document");
    window.requestAnimationFrame(() => document.getElementById("question-box")?.focus({ preventScroll: true }));
  }

  const visibleDocuments = showAllDocuments ? documents : documents.slice(0, 5);
  const statusLabel = apiStatus === "connected" ? "Search ready"
    : apiStatus === "degraded" ? "Search needs attention"
      : apiStatus === "offline" ? "Backend offline" : "Checking connection";
  const answerStatus = answer?.status === "answered"
    ? (answer?.answer_type === "llm_grounded" ? "Evidence checked" : "Answer ready")
    : answer?.status === "generation_unavailable" ? "Generation unavailable" : "Review evidence";

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to research</a>
      <header className="topbar-wrap">
        <nav className="topbar" aria-label="Main navigation">
          <a className="brand" href="#main-content" aria-label="FinSight home" onClick={event => { event.preventDefault(); setActiveTab("home"); }}>
            <span className="brand-mark"><ChartLineUp size={22} weight="regular" /></span>
            <span className="brand-name">FinSight</span>
          </a>
          <div className="nav-links" role="tablist" aria-label="FinSight pages">
            <button type="button" className={activeTab === "home" ? "nav-link nav-link-active" : "nav-link"} role="tab" id="home-tab" aria-selected={activeTab === "home"} aria-controls="home-panel" onClick={() => setActiveTab("home")}>Home</button>
            <button type="button" className={activeTab === "research" ? "nav-link nav-link-active" : "nav-link"} role="tab" id="research-tab" aria-selected={activeTab === "research"} aria-controls="research-panel" onClick={() => setActiveTab("research")}>Research</button>
            <button type="button" className={activeTab === "library" ? "nav-link nav-link-active" : "nav-link"} role="tab" id="library-tab" aria-selected={activeTab === "library"} aria-controls="library-panel" onClick={() => setActiveTab("library")}>Report library</button>
          </div>
          <div className={"connection-status connection-" + apiStatus} role="status" aria-live="polite">
            <span className="status-dot" /><span>{statusLabel}</span>
          </div>
        </nav>
      </header>

      <main id="main-content" className="page-shell">
        <section className="home-view" role="tabpanel" id="home-panel" aria-labelledby="home-tab" hidden={activeTab !== "home"}>
          <section className="intro-grid" aria-labelledby="page-title">
          <div className="intro-copy">
            <div className="eyebrow"><span className="eyebrow-rule" /> FINANCIAL REPORT RESEARCH</div>
            <h1 id="page-title" className="heading-1 hero-heading">
              Find the answer<br className="hero-break" /><span>in the reports.</span>
            </h1>
            <p className="body-6 intro-description">
              Search annual reports in plain language. Every answer stays connected to the pages and passages behind it.
            </p>
          </div>

          <aside className="collection-summary" aria-label="Collection status">
            <div className="summary-topline">
              <span className="caption-3">YOUR COLLECTION</span>
              <Database size={19} weight="regular" aria-hidden="true" />
            </div>
            <div className="summary-count-row">
              <strong className="summary-count tabular">{documentsLoading ? "…" : documents.length}</strong>
              <span className="body-6 summary-count-label">reports<br />available to search</span>
            </div>
            <div className="summary-divider" />
            <div className="summary-meta"><span className="caption-2">Search method</span><span className="body-5">Dense and keyword retrieval</span></div>
            <div className="summary-meta"><span className="caption-2">Answer model</span><span className="body-5">{apiHealth?.answer_model || "Extractive fallback"}</span></div>
          </aside>
        </section>
          <section className="home-overview" aria-labelledby="overview-title">
            <div className="home-section-heading"><div className="caption-3 section-index">BUILT FOR FINANCIAL RESEARCH</div><h2 id="overview-title" className="heading-4">From long reports to clear answers.</h2><p className="body-6">FinSight helps you explore annual reports in plain language and see the evidence behind each response.</p></div>
            <div className="feature-grid">
              <article className="feature-card"><span className="feature-icon"><MagnifyingGlass size={20} weight="regular" /></span><h3 className="title-2">Ask in plain language</h3><p className="body-6">Search one report or the full collection without hunting through pages manually.</p></article>
              <article className="feature-card"><span className="feature-icon"><FileMagnifyingGlass size={20} weight="regular" /></span><h3 className="title-2">Trace every answer</h3><p className="body-6">Review cited passages and page references to check how an answer was formed.</p></article>
              <article className="feature-card"><span className="feature-icon"><ChartLineUp size={20} weight="regular" /></span><h3 className="title-2">Explore across years</h3><p className="body-6">Ask follow up questions and compare financial figures across reports.</p></article>
            </div>
            <button type="button" className="primary-button button-md home-cta" onClick={() => setActiveTab("research")}>Start researching <ArrowRight size={18} weight="regular" aria-hidden="true" /></button>
          </section>
        </section>

        <section className="tab-view" role="tabpanel" id="research-panel" aria-labelledby="research-tab" hidden={activeTab !== "research"}>
          <div className="tab-heading"><div className="eyebrow"><span className="eyebrow-rule" /> RESEARCH WORKSPACE</div><h1 className="heading-3">Ask FinSight</h1><p className="body-6">Ask a question, then review the answer alongside its cited report evidence.</p></div>
          <div className="research-column">
            <section id="ask" className="ask-panel" aria-labelledby="ask-title">
            <div className="panel-heading">
              <div>
                <div className="caption-3 section-index">RESEARCH WORKSPACE</div>
                <h2 id="ask-title" className="heading-5">Ask your reports</h2>
                <p className="body-6 panel-description">Choose a scope, enter a question, then inspect the cited evidence.</p>
              </div>
              <div className="panel-icon"><MagnifyingGlass size={21} weight="regular" /></div>
            </div>

            <div className="scope-row">
              <div className="scope-switch" role="group" aria-label="Search scope">
                <button type="button" className={scope === "collection" ? "scope-option scope-option-active" : "scope-option"}
                  onClick={() => setScope("collection")} aria-pressed={scope === "collection"}>All reports</button>
                <button type="button" className={scope === "document" ? "scope-option scope-option-active" : "scope-option"}
                  onClick={() => setScope("document")} aria-pressed={scope === "document"}>One report</button>
              </div>
              <span className="caption-4 scope-note">
                {scope === "collection" ? documents.length + " reports in scope" : "Single report in scope"}
              </span>
            </div>

            {scope === "document" && (
              <div className="field-block">
                <label className="caption-3 field-label" htmlFor="report-select">Select a report</label>
                <div className="select-wrap">
                  <select id="report-select" className="form-select body-6" value={selectedDocument}
                    onChange={event => setSelectedDocument(event.target.value)} disabled={!documents.length}>
                    {documents.length === 0 && <option value="">No reports available</option>}
                    {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
                  </select>
                  <CaretDown size={17} weight="regular" aria-hidden="true" />
                </div>
              </div>
            )}

            <form className="question-form" onSubmit={event => { event.preventDefault(); askQuestion(); }}>
              <label className="caption-3 field-label" htmlFor="question-box">Your question</label>
              <div className="question-input-wrap">
                <textarea id="question-box" className="question-input body-3" rows="3" value={question}
                  onChange={event => setQuestion(event.target.value)}
                  placeholder="For example, what risks could affect operating results?"
                  aria-describedby="question-help" />
                <div className="question-input-footer">
                  <span id="question-help" className="caption-5 keyboard-hint">
                    <Command size={15} weight="regular" aria-hidden="true" />
                    Enter to ask <span className="hint-separator" /> Shift and Enter for a new line
                  </span>
                  <button className="primary-button button-md" type="submit" disabled={loading || apiStatus === "offline"}>
                    {loading ? "Searching reports" : "Ask FinSight"}
                    {loading ? <span className="button-progress" aria-hidden="true" /> : <ArrowRight size={18} weight="regular" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </form>

            <div className="suggestion-area">
              <div className="caption-4 suggestion-label"><Sparkle size={16} weight="regular" /> Try a question</div>
              <div className="suggestion-list">
                {suggestions.map(text => (
                  <button type="button" key={text} className="suggestion-button body-6"
                    onClick={() => { setQuestion(text); askQuestion(text); }} disabled={loading || apiStatus === "offline"}>
                    {text}<ArrowUpRight size={15} weight="regular" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>

            <details className="settings-disclosure" open={showSettings} onToggle={event => setShowSettings(event.currentTarget.open)}>
              <summary className="settings-summary">
                <span><SlidersHorizontal size={17} weight="regular" /> Retrieval settings</span>
                <CaretDown size={16} className="settings-caret" weight="regular" />
              </summary>
              <div className="settings-grid">
                <label className="range-control">
                  <span className="range-heading body-5"><span>Retrieval candidates</span><strong className="tabular">{retrievalK}</strong></span>
                  <input type="range" min="10" max="100" step="10" value={retrievalK} onChange={event => setRetrievalK(Number(event.target.value))} />
                  <span className="caption-5">Passages considered before reranking</span>
                </label>
                <label className="range-control">
                  <span className="range-heading body-5"><span>Evidence passages</span><strong className="tabular">{finalK}</strong></span>
                  <input type="range" min="3" max="20" step="1" value={finalK} onChange={event => setFinalK(Number(event.target.value))} />
                  <span className="caption-5">Passages sent to answer generation</span>
                </label>
              </div>
            </details>

            {error && <div className="inline-message message-error" role="alert">
              <WarningCircle size={19} weight="regular" aria-hidden="true" />
              <div><strong className="body-5">The search did not complete</strong><p className="body-6">{error}</p></div>
            </div>}
            {uploadMessage && <div className="inline-message message-success" role="status">
              <CheckCircle size={19} weight="regular" aria-hidden="true" /><p className="body-6">{uploadMessage}</p>
            </div>}
            {uploadError && <div className="inline-message message-error" role="alert">
              <WarningCircle size={19} weight="regular" aria-hidden="true" /><p className="body-6">{uploadError}</p>
            </div>}
          </section>
            {loading && <section className="result-panel loading-panel" aria-label="Preparing your answer" aria-live="polite" aria-busy="true">
          <div className="thinking-header">
            <span className="thinking-spinner" aria-hidden="true" />
            <div className="thinking-copy">
              <div className="caption-3 section-index">FINSIGHT IS WORKING</div>
              <h2 className="heading-5">Searching the reports</h2>
              <p className="body-6">Finding relevant passages and preparing an answer with its sources.</p>
            </div>
            <span className="thinking-status caption-4">In progress</span>
          </div>
          <div className="thinking-track" aria-hidden="true"><span /></div>
          <div className="result-skeleton"><div className="skeleton-line skeleton-answer" /><div className="skeleton-line skeleton-answer" /><div className="skeleton-line skeleton-medium" /></div>
          <div className="source-skeleton-grid"><div className="source-skeleton"><div className="skeleton-line skeleton-short" /><div className="skeleton-line skeleton-answer" /></div><div className="source-skeleton"><div className="skeleton-line skeleton-short" /><div className="skeleton-line skeleton-answer" /></div></div>
        </section>}

        {response && !loading && (
          <section className="result-panel" aria-labelledby="result-title" aria-live="polite">
            <div className="result-heading">
              <div><div className="caption-3 section-index">RESEARCH RESULT</div><h2 id="result-title" className="heading-4">Answer and evidence</h2></div>
              <span className={answer?.status === "answered" ? "result-status result-status-ready" : "result-status"}>
                {answer?.status === "answered" ? <CheckCircle size={17} weight="regular" /> : <Info size={17} weight="regular" />}{answerStatus}
              </span>
            </div>
            <article className="answer-card">
              <div className="answer-card-top"><span className="answer-icon"><Sparkle size={19} weight="regular" /></span>
                <div><div className="title-3">Answer</div><div className="caption-4">{answer?.answer_type || "Evidence response"}</div></div>
              </div>
              <p className="body-3 answer-text">{typeof answer === "string" ? answer : answer?.answer || response?.message || "The API returned a response without answer text."}</p>
              {answer?.note && <p className="caption-2 answer-note">{answer.note}</p>}
            </article>
            {sources.length > 0 && <div className="sources-section">
              <div className="sources-heading"><div><h3 className="title-2">Supporting evidence</h3><p className="caption-2">Open the cited page in the source report to confirm context.</p></div><span className="caption-3 source-count">{sources.length} passages</span></div>
              <div className="source-grid">{sources.map((source, index) =>
                <SourceCard key={source.chunk_id || source.id || (source.filename + "-" + index)} source={source} index={index} />)}
              </div>
            </div>}
            <details className="raw-response"><summary className="caption-4">Inspect response details</summary><pre className="body-6">{JSON.stringify(response, null, 2)}</pre></details>
          </section>
        )}

        {!response && !loading && <section className="empty-result" aria-label="Getting started">
          <div className="empty-mark"><FileMagnifyingGlass size={24} weight="regular" /></div>
          <div><h2 className="title-2">Start with a question</h2><p className="body-6">Search the full collection or select a report. The answer and its source passages will appear here.</p></div>
          <ArrowUpRight className="empty-arrow" size={20} weight="regular" aria-hidden="true" />
        </section>}
          </div>
        </section>

        <section className="tab-view" role="tabpanel" id="library-panel" aria-labelledby="library-tab" hidden={activeTab !== "library"}>
          <div className="tab-heading"><div className="eyebrow"><span className="eyebrow-rule" /> YOUR SOURCES</div><h1 className="heading-3">Report library</h1><p className="body-6">Browse indexed reports or add a PDF to your collection.</p></div>
          <div className="library-page-content"><aside className="library-panel library-page-panel" aria-labelledby="library-title">
            <div className="library-header">
              <div><div className="caption-3 section-index">SOURCE MATERIAL</div><h2 id="library-title" className="heading-5">Report library</h2></div>
              <span className="library-count tabular">{documentsLoading ? "…" : documents.length}</span>
            </div>
            <p className="body-6 library-description">Select a report to focus the next search on one source.</p>

            <div className="document-list">
              {documentsLoading && <><div className="document-skeleton" /><div className="document-skeleton" /><div className="document-skeleton" /></>}
              {!documentsLoading && documents.length === 0 && (
                <div className="empty-library"><BookOpenText size={23} weight="regular" /><p className="body-6">No reports are indexed yet. Add a PDF to start building the collection.</p></div>
              )}
              {!documentsLoading && visibleDocuments.map(doc => (
                <button type="button" className="document-row" key={doc.id} onClick={() => chooseDocument(doc.id)} aria-label={"Search within " + doc.name}>
                  <span className="document-icon"><FilePdf size={20} weight="regular" /></span>
                  <span className="document-details"><span className="body-5 document-name">{doc.name}</span><span className="caption-5">{doc.chunk_count ?? "Indexed"} passages</span></span>
                  <ArrowUpRight className="document-arrow" size={17} weight="regular" aria-hidden="true" />
                </button>
              ))}
            </div>

            {!documentsLoading && documents.length > 5 && (
              <button type="button" className="text-action button-sm" onClick={() => setShowAllDocuments(value => !value)}>
                {showAllDocuments ? "Show fewer reports" : "Browse all " + documents.length + " reports"}
                <ArrowRight size={16} weight="regular" aria-hidden="true" />
              </button>
            )}

            <div className="library-divider" />
            <div className="upload-block">
              <div className="upload-heading">
                <span className="upload-icon"><UploadSimple size={20} weight="regular" /></span>
                <div><h3 className="title-3">Add a report</h3><p className="caption-2">Upload a text PDF to index its pages and tables.</p></div>
              </div>
              <label className={uploading ? "upload-button upload-disabled button-sm" : "upload-button button-sm"}>
                <input type="file" accept="application/pdf,.pdf" disabled={uploading}
                  onChange={event => { const file = event.target.files?.[0]; uploadDocument(file); event.target.value = ""; }} />
                {uploading ? "Adding report" : "Choose PDF"}
                {uploading ? <span className="button-progress" aria-hidden="true" /> : <UploadSimple size={17} weight="regular" aria-hidden="true" />}
              </label>
              <p className="caption-5 upload-note">PDF files up to 50 MB</p>
            </div>

            <div className="retrieval-note">
              <span className="note-icon"><Info size={17} weight="regular" /></span>
              <p className="caption-2">Answers use retrieved passages. Check each cited report page before relying on a figure.</p>
            </div>
          </aside></div>
        </section>

        <footer className="app-footer">
          <span className="caption-5">FinSight · Financial report research</span>
          <a className="caption-5 footer-link" href={API_BASE + "/docs"} target="_blank" rel="noreferrer">API reference <ArrowUpRight size={14} weight="regular" aria-hidden="true" /></a>
        </footer>
      </main>
    </div>
  );
}

function SourceCard({ source, index }) {
  const filename = source.filename || source.document_id || "Source report";
  const page = source.page_number ?? source.page;
  const text = source.supporting_text || source.text || source.content || source.chunk_text || "";
  return (
    <article className="source-card">
      <div className="source-card-header">
        <span className="source-card-icon"><FilePdf size={19} weight="regular" /></span>
        <div className="source-card-title">
          <h4 className="body-5">{filename}</h4>
          <div className="source-tags">
            {source.evidence_id && <span className="source-tag source-tag-accent">[{source.evidence_id}]</span>}
            {page != null && <span className="source-tag">Page {page}</span>}
            {source.basis && source.basis !== "not_explicit" && <span className="source-tag">{source.basis}</span>}
            {source.evidence_type === "table_row" && <span className="source-tag">Table row</span>}
          </div>
        </div>
        <span className="caption-5 source-number">{String(index + 1).padStart(2, "0")}</span>
      </div>
      {text && <p className="body-6 source-text">{text}</p>}
    </article>
  );
}

export default App;
