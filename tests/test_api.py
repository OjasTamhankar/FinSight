from fastapi.testclient import TestClient
import api.main as api_main


class FakeEngine:
    def list_documents(self):
        return [{"document_id": "Annual_Report_TCS_2025", "filename": "Annual_Report_TCS_2025.pdf", "total_pages": 200, "chunk_count": 42}]

    def search(self, question, document_id=None, retrieval_k=50, final_k=10):
        return {
            "question": question,
            "scope": "document" if document_id else "collection",
            "document_id": document_id,
            "result_count": 1,
            "results": [{"rank": 1, "chunk_id": "test_chunk", "document_id": document_id or "Annual_Report_TCS_2025", "filename": "Annual_Report_TCS_2025.pdf", "page_number": 181, "text": "Employee benefit expenses: 145,788 crore", "rrf_score": 0.03, "dense_rank": 2, "bm25_rank": 1}],
        }


def setup_function():
    api_main._engine = FakeEngine()
    api_main._engine_error = None
    api_main._llm_client = api_main.OpenRouterClient(api_key="")


def test_health_ready():
    response = TestClient(api_main.app).get('/health')
    assert response.status_code == 200
    assert response.json()['retrieval_ready'] is True


def test_documents_endpoint():
    response = TestClient(api_main.app).get('/api/documents')
    assert response.status_code == 200
    assert response.json()['documents'][0]['document_id'] == 'Annual_Report_TCS_2025'


def test_collection_query_returns_citation_metadata():
    response = TestClient(api_main.app).post('/api/query', json={'question': 'How much did TCS spend on employee costs in FY2025?'})
    assert response.status_code == 200
    body = response.json()
    assert body['scope'] == 'collection'
    assert body['results'][0]['filename'] == 'Annual_Report_TCS_2025.pdf'
    assert body['results'][0]['page_number'] == 181


def test_document_scope_requires_document_id():
    response = TestClient(api_main.app).post('/api/query', json={'question': 'revenue?', 'scope': 'document'})
    assert response.status_code == 422


def test_document_scope_passes_document_id():
    response = TestClient(api_main.app).post('/api/query', json={'question': 'revenue?', 'scope': 'document', 'document_id': 'Annual_Report_TCS_2025'})
    assert response.status_code == 200
    assert response.json()['document_id'] == 'Annual_Report_TCS_2025'


def test_profit_after_tax_extracts_tcs_shareholder_row():
    question = "What was TCS's consolidated profit after tax attributable to shareholders in FY2025?"
    text = """Financial Performance Overview
The discussions relate to the consolidated financial results.
The following table gives an overview of the consolidated financial results:
FY 2025
FY 2024*
Amount
% of Revenue
% Growth
Amount
% of Revenue
Profit after tax attributable to shareholders of the Company
48,553
19.0
4.2
46,585
19.3
"""
    answer = api_main._build_answer(question, [{
        "rank": 1, "chunk_id": "Annual_Report_TCS_2025_p0088_c001",
        "document_id": "Annual_Report_TCS_2025", "filename": "Annual_Report_TCS_2025.pdf",
        "page_number": 88, "text": text
    }])
    assert answer["status"] == "answered"
    assert "₹48,553 crore" in answer["answer"]
    assert "₹46,585 crore" in answer["answer"]
    assert answer["sources"][0]["page_number"] == 88
    assert answer["sources"][0]["basis"] == "consolidated"


