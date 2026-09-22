# Averon

> Blockchain-based asset tokenization platform — asset-backed financing

Averon is a blockchain-powered platform for tokenizing real-world assets and enabling asset-backed financing. It allows investors to fractionalize ownership of physical/digital assets, trade tokenized shares, and access liquidity without traditional intermediaries.

## Features

- **Asset Tokenization** — Convert physical/digital assets into on-chain tokens with configurable supply, cap, and compliance rules
- **Marketplace** — List, discover, and trade tokenized assets with live pricing
- **AI-Powered Valuation** — Built-in AI engine that estimates fair value for assets using historical data and market signals
- **Compliance Layer** — KYC/AML gating, compliance review status, rate-limited auth, and audit logging
- **Capital Management** — Investment limits, capital allocation tracking, and treasury controls
- **WASM Smart Contracts** — Load and execute WebAssembly-compiled contract logic for high performance
- **Multi-language Judge Pipeline** — Run code in C++, Python, Java via Wandbox/local runners (used for compliance tests)

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Blockchain | Custom WASM-based runtime |
| AI Engine | LLM-powered valuation + confidence scoring |
| Database | SQL (PostgreSQL-compatible schema) |
| Containerization | Docker, docker-compose |
| Process Manager | PM2 (`ecosystem.config.js`) |

## Project Structure

```
Averon/
├── server.js                          # Main Express server entry point
├── blockchain.js                      # Blockchain runtime + token logic
├── marketplace.js                     # Asset marketplace + trading endpoints
├── ai-engine.js                       # AI valuation engine
├── capital.js                         # Capital management + investment limits
├── database.js                        # Database connection + migrations
├── tokenizer.js                       # Asset tokenization logic
├── averon_system_architecture.html    # Visual system architecture
├── backend/                           # Backend services (auth, compliance, audit)
├── frontend/                          # Frontend assets
├── tests/                             # Test suites
├── Dockerfile                         # Container build definition
├── docker-compose.yml                 # Multi-service orchestration
├── ecosystem.config.js               # PM2 process config
└── package.json
```

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (optional, for containerized deployment)
- PostgreSQL-compatible database

### Run locally

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or use PM2 for production
pm2 start ecosystem.config.js
```

### Run with Docker

```bash
docker-compose up -d
```

The server will be available at `http://localhost:3000`.

## API Surface

- `POST /auth/register` — Register a new user (KYC-gated)
- `POST /auth/login` — Login with rate limiting
- `GET /assets` — List tokenized assets
- `POST /assets/tokenize` — Tokenize a new asset
- `GET /marketplace` — Browse the marketplace
- `POST /marketplace/buy` — Buy tokenized shares
- `GET /valuation/:assetId` — Get AI-powered valuation
- `POST /compliance/review` — Submit asset for compliance review

## License

Proprietary — All rights reserved.

## Status

This project is under active development. See the commit history for the latest changes.
