# AI Model Integration: Altovex CargoLinx

CargoLinx integrates a multi-model AI layer to automate clerical tasks while keeping the financial core deterministic.

## 1. The Model Stack
| Model | Purpose | Implementation |
|---|---|---|
| **Muse Spark 1.3** | Reasoning & Extraction | Explains quotes and structures free-text notes into shipment fields. |
| **Muse Voice** | Speech-to-Text | Transcribes driver voice notes (16 kHz mono WAV) into text. |
| **SAM 3.1** | Visual Segmentation | Counts cargo items (e.g., pallets) from photographs. |
| **Muse Wonder** | Blind Judging | Orchestrates three parallel drafts and picks the best response. |
| **Muse Image** | Illustration | Generates visual representations of the load for customers. |

## 2. The "Facts-First" Architecture
To prevent "AI hallucinations" in pricing, CargoLinx separates **computation** from **explanation**:
1. **The Engine Computes:** The Landed Cost engine calculates the price based on dated statutory rates.
2. **The Model Explains:** Muse Spark is handed these computed figures as "FACTS" and is strictly forbidden from inventing or rounding numbers.
3. **The Result:** The customer receives a plain-language explanation, but the arithmetic is 100% deterministic.

## 3. Safety & Governance
- **Credential Isolation:** The Meta API key is isolated in a server-side secret; it never touches the client.
- **Contributor Refusal:** The proxy explicitly refuses "contributor" models to ensure data privacy.
- **Determinism:** AI is used for description and extraction, never for setting the base price or the duty band.

## 4. Evidence of Performance
Every AI call is logged with its HTTP status, latency, and token usage. These records are maintained in `docs/evidence/` to provide a verifiable audit trail of the system's reliability.