def test_upload_rejects_non_pdf_before_ingestion():
    client = TestClient(api_main.app)
    response = client.post(
        "/api/documents/upload",
        files={"file": ("not-a-pdf.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400
    assert "PDF" in response.json()["detail"]



def test_non_tabular_question_returns_question_relevant_extractive_answer():
    evidence = [
        {
            "rank": 1, "chunk_id": "risk_chunk", "document_id": "SolarEdge2025",
            "filename": "SolarEdge2025Annual Report.pdf", "page_number": 31,
            "text": "The company faces risks related to competition and changes in tax incentives. "
                    "Supply-chain disruption and tariffs may also affect operating results."
        },
        {
            "rank": 2, "chunk_id": "revenue_chunk", "document_id": "SolarEdge2025",
            "filename": "SolarEdge2025Annual Report.pdf", "page_number": 80,
            "text": "Revenue was 1,184,444 thousand dollars in 2025."
        },
    ]
    answer = api_main._build_answer("What risks relate to competition and tax incentives?", evidence)
    assert answer["status"] == "answered"
    assert answer["answer_type"] == "extractive_evidence"
    assert "competition and changes in tax incentives" in answer["answer"]
    assert answer["sources"][0]["page_number"] == 31


def test_fallback_does_not_return_same_generic_message_for_different_questions():
    evidence = [{
        "rank": 1, "chunk_id": "risk_chunk", "document_id": "SolarEdge2025",
        "filename": "SolarEdge2025Annual Report.pdf", "page_number": 31,
        "text": "The company faces risks related to competition and changes in tax incentives."
    }]
    risks = api_main._build_answer("What risks relate to competition?", evidence)
    revenue = api_main._build_answer("What was revenue growth?", evidence)
    assert risks["answer"] != revenue["answer"]
    assert risks["status"] == "answered"
    assert revenue["status"] == "insufficient_evidence"


def test_no_results_returns_insufficient_evidence():
    answer = api_main._build_answer("What was revenue?", [])
    assert answer["status"] == "insufficient_evidence"
    assert answer["sources"] == []


def test_grounded_answer_requires_valid_citations_and_verification():
    from answer_pipeline import generate_grounded_answer

    class FakeClient:
        def __init__(self, responses):
            self.responses = iter(responses)

        def chat(self, messages, *, reasoning=False):
            return next(self.responses)

    evidence = [{
        "chunk_id": "chunk-1", "document_id": "report-1", "filename": "report.pdf",
        "page_number": 4, "text": "Revenue was 125 crore in FY2025.",
    }]
    supported = generate_grounded_answer(
        "What was revenue?", evidence,
        FakeClient(["Revenue was 125 crore in FY2025 [E1].", '{"supported": true, "reason": "Direct match."}']),
    )
    assert supported["status"] == "answered"
    assert supported["answer_type"] == "llm_grounded"
    assert supported["sources"][0]["evidence_id"] == "E1"

    rejected = generate_grounded_answer(
        "What was revenue?", evidence,
        FakeClient(["Revenue was 125 crore [E2].", '{"supported": true, "reason": ""}']),
    )
    assert rejected["status"] == "insufficient_evidence"
    assert rejected["sources"] == []


def test_grounded_answer_abstains_when_verifier_rejects_claim():
    from answer_pipeline import generate_grounded_answer

    class FakeClient:
        def __init__(self):
            self.responses = iter(["Revenue grew 20% [E1].", '{"supported": false, "reason": "No growth evidence."}'])

        def chat(self, messages, *, reasoning=False):
            return next(self.responses)

    answer = generate_grounded_answer(
        "How much did revenue grow?",
        [{"chunk_id": "chunk-1", "filename": "report.pdf", "page_number": 4,
          "text": "Revenue was 125 crore in FY2025."}],
        FakeClient(),
    )
    assert answer["status"] == "insufficient_evidence"


def test_table_evidence_repeats_column_headers():
    from ingestion import _table_evidence

    class FakeTable:
        def extract(self):
            return [["Metric", "FY2025 (₹ crore)"], ["Revenue", "125"]]

    class FakeTables:
        tables = [FakeTable()]

    class FakePage:
        def find_tables(self):
            return FakeTables()

    rows = _table_evidence(FakePage(), 7)
    assert len(rows) == 1
    assert "Metric: Revenue" in rows[0]
    assert "FY2025 (₹ crore): 125" in rows[0]


def test_cross_encoder_results_include_fallback_response_fields(monkeypatch):
    import sentence_transformers
    from retrieval_engine import HybridRetrievalEngine

    class FakeReranker:
        def predict(self, pairs, **kwargs):
            return [0.9 for _ in pairs]

    monkeypatch.setattr(sentence_transformers, "CrossEncoder", lambda *args, **kwargs: FakeReranker())
    engine = object.__new__(HybridRetrievalEngine)
    engine.reranker_model_name = "test-model"
    engine._reranker = None
    engine._reranker_error = None
    engine.chunks = {"chunk-1": {"text": "Revenue was 125 crore."}}
    candidates = [{
        "chunk_id": "chunk-1", "metadata": {"text": "Revenue was 125 crore."},
        "rrf_score": 0.03,
    }]

    ranked = engine._rerank_candidates("What was revenue?", candidates)

    assert ranked[0]["final_score"] == 0.9
    assert ranked[0]["rerank_bonus"] == 0.0
    assert ranked[0]["rerank_features"] == {}
