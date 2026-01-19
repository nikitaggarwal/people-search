# People Search Tool

Internal people search platform for talent prospecting and outreach. Search for LinkedIn profiles using natural language queries, export results to CSV, and automatically sync contacts to HubSpot CRM.

## Features

- **Natural Language Search** - Search using queries like "data scientists at OpenAI" or "ML engineers at Meta"
- **LinkedIn Profile Discovery** - Automatically finds and filters LinkedIn profiles
- **Clean Data Extraction** - Parses names, job titles, companies, and bios from profiles
- **Multi-Select Export** - Choose specific profiles to export
- **CSV Export** - Download profile data for use in Clay or other enrichment tools
- **HubSpot CRM Sync** - Automatically creates/updates contacts in HubSpot
- **Duplicate Prevention** - Checks LinkedIn URLs to avoid re-contacting people

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React, TypeScript, Tailwind CSS
- **APIs:** Exa (search), HubSpot (CRM)
- **Utilities:** PapaParser (CSV generation)

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Exa API Key (from https://exa.ai)
EXA_API_KEY=your_exa_api_key_here

# HubSpot Access Token (from HubSpot Private Apps)
HUBSPOT_ACCESS_TOKEN=your_hubspot_token_here
```

### 3. Get API Keys

**Exa API:**
1. Sign up at [https://exa.ai](https://exa.ai)
2. Go to Dashboard → API Keys
3. Copy your API key

**HubSpot API:**
1. Log in to [HubSpot](https://app.hubspot.com)
2. Go to Settings → Integrations → Private Apps (or Legacy Apps)
3. Create a new app with these scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.contacts.write`
4. Copy the access token

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the tool.

## Usage

1. **Search**: Enter a natural language query (e.g., "rubric makers at Scale AI")
2. **Review**: Browse the results table showing names, titles, companies, and LinkedIn URLs
3. **Select**: Check the boxes for profiles you want to export
4. **Export**: Click "Export" to:
   - Download a CSV file with all profile data
   - Automatically sync contacts to HubSpot CRM

## Project Structure

```
app/
├── api/
│   ├── search/route.ts       # Exa API integration & data parsing
│   └── export/route.ts       # CSV generation & HubSpot sync
├── types/index.ts            # TypeScript interfaces
├── page.tsx                  # Main search UI
├── layout.tsx                # Root layout
└── globals.css               # Tailwind styles
```

## How It Works

### Search Flow
1. User enters query → `/api/search` endpoint
2. Calls Exa API with filters for LinkedIn profiles
3. Parses profile data (name, title, company) from page content
4. Returns cleaned data to frontend

### Export Flow
1. User selects profiles → `/api/export` endpoint
2. Searches HubSpot for existing contacts (by LinkedIn URL)
3. Creates new or updates existing contacts
4. Generates CSV file
5. Returns CSV for download

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Import project in [Vercel](https://vercel.com)
3. Add environment variables in Vercel dashboard:
   - `EXA_API_KEY`
   - `HUBSPOT_ACCESS_TOKEN`
4. Deploy!

## Known Limitations

- LinkedIn profiles are login-gated, so data extraction quality varies
- Some profiles may show "Not specified" for title/company if data is unavailable
- Best used as first step in pipeline (get LinkedIn URLs → enrich in Clay)

## License

Internal tool - not for public distribution.
