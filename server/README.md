# TRI-Q&A online AI API (v0.4 preparation)

Separate Node.js backend for live online rule lookups. It does not change the existing v0.3 static site.

## Render setup
Create a new Web Service from bjorndal1/TRI-QA, runtime Node, root directory `server`, build command `echo ready`, start command `npm start`, region Frankfurt. Add the secret `OPENAI_API_KEY` via Render environment settings (never commit it). Optional: `OPENAI_MODEL` and `ALLOWED_ORIGIN=https://tri-qa.onrender.com`.

Endpoint: POST /api/ask with JSON `{"question":"...","language":"da","module":"rules","history":[]}`. Health: GET /health.

**Important:** The existing static front end is not yet connected to this backend. This code is a development starting point, not an audited or production-ready rules verification engine. The model may cite an official source without reliably validating page numbers. Before release, implement deterministic primary-source PDF extraction and paragraph/page verification, abuse protection, access controls and cost limits. The response's `verified` field only means machine-readable URL citations exist, not that the rule has been independently verified.
