# Cari AKPK

Pencarian Standar Kompetensi Jabatan Pelaksana ASN berbasis web. Aplikasi ini memungkinkan pencarian cepat across beberapa dokumen regulasi ASN menggunakan SQLite FTS5 full-text search.

## Sumber Dokumen

| Dokumen | Keterangan |
|---|---|
| PERGUB 46/2022 | Peraturan Gubernur tentang Standar Kompetensi Jabatan |
| KEPMENPANRB SKJ.01/2025 | Keputusan Menteri PANRB tentang Standar Kompetensi Jabatan |
| PERMENPAN 38/2017 | Peraturan Menteri PANRB tentang Standar Kompetensi Jabatan |
| PERMENPAN 108/2017 | Peraturan Menteri PANRB tentang Standar Kompetensi Jabatan |

## Tech Stack

- **Framework:** SvelteKit 2 + Svelte 5 (Runes)
- **Build:** Vite 6
- **Database:** SQLite via `better-sqlite3` + FTS5
- **Deployment:** Node adapter + PM2 + Nginx

## Fitur

- Full-text search dengan FTS5 + fallback LIKE
- Phrase match untuk multi-word keyword
- Navigasi hasil per dokumen dengan grouping halaman berurutan
- Detail view dengan card-based content parsing
- Local search within konten (highlight + navigasi match)
- Responsive design (desktop, tablet, mobile)
- Copy-to-clipboard konten dokumen
- Keyboard shortcut: `/` untuk fokus search

## Setup

### Prerequisites

- Node.js 18+
- SQLite database files (`.db`) dengan tabel `pages` (kolom: `page_num`, `title`, `content`, `full_text`)

### Install

```bash
git clone https://github.com/ariefdluffy/cari-akpk.git
cd cari-akpk
npm install
```

### Environment Variables

Set path database via environment variables (opsional, ada fallback default):

```bash
export DB_PERGUB=/path/to/PERGUB_46_2022_metadata.db
export DB_KEPMEN=/path/to/kepmenpanrb_skj001_2025_metadata.db
export DB_PERMEN38=/path/to/permenpan_38_2017_metadata.db
export DB_PERMEN108=/path/to/permen_108_2017_metadata.db
```

### Development

```bash
npm run dev
```

Buka [http://localhost:5173](http://localhost:5173)

### Production Build

```bash
npm run build
npm run preview
```

### Deploy dengan PM2

```bash
npm run build
pm2 start ecosystem.config.cjs
```

Custom port:

```bash
PORT=8080 pm2 start ecosystem.config.cjs
```

### Nginx Reverse Proxy

Contoh konfigurasi ada di `pdf-search-nginx.conf`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Struktur Database

SQLite database harus punya tabel `pages`:

```sql
CREATE TABLE pages (
    page_num INTEGER PRIMARY KEY,
    title TEXT,
    content TEXT,
    full_text TEXT
);
```

Opsional, tambah FTS5 index untuk performa lebih baik:

```sql
CREATE VIRTUAL TABLE pages_fts USING fts5(
    title, content, full_text,
    content=pages,
    content_rowid=rowid
);
```

## Struktur Project

```
├── src/
│   ├── app.html              # HTML template
│   ├── app.d.ts              # TypeScript declarations
│   ├── hooks.server.ts       # CSP headers
│   └── routes/
│       ├── +layout.svelte    # Root layout
│       ├── +page.svelte      # Main page (search + detail UI)
│       └── api/search/
│           └── +server.ts    # Search API endpoint
├── static/                   # Static assets (favicon, logo)
├── ecosystem.config.cjs      # PM2 config
├── pdf-search-nginx.conf     # Nginx config example
├── svelte.config.js
├── vite.config.ts
└── package.json
```

## API

### POST `/api/search`

```json
{
    "keyword": "kompetensi",
    "limit": 20,
    "offset": 0
}
```

Response:

```json
{
    "keyword": "kompetensi",
    "total": 45,
    "totalMatches": 120,
    "returned": 20,
    "hasMore": true,
    "results": [
        {
            "source": "PERGUB 46/2022",
            "page": 5,
            "pageRange": "Halaman 5 - 8",
            "totalPages": 4,
            "title": "Kompetensi Teknis",
            "snippet": "...",
            "full_text": "...",
            "relevance": 150
        }
    ],
    "elapsed_ms": 42,
    "sources": ["PERGUB 46/2022", "KEP MENPANRB SKJ.01/2025", ...]
}
```

## License

Private
