# Hive Mind Ad Optimizer

## Project Structure

```
├── src/                  # Backend (Node.js)
│   ├── api/              # Route handlers / controllers
│   ├── services/         # Business logic
│   └── utils/            # Shared utilities
├── frontend/             # Frontend (React)
├── .env.example          # Environment variable template
└── package.json
```

## Getting Started

1. Copy `.env.example` to `.env` and fill in values
2. Install backend deps: `npm install`
3. Install frontend deps: `cd frontend && npm install`
4. Run backend: `npm run dev`
5. Run frontend: `cd frontend && npm start`
