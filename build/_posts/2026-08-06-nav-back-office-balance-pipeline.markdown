---
layout: post
title: "NAV Back-Office Balance Pipeline"
description: "System architecture walkthrough for a job-scheduling and balance ingestion platform built for UTC 00:00 cut-offs."
date: 2026-08-06 08:00:00 +0000
categories: post
tags: [SystemArchitecture, JobScheduling, BalancePipeline, Kafka, gRPC, Redis, S3, RabbitMQ, DotNet, Golang, Python, Fintech, CryptoExchanges, Blockchain, BackOffice]
featured_image: ""
---

**System Architecture Walkthrough**

A job-scheduling and balance-ingestion platform that pulls account balances from 500+ crypto exchanges, blockchains, and equity funds on fixed daily cut-offs — engineered around the fact that most clients want the same cut-off: **UTC 00:00**.

`BASIC + IN-DEPTH` · `KAFKA` · `gRPC` · `REDIS` · `S3 / RABBITMQ` · `.NET · GO · PYTHON`

| | | | |
|---|---|---|---|
| **500+** exchanges, chains & funds covered | **15,000** clients | **66,000** accounts under management | **20,000+** accounts requesting the UTC 00:00 cut-off |

---

## Answering the Brief

Every aspect asked for in the original brief, answered in one line with a link to the full treatment:

