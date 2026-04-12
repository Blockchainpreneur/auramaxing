# AURAMAXING: Reporte de Integración NotebookLM + LightRAG

**Fecha**: 2026-04-11
**Versión**: AURAMAXING v0.6.1
**Estado general**: Parcialmente operativo — LightRAG funcional, NotebookLM requiere re-autenticación

---

## 1. Arquitectura actual

```
┌─────────────────────────────────────────────────────────────────┐
│                    AURAMAXING AUTOPILOT (Aura)                  │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   RUNTIME    │    │ PRE-COMPUTE  │    │   STORAGE    │      │
│  │  (per prompt)│    │ (background) │    │ (persistent) │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │              │
│         ▼                   ▼                   ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐       │
│  │prompt-engine │    │ precompute  │    │ memory/ (249)│       │
│  │   171ms avg  │    │  pipeline   │    │learnings/(17)│       │
│  └──────┬───────┘    └──────┬───────┘    │prompt-cache/ │       │
│         │                   │            │ lightrag-ws/ │       │
│         ▼                   ▼            └──────────────┘       │
│  ┌─────────────┐    ┌─────────────┐                            │
│  │  LightRAG   │    │ NotebookLM  │                            │
│  │  106ms avg  │    │   (offline) │                            │
│  │  325 docs   │    │  auth expired│                            │
│  │   LOCAL     │    │   CLOUD     │                            │
│  └─────────────┘    └─────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Qué se delega a cada sistema

### LightRAG (nano-vectordb) — Búsqueda semántica LOCAL

| Operación | Quién la llama | Cuándo | Estado |
|---|---|---|---|
| `query` — buscar memoria por similitud | prompt-engine.mjs | Cada prompt | FUNCIONAL |
| `query` — buscar patrones relacionados | memory-enrich.mjs | Cada prompt | FUNCIONAL |
| `ingest` — indexar nueva entrada de prompt | prompt-engine.mjs | Cada prompt (background) | FUNCIONAL |
| `ingest` — indexar toda la memoria | precompute-pipeline.mjs | Post-sesión | FUNCIONAL |
| `ingest` — indexar todas las memorias | lightrag-bridge.mjs (CLI) | Manual | FUNCIONAL |

**Cómo funciona exactamente**:
1. El prompt del usuario llega a `prompt-engine.mjs`
2. Se ejecuta `python3 lightrag-cli.py query --query "texto" --top-k 3`
3. El CLI tokeniza el texto, calcula TF-IDF, y busca por similitud coseno contra 325 documentos indexados
4. Retorna los 3 resultados más relevantes con scores (0.0 a 1.0)
5. El prompt-engine inyecta estos resultados como `[past context]` en el prompt enriquecido

**Datos reales**:
- 325 documentos indexados (163 sesiones, 104 prompts, 48 fallos, 10 éxitos)
- 665 términos en vocabulario
- Índice: 1.2 MB en disco
- Latencia: 106ms promedio por query
- Relevancia: 0.83 promedio (cosine similarity)
- Cobertura: 100% (5/5 queries de prueba retornaron resultados)

---

### NotebookLM — Síntesis y razonamiento en CLOUD

| Operación | Quién la llama | Cuándo | Estado |
|---|---|---|---|
| `ask` — investigación/síntesis | prompt-engine.mjs | Prompts de research (background) | OFFLINE |
| `compress-memory` — comprimir 249 entradas en 3 frases | precompute-pipeline.mjs | Post-sesión | OFFLINE |
| `synthesize learnings` — 17 learnings → 5 reglas | precompute-pipeline.mjs | Post-sesión | OFFLINE |
| `anti-laziness` — generar directivas por tipo de tarea | precompute-pipeline.mjs | Post-sesión | OFFLINE |
| `compress enrichments` — comprimir listas de producción | precompute-pipeline.mjs | Post-sesión | OFFLINE (con fallback) |
| `structure` — estructurar prompts para precisión | notebooklm-bridge.mjs | Manual | OFFLINE |

**Cómo funcionaría (cuando esté autenticado)**:
1. Al terminar una sesión, `precompute-pipeline.mjs` se lanza en background
2. Lee las 249 entradas de memoria y 17 learnings
3. Llama a NLM: "Comprime estos logs en 3 frases" → escribe `session-briefing.txt`
4. Llama a NLM: "Sintetiza estos learnings en 5 reglas" → escribe `learnings-synthesis.txt`
5. Llama a NLM: "Genera anti-laziness para 15 tipos de tarea" → escribe `anti-laziness-{type}.txt`
6. En la siguiente sesión, `session-start.mjs` lee estos caches (50-80 tokens) en vez de memoria raw (200-500 tokens)

**Estado actual**: Auth expirado. Notebook existe (ID: `c5c3bce7`), CLI instalado (v0.3.4), pero todas las llamadas fallan silenciosamente. El pipeline cae al fallback mecánico.

---

## 3. Qué se hace localmente (sin delegación)

| Operación | Archivo | Descripción |
|---|---|---|
| Task routing | rational-router-apex.mjs | Clasifica el prompt en 25+ tipos, calcula complejidad, elige modelo |
| Prompt structuring | prompt-engine.mjs | Agrega anti-laziness estático + quality gates |
| Memory save | prompt-engine.mjs | Guarda cada prompt como JSON en memory/ |
| Memory pruning | session-stop.mjs | Mantiene últimas 50 entradas |
| Self-healing | post-tool-use-apex.mjs | Detecta fallos, sugiere estrategias alternativas |
| Pattern learning | memory-learn.mjs | Registra éxitos/fallos de herramientas con dedup hash |
| PII redaction | pii-redactor.mjs | Bloquea secrets antes de escribir archivos |
| Code quality | code-quality-gate.mjs | Detecta hardcoded secrets y debug code |
| Enrichments | rational-router-apex.mjs | Inyecta requisitos de producción por tipo de tarea |

---

## 4. Flujo de datos completo

### A. Ciclo de una sesión

```
┌─ SESSION START ──────────────────────────────────────┐
│                                                      │
│  session-start.mjs lee (en orden de prioridad):      │
│  1. prompt-cache/session-briefing.txt    ← NLM       │ ← NO EXISTE
│  2. memory/_compressed-summary.json      ← NLM       │ ← NO EXISTE
│  3. memory/*.json (últimas 5 entradas)   ← RAW       │ ← SE USA ESTO
│                                                      │
│  Para learnings:                                     │
│  1. prompt-cache/learnings-synthesis.txt ← NLM       │ ← NO EXISTE
│  2. learnings/*.json (últimos 10)        ← RAW       │ ← SE USA ESTO
│                                                      │
│  Output: [AURAMAXING MEMORY] block (~676 chars)       │
└──────────────────────────────────────────────────────┘
              │
              ▼
┌─ CADA PROMPT ────────────────────────────────────────┐
│                                                      │
│  rational-router-apex.mjs:                           │
│  1. Detecta tipo de tarea (regex matching)           │
│  2. Calcula complejidad (3-85%)                      │
│  3. Lee enrichments-compressed.json      ← EXISTE    │
│  4. Llama prompt-engine.mjs:                         │
│     a. LightRAG query (106ms)            ← FUNCIONAL │
│        → 3 resultados semánticos                     │
│     b. NLM delegation (background)       ← FALLA     │
│     c. Anti-laziness cache               ← NO EXISTE │
│        → Fallback: patrón estático                   │
│     d. Guarda prompt en memory/                      │
│     e. Ingesta prompt en LightRAG (bg)               │
│  5. Output: DISPLAY + DIRECTIVE + ENRICH             │
│                                                      │
│  Total output: ~420 tokens avg                       │
│  Latencia total: ~250ms                              │
└──────────────────────────────────────────────────────┘
              │
              ▼
┌─ SESSION STOP ───────────────────────────────────────┐
│                                                      │
│  session-stop.mjs:                                   │
│  1. Guarda resumen de sesión → memory/               │
│  2. Prune: mantiene últimas 50 entradas              │
│  3. Spawn precompute-pipeline.mjs (background):      │
│     Step 1: Ingest 249+ entries → LightRAG  ✓        │
│     Step 2: NLM compress memory            ✗ (auth)  │
│     Step 3: NLM synthesize learnings       ✗ (auth)  │
│     Step 4: NLM anti-laziness x15          ✗ (auth)  │
│     Step 5: NLM compress enrichments       ✗→fallback│
│  4. Envía resumen al daemon                          │
│                                                      │
│  Resultado: Solo 1/5 steps del pipeline funcionan    │
└──────────────────────────────────────────────────────┘
```

### B. Flujo de datos entre componentes

```
                    ┌──────────┐
                    │  USUARIO │
                    └────┬─────┘
                         │ prompt
                         ▼
              ┌──────────────────┐
              │ rational-router  │─── lee enrichments-compressed.json
              │   (3s budget)    │
              └────────┬─────────┘
                       │ prompt + task type
                       ▼
              ┌──────────────────┐     ┌──────────────┐
              │  prompt-engine   │────→│   LightRAG   │ query → 3 results
              │   (3s budget)    │     │  (106ms avg) │ ingest prompt (bg)
              └────────┬─────────┘     └──────────────┘
                       │                      │
                       │               ┌──────┴──────┐
                       │               │  nano-vdb   │
                       │               │ 325 docs    │
                       │               │ 665 terms   │
                       │               │ 1.2MB index │
                       │               └─────────────┘
                       │
                       ├────→ NLM ask (bg, fire-and-forget) → FALLA
                       │
                       ▼
              ┌──────────────────┐
              │  Output a Claude │
              │  ~420 tokens avg │
              │  PROMPT-ENGINE   │
              │  DISPLAY         │
              │  DIRECTIVE       │
              └──────────────────┘
```

---

## 5. Métricas actuales (benchmark verificado)

| Métrica | Valor | Target | Estado |
|---|---|---|---|
| Tokens/prompt promedio | **420** | <800 | PASS (47% bajo target) |
| Tokens/prompt máximo | **451** | <1200 | PASS (62% bajo target) |
| Latencia prompt-engine | **172ms** | <3000ms | PASS (94% bajo timeout) |
| Latencia LightRAG query | **106ms** | <2000ms | PASS (95% bajo límite) |
| Latencia session-start | **53ms** | <5000ms | PASS (99% bajo timeout) |
| Cobertura semántica | **100%** | >60% | PASS (5/5 queries con resultados) |
| Relevancia promedio | **0.83** | >0.1 | PASS (8.3x sobre mínimo) |
| Documentos indexados | **325** | >50 | PASS (6.5x sobre mínimo) |
| Cache enrichments | **1/3** files | 3/3 | PARCIAL (NLM offline) |
| Ciclo completo | **0 errores** | 0 | PASS |

---

## 6. Qué falta y qué sería ideal

### 6.1 Problemas actuales (ordenados por impacto)

#### ALTO IMPACTO — NotebookLM offline

**Problema**: La autenticación de NLM expiró. 4 de 5 steps del pipeline de pre-computación fallan.

**Impacto**: Sin NLM, no se generan:
- `session-briefing.txt` → Session start usa 5 entries raw (~500 tokens) en vez de briefing sintetizado (~80 tokens)
- `learnings-synthesis.txt` → Se muestran 5 learnings raw (~200 tokens) en vez de 5 reglas (~50 tokens)
- `anti-laziness-{type}.txt` → Se usan frases estáticas que Claude ya ignora por habituación

**Solución**: `notebooklm login` (una vez, interactivo)

**Token savings perdidos**: ~350-450 tokens por prompt que se podrían ahorrar

#### MEDIO IMPACTO — Anti-laziness estático

**Problema**: Las 7 frases anti-laziness son estáticas y repetitivas. Claude las ve 50+ veces por sesión y empieza a ignorarlas (habituación).

**Actual**: `"Read the code first. Show root cause before patching. Write regression test."`

**Ideal con NLM**: Directivas frescas cada sesión, contextualizadas al proyecto y fallos pasados:
```
"La última vez que saltaste el análisis en este proyecto (2026-04-09),
el fix falló 3 veces. Lee los archivos involucrados antes de proponer cambios."
```

#### MEDIO IMPACTO — Memoria sin síntesis

**Problema**: 249 entradas de memoria son JSON verbose con campos mecánicos (`"Worked on: Testing with Playwright — 0 tools used"`). No hay insight extraído.

**Ideal con NLM**: Un briefing de 3 frases que capture:
- Qué proyecto se está construyendo
- Decisiones clave tomadas
- Patrones que funcionaron / que fallaron
- Siguiente paso lógico

#### BAJO IMPACTO — LightRAG sin embeddings neurales

**Problema**: El vectorizer usa TF-IDF local (bag of words), no embeddings neurales. Esto limita la búsqueda semántica a coincidencia de términos.

**Ejemplo**: Query "fixing auth" no encontraría "resolving authentication" porque no comparten tokens.

**Ideal**: Usar `sentence-transformers/all-MiniLM-L6-v2` para embeddings densos (384 dimensiones). Requiere ~500MB de modelo descargado pero da verdadera comprensión semántica.

---

### 6.2 Mejoras ideales (roadmap)

```
TIER 1 — Quick wins (1 acción, alto impacto)
─────────────────────────────────────────────
  1. Re-autenticar NLM: notebooklm login
     → Desbloquea 4/5 steps del pipeline
     → Ahorro: ~350 tokens/prompt adicionales
     → Anti-laziness dinámico activo

TIER 2 — Mejoras de calidad (requieren código)
───────────────────────────────────────────────
  2. Embeddings neurales con sentence-transformers
     → Reemplazar TF-IDF por embeddings densos
     → Query "fixing auth" ↔ "resolving authentication" = match
     → Requiere: pip install sentence-transformers (~500MB)

  3. Memory dedup inteligente
     → 163 session entries son casi idénticas ("Worked on: X — 0 tools used")
     → NLM podría agrupar y comprimir 163 → 20 entradas únicas
     → Reducción de index: 325 docs → ~100 docs útiles

  4. Contexto temporal en queries
     → Ponderar resultados recientes más alto que antiguos
     → Hoy un resultado de hace 3 días tiene mismo peso que uno de hace 5 minutos
     → Implementar decay factor: score * (1 / log(age_hours + 1))

TIER 3 — Visión completa (requiere diseño)
───────────────────────────────────────────
  5. Knowledge graph via LightRAG completo
     → lightrag-hku con Gemini API para extracción de entidades
     → Construir grafo: "auth module" → "depends on" → "session store"
     → Queries tipo: "qué se rompe si cambio el auth?" → grafo de dependencias
     → Requiere: Google API key (costo variable)

  6. CLAUDE.md dinámico
     → El CLAUDE.md global tiene ~6,000 tokens cargados SIEMPRE
     → NLM segmenta por tipo de tarea: solo secciones relevantes
     → "bug-fix" no necesita las instrucciones de "deploy" o "browser automation"
     → Ahorro potencial: ~4,000 tokens/prompt

  7. Feedback loop cerrado
     → Cuando Claude usa un resultado de LightRAG exitosamente, boost su score
     → Cuando ignora un resultado, reducir su relevancia
     → Self-tuning: el índice mejora con cada sesión
     → Implementar: hook PostToolUse que detecta si se usó el contexto inyectado

  8. Pipeline proactivo (launchd)
     → Correr precompute cada 6 horas via launchd (no solo en SessionStop)
     → Mantener caches frescos incluso entre sesiones
     → Auto-refresh de NLM auth si detecta expiración
```

---

## 7. Resumen ejecutivo

### Lo que tenemos

| Capa | Tecnología | Qué hace | Funciona |
|---|---|---|---|
| **Vector search** | nano-vectordb (Python) | Búsqueda semántica sobre 325 docs de memoria | SI |
| **Bridge** | lightrag-bridge.mjs | Node↔Python con cache 30min | SI |
| **Síntesis** | NotebookLM CLI (Python) | Compresión y razonamiento cloud | NO (auth expirado) |
| **Pipeline** | precompute-pipeline.mjs | 5 pasos post-sesión | 1/5 funcional |
| **Runtime** | prompt-engine.mjs | Enriquecimiento de prompts | SI (con fallbacks) |
| **Anti-laziness** | prompt-engine.mjs | Prevenir respuestas lazy | PARCIAL (estático) |
| **Self-heal** | self-heal.mjs | Aprender de fallos/éxitos | SI |

### Token efficiency

```
ANTES de la integración:    ~1,200 - 2,750 tokens/prompt
AHORA (LightRAG activo):    ~420 tokens/prompt avg    (↓ 65-85%)
IDEAL (NLM + LightRAG):     ~250 tokens/prompt est    (↓ 80-91%)
```

### Siguiente paso

```bash
# 1. Re-autenticar NLM (desbloquea todo el pipeline)
notebooklm login

# 2. Correr pipeline completo
node ~/auramaxing/helpers/precompute-pipeline.mjs

# 3. Verificar resultados
ls -la ~/.auramaxing/prompt-cache/
cat ~/.auramaxing/prompt-cache/session-briefing.txt
cat ~/.auramaxing/prompt-cache/learnings-synthesis.txt

# 4. Re-correr benchmark
node ~/auramaxing/tests/benchmark-integration.mjs
```
