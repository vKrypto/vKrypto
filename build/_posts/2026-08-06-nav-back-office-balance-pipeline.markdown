---
layout: post
title: "NAV Back-Office Balance Pipeline"
description: "System architecture walkthrough for a job-scheduling and balance ingestion platform built for UTC 00:00 cut-offs."
date: 2026-08-06 08:00:00 +0000
categories: post
tags: [SystemArchitecture, JobScheduling, BalancePipeline, Kafka, gRPC, Redis, S3, RabbitMQ, DotNet, Golang, Python, Fintech, CryptoExchanges, Blockchain, BackOffice]
featured_image: ""
---

# NAV Back-Office Balance Pipeline

**System Architecture Walkthrough**

A job-scheduling and balance-ingestion platform that pulls account balances from 500+ crypto exchanges, blockchains, and equity funds on fixed daily cut-offs — engineered around the fact that most clients want the same cut-off: **UTC 00:00**.

`BASIC + IN-DEPTH` · `KAFKA` · `gRPC` · `REDIS` · `S3 / RABBITMQ` · `.NET · GO · PYTHON`

| | | | |
|---|---|---|---|
| **500+** exchanges, chains & funds covered | **15,000** clients | **66,000** accounts under management | **20,000+** accounts requesting the UTC 00:00 cut-off |

---

## Contents

- [Answering the Brief](#answering-the-brief)
- [0. The Core Problem](#0-the-core-problem)

**Part I — Basic Architecture**
- [1. Basic Architecture](#1-basic-architecture)
- [1.1 What Each Stage Does](#11-what-each-stage-does)

**Part II — In-Depth Architecture**
- [2. Detailed Architecture](#2-detailed-architecture)
- [2.1 Job Store](#21-job-store)
- [2.2 Task Status API](#22-task-status-api)
- [2.3 Scheduler](#23-scheduler)
- [2.4 Kafka & Event-Driven Communication](#24-kafka--event-driven-communication)
- [2.5 Consumer](#25-consumer)
- [2.6 Account API](#26-account-api)
- [2.7 Datafetch Service](#27-datafetch-service)
- [2.8 Caching Strategy](#28-caching-strategy)
- [2.9 Data Processor & Reporting DB](#29-data-processor--reporting-db)
- [3. End-to-End Job Lifecycle](#3-end-to-end-job-lifecycle)
- [4. Database Design & Data Flow](#4-database-design--data-flow)
- [5. Integration Patterns](#5-integration-patterns)
- [6. Reliability & Failure Handling](#6-reliability--failure-handling)
- [7. Performance & Scale Reference](#7-performance--scale-reference)
- [8. Confirmed Decisions](#8-confirmed-decisions)

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

...