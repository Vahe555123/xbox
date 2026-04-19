# Xbox Game Search

Full-stack application for browsing and searching Xbox games, powered by the same API that drives [xbox.com/games/browse](https://www.xbox.com/en-US/games/browse).

## Data Extraction Strategy

This project uses the **Emerald API** (`emerald.xboxservices.com/xboxcomfd`) — the exact same public API that powers the Xbox.com browse page. This was discovered by analyzing the network requests made by the Xbox.com frontend JavaScript bundles.

### Why Emerald API?

| Approach | Results | Filters | Pagination | Reliability |
|----------|---------|---------|------------|-------------|
| **Emerald API (chosen)** | 16,000+ games | All 11 categories | Continuation token | Same as Xbox.com |
| DisplayCatalog autosuggest | Max 10 | None | No | Limited |
| DisplayCatalog search | Max 10 per page | None | No usable pagination | Partial |
| HTML scraping | Fragile | Fragile | Complex | Very fragile |

### Two endpoints used:

1. **Browse** (`POST /browse?locale=en-US`): Returns the full catalog of 16,000+ games with all filter options
2. **Search** (`POST /search/games?locale=en-US`): Returns search results matching the Xbox.com search behavior (e.g., 24 results for "mortal kombat")

### Required headers:
- `MS-CV`: Correlation Vector (random base64 string)
- `X-MS-API-Version`: `1.1`
- `Content-Type`: `application/json`

## Architecture

```
xbox/
├── server/          # Express.js backend
│   └── src/
│       ├── app.js              # Express app setup
│       ├── server.js           # Entry point
│       ├── config/             # Environment config
│       ├── routes/             # API routes
│       ├── controllers/        # Request handlers
│       ├── services/           # Business logic + API calls
│       ├── mappers/            # Data transformation
│       ├── validators/         # Request validation
│       ├── middleware/         # Error handling, logging
│       └── utils/             # Axios client, cache, logger
├── client/          # React + Vite frontend
│   └── src/
│       ├── App.jsx
│       ├── pages/             # SearchPage
│       ├── components/        # UI components
│       ├── hooks/             # useSearch hook
│       ├── services/          # API client
│       └── styles/            # CSS
└── README.md
```

## API

### `GET /api/xbox/product/:productId`

Full product details (normalized from Microsoft **Display Catalog** `v7.0/products/{id}` — the same structured source the Store uses for PDPs like [Fortnite on Xbox.com](https://www.xbox.com/en-US/games/store/fortnite/BT5P2X999VH2/0001)).

**Path:** `productId` — Store product id (e.g. `BT5P2X999VH2`, `9N7271QN4SGB`).

**Response:** `{ "success": true, "product": { ... } }` with titles, descriptions, images, videos, CMS trailers, ratings, usage, capabilities, SKUs with prices and availability ids, eligibility strings, related product ids, alternate ids, Xbox flags, support links, and `officialStoreUrl` for the official listing.

### `GET /api/xbox/search`

Browse all games or search by query.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query (optional — omit to browse all) |
| `sort` | string | Sort order (e.g., `ReleaseDate desc`, `Price asc`, `MostPopular desc`) |
| `encodedCT` | string | Continuation token for pagination (from previous response) |
| `Genre` | string | Comma-separated genre filter (e.g., `Shooter,Fighting`) |
| `PlayWith` | string | Platform filter (e.g., `PC,XboxSeriesX\|S`) |
| `Price` | string | Price filter |
| `MaturityRating` | string | Age rating filter |
| `Multiplayer` | string | Multiplayer filter |
| `IncludedInSubscription` | string | Subscription filter |
| `TechnicalFeatures` | string | Technical features filter |
| `Accessibility` | string | Accessibility filter |
| `SupportedLanguages` | string | Language filter |
| `HandheldCompatibility` | string | Handheld compatibility filter |

**Response:**
```json
{
  "success": true,
  "query": "mortal kombat",
  "total": 24,
  "pageSize": 24,
  "products": [...],
  "filters": {
    "orderby": { "title": "Sort by", "choices": [...] },
    "PlayWith": { "title": "Play with", "choices": [...] },
    "Genre": { "title": "Genre", "choices": [...] },
    ...
  },
  "encodedCT": "base64...",
  "hasMorePages": false
}
```

## Filter Categories

All 11 filter categories from Xbox.com are supported:

1. **Sort by** (9 options): Relevance, Release Date, Most Popular, Price, Most Wishlisted, Discount, Title
2. **Play with** (6 options): Xbox Series X|S, Xbox One, PC, Handheld, Cloud Gaming, Xbox Play Anywhere
3. **Accessibility** (33 options): Gameplay, Audio, Visual, Input features
4. **Prices** (7 options): Free, Under $10, $10-$20, etc.
5. **Genre** (21 options): Action, Fighting, Shooter, RPG, etc.
6. **Age Rating** (10 options): ESRB ratings
7. **Multiplayer** (7 options): Local, Online, Co-op, etc.
8. **Technical Features** (8 options): 4K, HDR, 120fps, etc.
9. **Supported Language** (27 options)
10. **Subscriptions** (7 options): Game Pass, EA Play, etc.
11. **Handheld compatibility** (4 options)

## Setup

### Prerequisites
- Node.js 18+

### Install

```bash
# Backend
cd server
cp .env.example .env
npm install

# Frontend
cd ../client
npm install
```

### Run

```bash
# Terminal 1 — Backend (port 4000)
cd server
npm run dev

# Terminal 2 — Frontend (port 5173)
cd client
npm run dev
```

Open http://localhost:5173

- Catalog: `/`
- Game details (in-app, no redirect to Xbox): `/game/:productId`

## Environment Variables

See `server/.env.example` for all options:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Backend port |
| `XBOX_EMERALD_BASE_URL` | `https://emerald.xboxservices.com/xboxcomfd` | Emerald API base |
| `CACHE_TTL` | 300 | Cache TTL in seconds |
| `RATE_LIMIT_MAX_REQUESTS` | 60 | Max requests per window |
| `AXIOS_TIMEOUT` | 15000 | Request timeout in ms |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS origin |

## Limitations

- The Emerald API returns 25 products per page; "Load More" fetches additional pages
- Some products may not have pricing data (unreleased, region-specific, etc.)
- Filter options come from the API and may change over time
- No authentication is used — only public data

## Future Improvements

- URL state preservation (sync filters/sort/search to URL params)
- Wishlist / favorites (local storage)
- Product detail modal
- Price history tracking
- Image lazy loading with blur placeholders
- Server-side caching with Redis
