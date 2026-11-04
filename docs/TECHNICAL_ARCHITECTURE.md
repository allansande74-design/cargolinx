# Technical Architecture: Altovex CargoLinx

Altovex CargoLinx is engineered as a high-performance, offline-first freight desk. It is built to operate in low-connectivity environments while maintaining enterprise-grade security and scalability.

## 1. Infrastructure & Backend
- **Runtime:** Deployed on **Cloudflare Workers** (Edge Computing). The application logic runs at the network edge, reducing latency for users across East Africa.
- **API Architecture:** A hybrid model where static assets are served via Cloudflare Assets and dynamic logic is handled by the Worker.
- **Model Proxy:** A dedicated server-side proxy (`server/proxy.mjs`) manages all AI requests. This ensures that API credentials never reach the client's browser.

## 2. Frontend & User Experience
- **Framework:** Developed using Vanilla ES modules and a custom React-inspired state layer for maximum speed and zero-dependency overhead.
- **Mobile-First Design:** Built using a fluid, responsive grid. The UI is optimized for mobile devices used in warehouses and at borders.
- **PWA (Progressive Web App):**
    - **Manifest:** Full `manifest.webmanifest` for "Add to Home Screen" capability.
    - **Service Worker:** Powered by Workbox to cache the application shell, enabling instant loading and offline access.

## 3. Offline-First Capability
- **Persistence:** Uses **IndexedDB** for durable local storage of all shipments, quotes, and configurations.
- **The Outbox Pattern:** All writes performed offline are stored in an idempotent queue.
- **Synchronization:** A background sync process (`src/lib/sync.js`) monitors connectivity and flushes the outbox to the server upon reconnection, preventing data loss.

## 4. Security & Guards
- **Secret Management:** All API keys are stored as encrypted Cloudflare Worker Secrets.
- **Access Control:** Role-Based Access Control (RBAC) gates the 13 different dashboards (Admin, Buyer, Driver, etc.).
- **AI Guardrails:**
    - **Allowlist:** Only approved models are permitted through the proxy.
    - **Rate Limiting:** Per-address limits prevent API abuse.
    - **Token Caps:** Strict output limits on model responses to control costs.

## 5. Integrated Ledger
The system operates on a single source of truth. Whether a user is in the 'Sourcing' module or the 'Finance' module, they are interacting with the same shipment ledger, ensuring data consistency across the entire trade lifecycle.
