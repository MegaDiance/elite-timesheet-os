# Elite Timesheet OS Pro

This is a full-stack monorepo for the Elite Timesheet OS Pro application.

## Tech Stack
- **Frontend**: React + TypeScript + Vite + TailwindCSS
- **Backend**: Node.js + TypeScript + Express
- **Database**: PostgreSQL
- **Workspace Manager**: npm workspaces

## Setup

1. Install dependencies for all workspaces:
   \`\`\`bash
   npm install
   \`\`\`

2. Copy the environment configuration:
   \`\`\`bash
   cp .env.example .env
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   \`\`\`

3. Start the PostgreSQL database:
   \`\`\`bash
   docker compose up -d
   \`\`\`

4. Run the database migrations:
   \`\`\`bash
   cd backend
   npm run migrate up
   cd ..
   \`\`\`

## Development

To start both the frontend and backend development servers concurrently:

\`\`\`bash
npm run dev
\`\`\`

- Frontend runs on `http://localhost:3000`
- Backend API runs on `http://localhost:4000`

## Legacy Migration

The original application relied on local `index.html` files and `localStorage`.
A migration script is provided in the backend to ingest this data into the new PostgreSQL schema.