| Requested aspect | Short answer |
|---|---|
| Overall system architecture diagram | Two levels — [basic flow (Fig. 02)](#1-basic-architecture) for a CTO read, full [component map (Fig. 03)](#2-detailed-architecture) for an architect read. |
| Microservices and their interactions | Nine services, each broken down in [§2.1–2.9](#21-job-store), wired together in [Fig. 03](#2-detailed-architecture). |
| Kafka (message broker) and event-driven communication | Partitions, ordering, and how it differs from the RabbitMQ leg — [§2.4](#24-kafka--event-driven-communication). |
| Database design and data flow | Job store schema — [§2.1](#21-job-store); job store vs. reporting DB and how data moves — [§4](#4-database-design--data-flow). |
| Caching layer and caching strategy | Two separate caches — credentials and market data — [§2.8](#28-caching-strategy) (Fig. 04). |
| Integration between services and supporting components | Every hop, sync vs. async, protocol and why — [§5](#5-integration-patterns). |
| Architecture diagram illustrating the complete solution | End to end — [component map (Fig. 03)](#2-detailed-architecture) + [single-job sequence (Fig. 05, §3)](#3-end-to-end-job-lifecycle). |

---

## 0. The Core Problem

Exchanges don't expose historical balance. If we don't capture a balance at the moment a client's accounting period closes, that number is gone forever — so balance capture is not a "nice to have" poll, it's the only ledger entry that will ever exist for that slot. Clients pick their own cut-off (once or twice daily), but when **20,000+ of 66,000 accounts** independently pick the same natural boundary — midnight UTC — the system inherits one enormous synchronized burst instead of a smooth trickle.

The architecture below isn't designed to average that burst away. It's designed to **absorb it**: every control-plane hop is sub-second, and the one stage that talks to the outside world (Datafetch) is scaled horizontally wide enough that 20,000 concurrent jobs still land inside a single-digit-second window.

**Fig. 01 — where the 00:00 UTC burst spends its time** *(cumulative time since the schedule tick, for the full 20,000-job burst)*

| Stage | Cumulative time |
|---|---:|
| Scheduler sweep → Kafka publish | 150–200 ms |
| Consumer dispatch (Kafka → gRPC) | 600–700 ms |
| Datafetch execution complete | 7–8 s |

*Data processor time isn't shown — it drains the RabbitMQ queue asynchronously and isn't part of the client-facing SLA.*

> **Why this works**
> Everything before Datafetch (job store → scheduler → Kafka → consumer) is internal bookkeeping and finishes in under a second even at 20k concurrency. The actual network I/O — 20,000 simultaneous round-trips to 500+ third-party exchanges — is pushed onto **280 Datafetch pods** running concurrently, which is what keeps the external burst inside a 7–8 second envelope instead of a multi-minute queue drain.

---

## 1. Basic Architecture

At the highest level this is a five-stage pipeline: a scheduled job is born in a database, handed to a message broker, executed against an external API, and the result is written back through a second, decoupled pipeline into a reporting table.

**Fig. 02 — basic data flow**

<pre class="mermaid">
flowchart LR
    CL["Clients&lt;br/&gt;15k clients · 66k accounts"] --> JS[("Job Store")]
    JS --> SCH["Scheduler"]
    SCH -->|every minute| K[["Kafka"]]
    K --> CO["Consumer"]
    CO --> DF["Datafetch Service"]
    DF <--> EXC[("500+ venues:&lt;br/&gt;exchanges · chains · funds")]
    DF --> S3[("S3&lt;br/&gt;raw balances")]
    DF --> RMQ[["RabbitMQ"]]
    RMQ --> DP["Data Processor"]
    DP --> RDB[("Reporting DB")]
    CO -.status.-> TS["Task Status API"]
    TS -.flush.-> JS
</pre>

### 1.1 What Each Stage Does

- **Job Store** — the source of truth: which account needs a balance pulled, from where, and when.
- **Scheduler** — wakes up every minute, finds due jobs, pushes them onto Kafka in bulk.
- **Kafka** — the buffer that lets 20,000 jobs appear at once without anything falling over.
- **Consumer** — drains Kafka and fans each job out to the Datafetch service.
- **Datafetch Service** — does the actual work: talks to the exchange/chain/fund, gets a balance.
- **S3 + RabbitMQ** — the raw result is parked in object storage and a "come process this" message is dropped on a second queue.
- **Data Processor** — turns the raw payload into the final row a client's accountant actually reads.
- **Task Status API** — the live "is it done yet" layer sitting alongside all of this.

That's the whole story for a CTO-level read. Part II below unpacks every one of these into the actual technology, schema, and failure-handling behind it.

---

## 2. Detailed Architecture

**Fig. 03 — full component & interaction map**

<pre class="mermaid">
flowchart TB
    subgraph CP["Control Plane"]
        JS[("Job Store (SQL)&lt;br/&gt;task_type · user_id · account_id&lt;br/&gt;last_id · last_run_status · retry_count")]
        SCH["Scheduler (.NET)&lt;br/&gt;1×/min sweep of SQL views"]
        TS["Task Status API (.NET)&lt;br/&gt;in-memory status · 10s flush · 3h expiry&lt;br/&gt;dedupes repeat requests"]
    end

    subgraph EB["Event Backbone"]
        K[["Kafka&lt;br/&gt;30 partitions · 3 nodes&lt;br/&gt;ordered bulk publish"]]
    end

    subgraph EP["Execution Plane"]
        CO["Consumer (.NET)&lt;br/&gt;concurrent gRPC, multiplexed"]
        DF["Datafetch Service (Python)&lt;br/&gt;280 k8s pods / 5 bare-metal nodes"]
        AA["Account API (Go)&lt;br/&gt;region + proxy routing"]
        VAULT[("Vault")]
    end

    subgraph CC["Market-Data Cache Chain"]
        M1["In-memory"]
        M2["File-based"]
        M3["Redis"]
        EXC[("500+ venues")]
    end

    subgraph IP["Ingest Pipeline"]
        S3[("AWS S3&lt;br/&gt;raw balance payloads")]
        RMQ[["AWS RabbitMQ"]]
        DP["Data Processor (Python)"]
        RDB[("Reporting DB")]
        DLQ[["Dead Letter Queue"]]
    end

    JS --> SCH
    SCH -->|ordered bulk publish| K
    SCH -.bulk status: ready.-> TS
    K --> CO
    CO -.status: running.-> TS
    CO -->|gRPC, concurrent| DF
    DF -->|gRPC: get creds/config/proxy| AA
    AA --> VAULT
    DF --> M1 --> M2 --> M3 --> EXC
    DF -->|main-account batch| S3
    DF -->|main-account msg| RMQ
    DF -->|sub-account batch| S3
    DF -->|sub-account msg| RMQ
    DF -->|success or fail, t+7-8s| CO
    CO -.completed / failed, retry×3.-> TS
    TS -.flush every 10s.-> JS
    RMQ --> DP
    DP -->|fetch payload| S3
    DP --> RDB
    DP -.fail×3.-> DLQ
</pre>

Note the direction of the middle hop: it's **Datafetch that calls Account API** for credentials and proxy config — not the Consumer. The Consumer only ever talks to Datafetch. Both of these hops (Consumer→Datafetch and Datafetch→Account API) run over **gRPC**, for the same multiplexing reason.

### 2.1 Job Store

A plain SQL database — the only stateful thing the rest of the system treats as ground truth. One row per scheduled task:

| Field | Purpose |
|---|---|
| `task_type` | which kind of pull (main-account, sub-account, etc.) |
| `user_id` / `account_id` | whose balance this is |
| `last_id` | cursor into the source system for incremental pulls |
| `last_run_status` | outcome of the previous attempt |
| `retry_count` | how many times this job has been retried |
| `created_at` / `updated_at` | audit trail |

The Scheduler never queries this table directly at read time — it reads through [SQL views](#4-database-design--data-flow) that pre-filter to "due right now," keeping the per-tick scan cheap even as the table grows.

### 2.2 Task Status API

A .NET service that exists because writing a status update to SQL for every one of 20,000 jobs, on every state transition, would hammer the job store. Instead:

- Status (`ready` → `running` → `completed` / `failed`) lives in memory first.
- Flushed back to the job store every **10 seconds**, batched.
- De-duplicates repeat status requests for the same job — Kafka and retries can both re-signal the same job, and this layer collapses that noise.
- Enforces a **3-hour expiry** per job, so a job that never reports back doesn't sit "running" forever and block the account it belongs to.

### 2.3 Scheduler

A .NET service on a one-minute tick. Each tick:

1. Reads the "due now" SQL view.
2. Publishes the batch to Kafka as a bulk, **ordered** action — ordering matters because retries and cursor-based pulls (`last_id`) need to land in sequence per account.
3. Bulk-publishes a `ready` status for the whole batch to the Task Status API.

Measured completion time for a full 20,000-job tick: **t + 150–200 ms**.

### 2.4 Kafka & Event-Driven Communication

Kafka is the shock absorber between "20,000 jobs became due in the same minute" and "servers process work at a sane, even rate." Configuration: **30 partitions**, **3 nodes** for replication and failover. Two things matter about how it's used here:

- **Ordering** — the scheduler publishes in bulk but preserves order, so downstream retry logic and cursor-based (`last_id`) pulls stay deterministic per account.
- **Partition count vs. consumer parallelism** — 30 partitions is the ceiling on how many consumer instances can read in parallel before any of them sit idle; it was sized to the observed 20k-concurrent burst, not to steady-state volume.

Note there's a **second**, purpose-different broker in this system: **AWS RabbitMQ**, downstream of Datafetch, decoupling "balance was fetched" from "balance was processed into a reportable row." Kafka governs job dispatch; RabbitMQ governs post-fetch processing. They're not interchangeable in this design — Kafka needs the partition/ordering guarantees for job fan-out, RabbitMQ is a simpler work queue for the processing step.

### 2.5 Consumer

A .NET service that drains Kafka and dispatches each job concurrently to the Datafetch service over **gRPC**, chosen specifically for its multiplexing — many concurrent job dispatches share connections instead of opening one socket per job. On the way in it marks a job `running`; on the way out, `completed` or `failed` (with up to **3 retries** on failure) — both reported to the Task Status API.

Measured cumulative completion time from the schedule tick: **t + 600–700 ms** for the full 20,000-job batch.

### 2.6 Account API

A Go service, called *by Datafetch* (not by the Consumer) once per job. Its job is routing and credentials, not fetching:

- Distributes the outbound request across the correct **proxy**, chosen by region and the client's own whitelisting/configuration.
- Holds an **in-memory cache** of API credentials, itself sourced from **Vault** — so Vault isn't hit per-job, only per-cache-miss.

Measured throughput: **20,000 concurrent requests** at **p99 1 ms / p100 40 ms** — the cheapest hop in the whole pipeline, by design, since every one of the 20k jobs passes through it.

### 2.7 Datafetch Service

The only stage that talks to the outside world, and the reason the rest of the system exists. Python, deployed as **280 Kubernetes pods** across **5 on-premise bare-metal nodes** (Hyper-V, 84 Xeon Platinum cores / 250 GB RAM per node). Per job:

1. Calls [Account API](#26-account-api) over gRPC for credentials, config/params, and proxy info.
2. Resolves market data through the [four-tier cache chain](#28-caching-strategy) (in-memory → file → Redis → exchange), decompressing and validating expiry on a hit.
3. Builds a `ccxt` client from the resolved credentials/config.
4. Fetches **main-account balance** across categories via concurrent `aiohttp` requests (DNS caching, timeouts, connection pooling) → writes to S3 → publishes a RabbitMQ message.
5. Fetches **sub-account balance** in a second concurrent batch → writes to S3 → publishes a RabbitMQ message.
6. Returns success/failure to the Consumer.

At the 20,000-job burst, main- and sub-account fetches across categories fan out to roughly **500,000 individual outbound requests** against exchanges, blockchains, and funds — this is the actual internet-facing load the 280-pod fleet exists to spread across. Every response is pushed straight to S3 as it comes back, so a job is never holding a large payload in memory waiting on the rest of the batch.

Measured completion time: **t + 7–8 s** for the full 20,000-job burst — this is the number that everything upstream exists to protect.

### 2.8 Caching Strategy

Two independent caches exist for two different reasons — don't conflate them:

> **Account API — credential cache**
> In-memory only, backed by Vault on miss. Small, hot, security-sensitive — no fallback tiers needed because Vault itself is the durable source.

> **Datafetch — market-data cache**
> A four-tier fallback chain, because market data (order books, symbol metadata, rates) is large, shared across many jobs, and safe to serve slightly stale within an expiry window.

**Fig. 04 — market-data cache fallback chain**

<pre class="mermaid">
flowchart LR
    REQ["Market data request"] --> M1{"In-memory hit?"}
    M1 -- yes --> RET["Return data"]
    M1 -- no --> M2{"File cache hit?"}
    M2 -- yes --> DECOMP["Decompress +&lt;br/&gt;validate expiry"] --> RET
    M2 -- no --> M3{"Redis hit?"}
    M3 -- yes --> DECOMP
    M3 -- no --> EXC["Fetch from exchange"] --> POP["Populate all 3 tiers"] --> RET
</pre>

Each tier is a strictly cheaper miss than the one below it — in-memory is free, file avoids a network hop, Redis avoids hitting a rate-limited third party. The exchange call only happens when all three local tiers miss, which is also the only path that repopulates them.

### 2.9 Data Processor & Reporting DB

A Python service consuming off RabbitMQ. For each message: fetch the corresponding raw object from S3, transform it into the client-facing balance row, write it to the reporting SQL database. On failure, retry up to **3 times**; if still failing, route to a **dead-letter queue** for manual intervention rather than silently dropping a balance that, per §0, can never be re-fetched.

---

## 3. End-to-End Job Lifecycle

One job, start to finish, showing exactly who talks to whom and in what order:

**Fig. 05 — single job sequence**

<pre class="mermaid">
sequenceDiagram
    participant SCH as Scheduler
    participant K as Kafka
    participant CO as Consumer
    participant TS as Task Status API
    participant DF as Datafetch
    participant AA as Account API
    participant EXC as Exchange
    participant S3 as S3
    participant RMQ as RabbitMQ
    participant DP as Data Processor
    participant DB as Reporting DB

    SCH->>K: publish job batch (ordered)
    SCH->>TS: bulk status = ready
    K->>CO: deliver job
    CO->>TS: status = running
    CO->>DF: gRPC dispatch
    DF->>AA: gRPC get credentials + proxy
    AA-->>DF: creds, config, proxy
    DF->>EXC: fetch main + sub-account balance
    DF->>S3: store raw payload (x2)
    DF->>RMQ: publish process message (x2)
    DF-->>CO: success (t+7-8s)
    CO->>TS: status = completed
    RMQ->>DP: consume message
    DP->>S3: fetch raw payload
    DP->>DB: write final balance row
</pre>

---

## 4. Database Design & Data Flow

Two SQL surfaces, deliberately kept separate:

| Store | Written by | Read by | Shape |
|---|---|---|---|
| Job Store | Task Status API (10s flush) | Scheduler (via views) | control-plane: one row per scheduled task |
| Reporting DB | Data Processor | Client-facing accounting/reconciliation tools | ledger-plane: one row per realized balance |

The Scheduler reads **SQL views over the job store** rather than the base table directly — this is what keeps a per-minute sweep cheap regardless of how large the job history grows, since the view pre-filters to jobs due in the current window. Data flows one direction only: control-plane state (job store) never receives data from the ledger plane (reporting DB); the two only meet logically, through `account_id`.

---

## 5. Integration Patterns

Every hop in this system is deliberately either synchronous-and-fast or asynchronous-and-durable — nothing in between:

| Hop | Style | Protocol | Why |
|---|---|---|---|
| Scheduler → Kafka | async | Kafka (ordered, bulk) | absorb the burst, preserve order |
| Consumer → Datafetch | sync | gRPC (multiplexed) | low latency, high fan-out |
| Datafetch → Account API | sync | gRPC (multiplexed) | credentials needed before every fetch |
| Account API → Vault | sync, cached | Vault API | security boundary, cached to avoid per-job cost |
| Datafetch → Exchange | sync | `ccxt` / aiohttp | the actual external dependency |
| Datafetch → S3 / RabbitMQ | async | S3 API + AMQP | decouple fetch from processing |
| \*/ → Task Status API | sync, batched | internal API call | status visibility without hammering SQL |

---

## 6. Reliability & Failure Handling

- **Duplicate jobs** — collapsed at the Task Status API before they ever cause a double-write.
- **Stale jobs** — a 3-hour expiry on in-flight status prevents a hung job from blocking its account indefinitely.
- **Datafetch/Consumer failures** — up to 3 retries at the Consumer layer before a job is marked `failed`.
- **Data Processor failures** — up to 3 retries, then routed to a dead-letter queue for manual recovery rather than silent loss.
- **Kafka node failure** — covered by the 3-node replicated cluster.

---

## 7. Performance & Scale Reference

| Component | Stack | Footprint | Latency / throughput |
|---|---|---|---:|
| Scheduler | .NET | — | t+150–200 ms @ 20k jobs |
| Kafka | — | 30 partitions · 3 nodes | bulk, ordered |
| Consumer | .NET | — | t+600–700 ms @ 20k jobs |
| Account API | Go | — | p99 1 ms / p100 40 ms @ 20k concurrent |
| Datafetch Service | Python | 280 pods / 5 nodes (84 cores · 250 GB RAM each) | t+7–8 s @ 20k jobs, ~500k outbound requests |
| Task Status API | .NET | — | 10s flush cadence · 3h expiry |

---

## 8. Confirmed Decisions

Four points that were open questions in the first pass, now confirmed by the platform team:

- **Job Store and Reporting DB are separate physical databases** — not just logically separate. Control-plane scheduling state and the client-facing ledger never share a database instance.
- **Datafetch → Account API runs over gRPC** — same choice as Consumer → Datafetch, and for the same reason: multiplexed connections under high concurrent fan-out. Reflected in §2.4, §2.7, §3, §5 and Figs. 03 and 05 above.
- **The UTC 00:00 burst is purely absorbed by scale** — there is no jitter, staggering, or randomized offset smoothing client requests away from the exact cut-off. 280 Datafetch pods and 30 Kafka partitions are the entire mitigation; every account that asked for midnight gets exactly midnight.
- **Sub-account fetch happens inside the same Datafetch invocation** as the main-account fetch — a second concurrent internal batch, not a separately scheduled job. One job in the Job Store produces both S3 writes and both RabbitMQ messages.

<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: true, securityLevel: "loose" });
  }
</script>