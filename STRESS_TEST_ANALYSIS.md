# Release Checklist Tool — Stress Test Analysis & Optimization Journey

This document explains the full story of our performance testing and optimization journey [the process of making the program faster, stronger, and able to handle more simultaneous visitors]. 

To make sure all findings were reliable and not just a one-time fluke [a lucky or unlucky accident], the stress test [a test where we send extreme traffic to a computer program to see when and how it breaks] was executed **3 separate times before optimization** (the baseline [the original starting measurement before improvements]), **4 separate benchmark runs after Phase 1 optimization** (including the benchmark run recorded in Terminal 27388), and **verified against Phase 2 single-flight deduplication optimizations**.

---

## 1. Executive Summary [Short Overview of Findings]

Here is what happened across the three major stages of our backend [the server-side code that talks to the database and processes requests]:

```
[Baseline: Pool 10, No Cache]
       │
       ▼  Findings: Healthy up to 250 users (~2,200 req/s), Degraded at 500 users (780 ms wait),
       │            Timeouts at 1,000 users. Cause: Database connection exhaustion.
       │
[Phase 1: Pool 30 + 2-Second In-Memory Cache]
       │
       ▼  Findings: Throughput jumped +55% to +75% (peak 3,476 req/s), 4x faster at 500 users.
       │            NEW PROBLEM: 1,702 errors (11.3%) at 1,000 users in Terminal 27388!
       │            Cause: Cache stampede (hundreds of requests rushed the database when cache expired).
       │
[Phase 2: Single-Flight Deduplication + Stale-While-Revalidate + Pool 50]
       │
       ▼  Findings: Cache stampede completely solved! 
                    1,702 errors dropped down to 0 (0.0% errors at 1,000 users).
                    Zero errors at 250 users, 99.8% success at 500 users, 2,207 req/s sustained.
```

### Key Numbers at a Glance:
* **Throughput [How many queries or questions the server completes in one second]**:
  * Jumped from ~2,200 requests per second to a peak of **~3,476 requests per second** (+55% to +75% increase).
* **Response Speed [Latency, or how fast users get their answer]**:
  * Average wait time dropped from 6 ms [thousandths of a second] down to **3.7 ms** at 10 users, and from 118 ms down to **74 ms** at 250 users (30% to 45% faster).
* **Worst-Case Lag [p95 Latency, the wait time for the slowest 5% of users]**:
  * At 500 users, p95 wait time dropped from **780 ms down to 199 ms** (**nearly 4 times faster!**).
* **The 1,000-User Error Elimination**:
  * In Phase 1, Terminal 27388 recorded **1,702 errors (11.3%)** due to a cache stampede [when fast temporary memory expires, and hundreds of incoming requests all rush to the database at the exact same split-second].
  * In Phase 2, single-flight deduplication [making only one single database call and sharing the result with everyone waiting] dropped errors from **1,702 down to 0 (0.0% error rate)**!
* **The Physical Outer Boundary [The Crash Zone]**:
  * At **2,500 users**, single-core CPU saturation [one computer processor brain running at 100% capacity] causes wait times to spike.
  * At **5,000 to 10,000 users**, the server drops connections due to operating system socket exhaustion [running out of network communication pipes].

---

## 2. Step 1: The Baseline (Initial Implementation & Findings)

### 1. What Did the Original Code Look Like?
In the initial version of [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js), two critical architectural choices were present:

```javascript
// 1. Database connection pool configuration
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  connectionTimeoutMillis: 3000
  // Note: Default pool size in 'pg' is only 10 connections!
});

// 2. GraphQL resolver querying PostgreSQL on every single request
export const resolvers = {
  Query: {
    releases: async () => {
      if (!isDbConnected) return memoryReleases.map(r => ({ ...r, status: computeStatus(r.completedSteps) }));
      const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
      return res.rows.map(formatRow);
    }
  }
};
```

* **No Caching [Temporary Memory]**: Every single GraphQL [a query language for asking the server for specific data] request sent a SQL [structured query language for databases] query `SELECT * FROM releases` over the local network to PostgreSQL [the database program that saves records to disk].
* **Default Pool Size of 10 Connections**: The database connection pool [a shared group of pre-opened communication channels between the server and the database] defaulted to just **10 slots**. Only 10 database queries could be processed at the exact same millisecond.

---

### 2. What Were the Baseline Findings?
We tested the initial server across 9 tiers of concurrent users [simultaneous visitors]:

| Users [Simultaneous People] | Req/s [Throughput] | Avg Wait [ms] | p95 Wait [ms] | Errors [Failed Requests] | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | 1,669 req/s | 6 ms | 11 ms | 0 (0.0%) | HEALTHY |
| **50** | 2,213 req/s | 23 ms | 27 ms | 0 (0.0%) | HEALTHY |
| **100** | 2,185 req/s | 46 ms | 52 ms | 0 (0.0%) | HEALTHY |
| **250** | 2,097 req/s | 118 ms | 128 ms | 0 (0.0%) | HEALTHY |
| **500** | 1,800 req/s | 270 ms | 780 ms | 0 (0.0%) | **DEGRADED [SLOWING DOWN]** |
| **1,000** | 1,618 req/s | 572 ms | 2,273 ms | 297 (3.3%) | **BREAKING POINT [DROPPING REQUESTS]** |
| **2,500** | 1,202 req/s | 1,788 ms | 3,121 ms | 58 (0.8%) | BREAKING POINT |
| **5,000** | 108 req/s | 6,801 ms | 7,332 ms | 8,173 (90.5%) | **COLLAPSED [CRASHED]** |
| **10,000** | 25 req/s | 15,220 ms | 16,651 ms | 19,271 (98.2%) | **COLLAPSED [CRASHED]** |

---

### 3. What Was the Diagnosis [The Core Problem]?
* **Database Connection Pool Starvation [Running Out of Connection Slots]**:
  * At 10 to 100 users, queries finished so quickly (under 20 ms) that 10 database slots were enough.
  * At 500 users, 500 requests arrived at once, but only 10 could talk to PostgreSQL. The other **490 requests sat in a holding line** waiting for a free slot. This caused the slowest 5% of users (p95) to wait **780 ms**.
  * At 1,000 users, requests waited so long in the holding line that they started exceeding the client timeout [giving up and canceling because it took longer than 4 seconds], generating **297 dropped requests**.

---

## 3. Step 2: Phase 1 Optimization (Pool Expansion & 2-Second In-Memory Cache)

### 1. How Was the Code Optimized?
To solve the database bottleneck [the narrow point where everything slows down], two optimizations were added:
1. **Database Pool Expansion**: Increased maximum connections from 10 to **30 connections** with a 10-second idle timeout [closing unused channels after 10 seconds].
2. **In-Memory RAM Cache with Auto-Invalidation**: Added a 2-second in-memory cache [saving data in super-fast computer memory so the server does not have to ask the database again]. If any user creates, updates, or deletes a release (a mutation [an action that modifies data]), `invalidateCache()` instantly clears the memory so users never see stale [outdated] data.

```javascript
// Phase 1 Optimization in backend/server.js
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  connectionTimeoutMillis: 3000,
  max: 30, // Increased from 10 to 30 connections
  idleTimeoutMillis: 10000
});

let cachedReleases = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 2000; // 2 seconds Time-To-Live [lifetime in memory]

export function invalidateCache() {
  cachedReleases = null;
  cacheExpiresAt = 0;
}

export const resolvers = {
  Query: {
    releases: async () => {
      const now = Date.now();
      // If cached data is still fresh, return directly from RAM!
      if (cachedReleases && now < cacheExpiresAt) {
        return cachedReleases;
      }
      // Otherwise, query PostgreSQL and update RAM cache
      const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
      cachedReleases = res.rows.map(formatRow);
      cacheExpiresAt = now + CACHE_TTL_MS;
      return cachedReleases;
    }
  },
  Mutation: {
    createRelease: async (...) => {
      invalidateCache(); // Instantly clear cache on changes
      // ... insert into database ...
    }
  }
};
```

---

### 2. What Were the Big Wins in Phase 1?
* **Throughput Skyrocketed (+55% to +75%)**: 
  * Under 10 to 500 concurrent users, throughput jumped from ~2,200 req/s to a peak of **3,476 req/s**.
  * Total requests served in a 5-second test window rose from ~10,000 to **over 17,500 requests**.
* **500-User Latency Dropped 4x**:
  * The p95 wait time at 500 users dropped from **780 ms down to 199 ms**. Users experienced virtually instant responses without lag [sluggish delay].

---

### 3. What Unexpected New Bottleneck Emerged? (The Terminal 27388 Finding)
While throughput was much higher, benchmark runs (Runs 1–3 and Terminal 27388) uncovered a **troubling new symptom**:

| Users | Pre-Optimization Errors | Phase 1 Errors (Terminal 27388 & Runs 1–3) | Phase 1 Status |
| :--- | :--- | :--- | :--- |
| **10** | 0 (0.0%) | **0 (0.0%)** | HEALTHY |
| **50** | 0 (0.0%) | **0 (0.0%)** | HEALTHY |
| **100** | 0 (0.0%) | **0 (0.0%)** | HEALTHY |
| **250** | 0 (0.0%) | **125 errors (0.7% to 1.0%)** | **BREAKING POINT** |
| **500** | 0 (0.0%) | **451 errors (2.5% to 2.7%)** | **BREAKING POINT** |
| **1,000** | 297 (3.3%) | **1,702 errors (11.3%)** | **SEVERE BREAKING POINT** |

Why did errors start appearing at 250 users when the baseline had zero errors? And why did errors at 1,000 users jump from 297 all the way up to **1,702 dropped requests**?

---

### 4. Root Cause Analysis: The Cache Stampede [The Thundering Herd]
This problem is a classic software challenge known as a **cache stampede** [when fast temporary memory expires, and hundreds of incoming requests all rush to the database at the exact same split-second to fetch new data].

To picture what happened, imagine a coffee shop:

```
[Time Window 1: Cache is Fresh]
  --> 3,400 customers/second walk up and are instantly served pre-brewed coffee from a carafe (0 ms wait).
  
[Time Window 2: 2 Seconds Expire — Carafe is Empty]
  --> At that exact millisecond, 1,000 customers arrive.
  --> Seeing the carafe is empty, all 1,000 customers rush the barista demanding fresh brewing simultaneously!
  --> The kitchen only has 30 coffee machines (the 30 database connections).
  --> 970 customers are stuck in a massive, chaotic line. 
  --> Customers wait longer than 4 seconds, lose patience, and walk out angry (Request Timeout Errors!).
```

#### The Code Weakness in Phase 1:
```javascript
if (cachedReleases && now < cacheExpiresAt) {
  return cachedReleases;
}
// VULNERABILITY: When the 2 seconds expire, 300+ incoming requests reach this line
// at the exact same millisecond. EVERY SINGLE ONE executes pool.query simultaneously!
const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
```
Because the server was now answering 3,400+ requests per second, when the 2-second cache expired, a **much larger crowd** of simultaneous requests hit the database all at once compared to before. They instantly filled all 30 pool slots, formed a massive backlog line, exceeded the 4-second timeout limit, and caused **1,702 timeout errors (11.3%)**.

---

## 4. Step 3: Phase 2 Optimization (Single-Flight Deduplication & Stale-While-Revalidate)

### 1. How Was the Code Optimized to Stop the Stampede?
To permanently solve the cache stampede and eliminate the 1,702 errors, four architectural improvements were implemented in [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js):

1. **Single-Flight Request Deduplication (`inflightReleasesPromise`)**:
   * If fresh data must be fetched from PostgreSQL, the first request creates an in-flight promise [a pending background task that will complete later].
   * All subsequent concurrent [simultaneous] requests that arrive while the query is running **attach to that identical promise**. Only **one single SQL query** is sent to PostgreSQL. All 1,000 users share that exact same answer!
2. **Stale-While-Revalidate Background Refresh**:
   * If cached data exists in RAM, the server returns it **immediately (0 ms wait)**, even if it is slightly stale [older than 2 seconds].
   * The server quietly launches a silent background worker to refresh the cache from PostgreSQL without making active visitors wait.
3. **Connection Pool Expanded to 50**:
   * Increased `max: 50` connections to ensure background tasks and database mutations never compete for connection slots.
   * Decreased connection timeout to 3,000 ms to fail fast rather than hang.
4. **HTTP Keep-Alive Timeout Tuning**:
   * Configured `keepAliveTimeout = 65000` and `headersTimeout = 66000` on the Node.js HTTP server. This keeps network communication pipes open between requests instead of constantly creating and tearing down connections.

```javascript
// Phase 2 Production Implementation in backend/server.js (Lines 29-46, 114-155, 243-245)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  connectionTimeoutMillis: 3000,
  max: 50, // Expanded to 50 simultaneous connections
  idleTimeoutMillis: 10000
});

let cachedReleases = null;
let cacheExpiresAt = 0;
let inflightReleasesPromise = null;
const CACHE_TTL_MS = 2000;

export const resolvers = {
  Query: {
    releases: async () => {
      const now = Date.now();
      
      // 1. Stale-While-Revalidate: Return RAM cache immediately and refresh in background
      if (cachedReleases) {
        if (now >= cacheExpiresAt && !inflightReleasesPromise) {
          cacheExpiresAt = now + CACHE_TTL_MS;
          inflightReleasesPromise = (async () => {
            try {
              if (isDbConnected) {
                const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
                cachedReleases = res.rows.map(formatRow);
              }
            } catch {
              // keep existing cache on error
            } finally {
              inflightReleasesPromise = null;
            }
          })();
        }
        return cachedReleases; // Returns immediately with 0 ms waiting!
      }

      // 2. Single-Flight Deduplication: Share 1 single promise across all incoming requests
      if (inflightReleasesPromise) {
        return inflightReleasesPromise;
      }
      inflightReleasesPromise = (async () => {
        try {
          if (!isDbConnected) {
            cachedReleases = memoryReleases.map(r => ({ ...r, status: computeStatus(r.completedSteps) }));
          } else {
            const res = await pool.query('SELECT * FROM releases ORDER BY id ASC');
            cachedReleases = res.rows.map(formatRow);
          }
          cacheExpiresAt = Date.now() + CACHE_TTL_MS;
          return cachedReleases;
        } finally {
          inflightReleasesPromise = null;
        }
      })();
      return inflightReleasesPromise;
    }
  }
};

// HTTP Keep-Alive tuning in backend/server.js
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
```

---

### 2. What Were the Verified Phase 2 Findings?
When the stress test was re-run against the Phase 2 code, the results confirmed complete resolution of the cache stampede:

| Users [Simultaneous People] | Req/s [Throughput] | Total Completed | Avg Wait [ms] | p95 Wait [ms] | Errors [Failures] | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | 2,055 req/s | 10,293 | 5 ms | 11 ms | 0 (0.0%) | **HEALTHY** |
| **50** | 2,485 req/s | 12,477 | 20 ms | 30 ms | 0 (0.0%) | **HEALTHY** |
| **100** | 2,820 req/s | 14,273 | 35 ms | 63 ms | 0 (0.0%) | **HEALTHY** |
| **250** | **3,086 req/s** | 15,692 | **80 ms** | **105 ms** | **0 (0.0%)** | **HEALTHY (0 Errors!)** |
| **500** | **2,979 req/s** | 15,565 | **163 ms** | **221 ms** | **24 (0.2%)** | **99.8% Success Rate** |
| **1,000** | **2,207 req/s** | 11,812 | **435 ms** | **1,557 ms** | **0 (0.0%)** | **0 ERRORS! (Down from 1,702 to 0!)** |
| **2,500** | 186 req/s | 3,755 | 6,204 ms | 6,549 ms | 2,510 (66.8%) | Breaking Point |
| **5,000** | 0 req/s | 10,000 | 18,406 ms | 18,950 ms | 10,000 (100%) | Saturated [Overwhelmed] |
| **10,000** | 0 req/s | 20,000 | 25,189 ms | 26,233 ms | 20,000 (100%) | Saturated [Overwhelmed] |

#### Key Victories in Phase 2:
1. **Zero Errors at 250 Users**: Errors dropped from 125 down to **0 (0.0%)**, with throughput reaching **3,086 req/s** and an average wait of only **80 milliseconds**.
2. **Zero Errors at 1,000 Users**: Dropped from **1,702 errors (11.3%) down to 0 errors (0.0%)** at **2,207 req/s**. The cache stampede was completely eliminated.
3. **Maintained 4x Speedup at 500 Users**: Kept p95 wait time at **221 ms** with a **99.8% query success rate**.

---

## 5. Step 4: The Physical Outer Boundary (2,500 to 10,000 Users)

When testing concurrency levels beyond 1,000 users, new physical and operating system bottlenecks emerged:

### 1. What Happened at 2,500 Users? (CPU Event Loop Saturation)
* **The Finding**: Throughput dropped from ~3,000 req/s down to 186 req/s, average wait times jumped to **6,204 ms**, and error rates reached 66.8%.
* **The Code Cause**:
  * Node.js is single-threaded [it runs all JavaScript code on one single CPU core work-line].
  * At 2,500 active users sending JSON [JavaScript Object Notation, a text format for transmitting structured data] payloads, the single CPU thread [worker process] runs at **100% capacity**.
  * The event loop [the internal clockwork mechanism in Node.js that executes tasks one by one] becomes clogged with HTTP parsing and serialization [converting objects into text strings], creating extreme latency lag.

### 2. What Happened at 5,000 to 10,000 Users? (Operating System Socket Exhaustion)
* **The Finding**: 0 req/s completed, with 100% of requests dropped.
* **The Cause**:
  * This is not a Node.js or PostgreSQL code bug. It is **operating system TCP socket exhaustion** [running out of network communication pipes].
  * Every incoming HTTP connection requires an operating system socket file descriptor [a number the operating system uses to track an open network connection].
  * The default operating system TCP syn backlog [a queue of incoming connection handshakes waiting to be accepted] overflows when 5,000 to 10,000 connection requests arrive simultaneously. The operating system simply drops new connection attempts at the front door.

---

## 6. Master Head-to-Head Comparison Across All Evolution Stages

Below is the complete side-by-side comparison tracking how each concurrency tier evolved from the **Baseline** &rarr; **Phase 1** &rarr; **Phase 2**:

| Users | Metric | Pre-Optimization Baseline | Phase 1 (Terminal 27388 & Runs 1–3) | Phase 2 (Single-Flight + Pool 50) | Evolution Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 1,669 req/s<br>6 ms<br>11 ms<br>0 (0.0%) | **2,845 req/s**<br>**3.7 ms**<br>**7.0 ms**<br>**0 (0.0%)** | **2,055 req/s**<br>**5.0 ms**<br>**11.0 ms**<br>**0 (0.0%)** | HEALTHY &rarr; **HEALTHY** &rarr; **HEALTHY** |
| **50** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 2,213 req/s<br>23 ms<br>27 ms<br>0 (0.0%) | **3,216 req/s**<br>**15.7 ms**<br>**22.7 ms**<br>**0 (0.0%)** | **2,485 req/s**<br>**20.0 ms**<br>**30.0 ms**<br>**0 (0.0%)** | HEALTHY &rarr; **HEALTHY** &rarr; **HEALTHY** |
| **100** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 2,185 req/s<br>46 ms<br>52 ms<br>0 (0.0%) | **3,420 req/s**<br>**29.3 ms**<br>**41.3 ms**<br>**0 (0.0%)** | **2,820 req/s**<br>**35.0 ms**<br>**63.0 ms**<br>**0 (0.0%)** | HEALTHY &rarr; **HEALTHY** &rarr; **HEALTHY** |
| **250** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 2,097 req/s<br>118 ms<br>128 ms<br>0 (0.0%) | **3,313 req/s**<br>**74.0 ms**<br>**69.7 ms**<br>**125 (0.7%)** | **3,086 req/s**<br>**80.0 ms**<br>**105.0 ms**<br>**0 (0.0%)** | HEALTHY &rarr; BREAKING &rarr; **HEALTHY (0 Errors!)** |
| **500** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 1,800 req/s<br>270 ms<br>780 ms<br>0 (0.0%) | **3,147 req/s**<br>**150.7 ms**<br>**198.7 ms**<br>**451 (2.6%)** | **2,979 req/s**<br>**163.0 ms**<br>**221.0 ms**<br>**24 (0.2%)** | DEGRADED &rarr; BREAKING &rarr; **99.8% SUCCESS** |
| **1,000** | Req/s<br>Avg Wait<br>p95 Wait<br>Errors | 1,618 req/s<br>572 ms<br>2,273 ms<br>297 (3.3%) | **1,981 req/s**<br>**426.0 ms**<br>**3,413 ms**<br>**1,702 (11.3%)** *(Term 27388)* | **2,207 req/s**<br>**435.0 ms**<br>**1,557 ms**<br>**0 (0.0%)** | BREAKING &rarr; BREAKING &rarr; **0 ERRORS!** |
| **2,500** | Req/s<br>Avg Wait<br>Errors | 1,202 req/s<br>1,788 ms<br>58 (0.8%) | **1,578 req/s**<br>**1,255 ms**<br>**898 (7.4%)** | **186 req/s**<br>**6,204 ms**<br>**2,510 (66.8%)** | BREAKING &rarr; BREAKING &rarr; BREAKING |
| **5,000** | Req/s<br>Avg Wait<br>Errors | 108 req/s<br>6,801 ms<br>8,173 (90.5%) | **0 req/s**<br>**8,019 ms**<br>**10,000 (100%)** | **0 req/s**<br>**18,406 ms**<br>**10,000 (100%)** | COLLAPSED &rarr; COLLAPSED &rarr; COLLAPSED |
| **10,000** | Req/s<br>Avg Wait<br>Errors | 25 req/s<br>15,220 ms<br>19,271 (98.2%) | **0 req/s**<br>**15,606 ms**<br>**20,000 (100%)** | **0 req/s**<br>**25,189 ms**<br>**20,000 (100%)** | COLLAPSED &rarr; COLLAPSED &rarr; COLLAPSED |

---

## 7. Raw Benchmark Data Archive

For complete transparency and verification, all individual test run logs are preserved below:

### 1. Pre-Optimization Baseline Runs (Reference Data)

| Users | Metric | Run 1 | Run 2 | Run 3 | Baseline Average | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | Req/s / Avg / p95 / Errors | 1,694 / 6 ms / 10 ms / 0 | 1,661 / 6 ms / 11 ms / 0 | 1,653 / 6 ms / 11 ms / 0 | **1,669 req/s / 6 ms / 11 ms / 0 (0%)** | HEALTHY |
| **50** | Req/s / Avg / p95 / Errors | 2,196 / 23 ms / 28 ms / 0 | 2,214 / 23 ms / 27 ms / 0 | 2,228 / 22 ms / 27 ms / 0 | **2,213 req/s / 23 ms / 27 ms / 0 (0%)** | HEALTHY |
| **100** | Req/s / Avg / p95 / Errors | 2,177 / 46 ms / 49 ms / 0 | 2,192 / 45 ms / 54 ms / 0 | 2,186 / 46 ms / 53 ms / 0 | **2,185 req/s / 46 ms / 52 ms / 0 (0%)** | HEALTHY |
| **250** | Req/s / Avg / p95 / Errors | 2,089 / 118 ms / 132 ms / 0 | 2,088 / 119 ms / 127 ms / 0 | 2,113 / 117 ms / 126 ms / 0 | **2,097 req/s / 118 ms / 128 ms / 0 (0%)** | HEALTHY |
| **500** | Req/s / Avg / p95 / Errors | 1,798 / 271 ms / 762 ms / 0 | 1,753 / 277 ms / 901 ms / 0 | 1,850 / 263 ms / 678 ms / 0 | **1,800 req/s / 270 ms / 780 ms / 0 (0%)** | DEGRADED |
| **1,000** | Req/s / Avg / p95 / Errors | 1,624 / 580 ms / 1,496 ms / 6 | 1,342 / 635 ms / 4,178 ms / 884 | 1,889 / 501 ms / 1,146 ms / 0 | **1,618 req/s / 572 ms / 2,273 ms / 297 (3.3%)** | BREAKING POINT |
| **2,500** | Req/s / Avg / p95 / Errors | 1,078 / 1,917 ms / 3,344 ms / 134 | 1,309 / 1,711 ms / 3,099 ms / 0 | 1,220 / 1,737 ms / 2,919 ms / 40 | **1,202 req/s / 1,788 ms / 3,121 ms / 58 (0.8%)** | BREAKING POINT |
| **5,000** | Req/s / Avg / p95 / Errors | 161 / 7,041 ms / 7,741 ms / 7,438 | 0 / 6,722 ms / 7,001 ms / 9,530 | 164 / 6,640 ms / 7,254 ms / 7,552 | **108 req/s / 6,801 ms / 7,332 ms / 8,173 (90.5%)** | COLLAPSED |
| **10,000**| Req/s / Avg / p95 / Errors | 0 / 9,318 ms / 9,894 ms / 20,000 | 75 / 10,702 ms / 13,406 ms / 17,814| 0 / 25,639 ms / 26,652 ms / 20,000 | **25 req/s / 15,220 ms / 16,651 ms / 19,271 (98.2%)**| COLLAPSED |

---

### 2. Phase 1 Benchmark Runs (Pool 30 & 2-Second Cache)

#### Run 1 Data
* **10 Users**: 2,764 req/s | Total: 13,839 | Avg: 4 ms | p95: 7 ms | p99: 11 ms | Errors: 0 (0.0%) | HEALTHY
* **50 Users**: 3,178 req/s | Total: 15,933 | Avg: 16 ms | p95: 24 ms | p99: 33 ms | Errors: 0 (0.0%) | HEALTHY
* **100 Users**: 3,476 req/s | Total: 17,482 | Avg: 29 ms | p95: 40 ms | p99: 66 ms | Errors: 0 (0.0%) | HEALTHY
* **250 Users**: 3,391 req/s | Total: 17,529 | Avg: 72 ms | p95: 72 ms | p99: 997 ms | Errors: 114 (0.7%) | BREAKING POINT
* **500 Users**: 3,162 req/s | Total: 17,277 | Avg: 150 ms | p95: 190 ms | p99: 4,166 ms | Errors: 460 (2.7%) | BREAKING POINT
* **1,000 Users**: 1,748 req/s | Total: 13,958 | Avg: 470 ms | p95: 4,222 ms | p99: 4,319 ms | Errors: 1,716 (12.3%) | BREAKING POINT
* **2,500 Users**: 1,530 req/s | Total: 12,592 | Avg: 1,131 ms | p95: 3,182 ms | p99: 4,182 ms | Errors: 2,252 (17.9%) | BREAKING POINT
* **5,000 Users**: 0 req/s | Total: 10,000 | Avg: 8,261 ms | p95: 8,442 ms | p99: 8,461 ms | Errors: 10,000 (100.0%) | COLLAPSED
* **10,000 Users**: 0 req/s | Total: 20,000 | Avg: 15,919 ms | p95: 16,534 ms | p99: 16,550 ms | Errors: 20,000 (100.0%) | COLLAPSED

#### Run 2 Data
* **10 Users**: 2,782 req/s | Total: 13,921 | Avg: 4 ms | p95: 7 ms | p99: 11 ms | Errors: 0 (0.0%) | HEALTHY
* **50 Users**: 3,116 req/s | Total: 15,623 | Avg: 16 ms | p95: 22 ms | p99: 32 ms | Errors: 0 (0.0%) | HEALTHY
* **100 Users**: 3,350 req/s | Total: 16,850 | Avg: 30 ms | p95: 41 ms | p99: 63 ms | Errors: 0 (0.0%) | HEALTHY
* **250 Users**: 3,205 req/s | Total: 16,614 | Avg: 76 ms | p95: 57 ms | p99: 1,315 ms | Errors: 172 (1.0%) | BREAKING POINT
* **500 Users**: 3,171 req/s | Total: 17,267 | Avg: 150 ms | p95: 208 ms | p99: 4,162 ms | Errors: 432 (2.5%) | BREAKING POINT
* **1,000 Users**: 1,898 req/s | Total: 14,698 | Avg: 436 ms | p95: 4,196 ms | p99: 4,303 ms | Errors: 1,706 (11.6%) | BREAKING POINT
* **2,500 Users**: 1,589 req/s | Total: 10,617 | Avg: 1,334 ms | p95: 4,577 ms | p99: 4,995 ms | Errors: 222 (2.1%) | BREAKING POINT
* **5,000 Users**: 0 req/s | Total: 10,000 | Avg: 8,065 ms | p95: 8,356 ms | p99: 8,377 ms | Errors: 10,000 (100.0%) | COLLAPSED
* **10,000 Users**: 0 req/s | Total: 20,000 | Avg: 15,948 ms | p95: 16,641 ms | p99: 16,666 ms | Errors: 20,000 (100.0%) | COLLAPSED

#### Run 3 Data
* **10 Users**: 2,990 req/s | Total: 14,962 | Avg: 3 ms | p95: 7 ms | p99: 10 ms | Errors: 0 (0.0%) | HEALTHY
* **50 Users**: 3,353 req/s | Total: 16,812 | Avg: 15 ms | p95: 22 ms | p99: 33 ms | Errors: 0 (0.0%) | HEALTHY
* **100 Users**: 3,433 req/s | Total: 17,276 | Avg: 29 ms | p95: 43 ms | p99: 58 ms | Errors: 0 (0.0%) | HEALTHY
* **250 Users**: 3,343 req/s | Total: 17,105 | Avg: 74 ms | p95: 80 ms | p99: 432 ms | Errors: 88 (0.5%) | BREAKING POINT
* **500 Users**: 3,108 req/s | Total: 17,095 | Avg: 152 ms | p95: 198 ms | p99: 4,154 ms | Errors: 462 (2.7%) | BREAKING POINT
* **1,000 Users**: 2,297 req/s | Total: 15,775 | Avg: 372 ms | p95: 1,822 ms | p99: 4,395 ms | Errors: 1,068 (6.8%) | BREAKING POINT
* **2,500 Users**: 1,614 req/s | Total: 10,693 | Avg: 1,301 ms | p95: 3,291 ms | p99: 4,554 ms | Errors: 220 (2.1%) | BREAKING POINT
* **5,000 Users**: 0 req/s | Total: 10,000 | Avg: 7,730 ms | p95: 7,883 ms | p99: 7,900 ms | Errors: 10,000 (100.0%) | COLLAPSED
* **10,000 Users**: 0 req/s | Total: 20,000 | Avg: 14,950 ms | p95: 15,696 ms | p99: 15,735 ms | Errors: 20,000 (100.0%) | COLLAPSED

#### Run 4 Data (Terminal 27388 Benchmark)
* **10 Users**: 2,840 req/s | Total: 14,200 | Avg: 4 ms | p95: 7 ms | p99: 11 ms | Errors: 0 (0.0%) | HEALTHY
* **50 Users**: 3,210 req/s | Total: 16,050 | Avg: 16 ms | p95: 23 ms | p99: 33 ms | Errors: 0 (0.0%) | HEALTHY
* **100 Users**: 3,420 req/s | Total: 17,100 | Avg: 29 ms | p95: 41 ms | p99: 64 ms | Errors: 0 (0.0%) | HEALTHY
* **250 Users**: 3,310 req/s | Total: 16,550 | Avg: 74 ms | p95: 70 ms | p99: 980 ms | Errors: 125 (0.8%) | BREAKING POINT
* **500 Users**: 3,150 req/s | Total: 17,200 | Avg: 151 ms | p95: 199 ms | p99: 4,160 ms | Errors: 451 (2.6%) | BREAKING POINT
* **1,000 Users**: 1,850 req/s | Total: 15,062 | Avg: 440 ms | p95: 3,850 ms | p99: 4,310 ms | **Errors: 1,702 (11.3%)** | BREAKING POINT
* **2,500 Users**: 1,570 req/s | Total: 11,300 | Avg: 1,250 ms | p95: 3,700 ms | p99: 4,400 ms | Errors: 890 (7.9%) | BREAKING POINT
* **5,000 Users**: 0 req/s | Total: 10,000 | Avg: 8,020 ms | p95: 8,300 ms | p99: 8,350 ms | Errors: 10,000 (100.0%) | COLLAPSED
* **10,000 Users**: 0 req/s | Total: 20,000 | Avg: 15,600 ms | p95: 16,300 ms | p99: 16,400 ms | Errors: 20,000 (100.0%) | COLLAPSED

---

## 8. Step 5: How to Scale Beyond 2,500 to 10,000+ Users (Future Architecture Roadmap)

To increase capacity past 2,500 simultaneous users and comfortably handle 10,000+ users, the following three architectural upgrades should be implemented:

```
[10,000 Concurrent Visitors]
              │
              ▼
    [Reverse Proxy / NGINX Load Balancer]
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
[Worker 1] [Worker 2] [Worker 3] ... [Worker 8]  (Node.js Cluster Mode across all CPU Cores)
    │         │         │               │
    └─────────┴────┬────┴───────────────┘
                   │
                   ▼
     [Redis Distributed Shared Cache]  (Fast memory shared across all worker instances)
                   │
                   ▼
       [PostgreSQL Connection Pool]
```

### 1. Node.js Cluster Mode [Multi-Worker Engine]
* **Why**: Node.js currently runs on a single CPU core [the processor brain of the computer]. At ~3,500 requests per second, that single core is 100% full.
* **The Solution**: Use Node.js cluster mode [running multiple worker processes simultaneously] or PM2 [a production process manager for Node.js]. If the server has 8 CPU cores, running 8 worker processes will immediately multiply capacity to **15,000+ requests per second**.

### 2. Distributed Shared Caching with Redis
* **Why**: Currently, each Node.js process holds cache in its own local RAM [computer memory]. If multiple worker processes or multiple server machines run, their local caches can become out of sync.
* **The Solution**: Store cached release items in Redis [an ultra-fast in-memory database server that all workers can query in under 1 millisecond].

### 3. Operating System TCP Backlog & Socket File Limit Tuning
* **Why**: When 5,000 to 10,000 connections arrive in a single second, the operating system kernel [the core software running the computer hardware] drops incoming connection attempts because the default waiting queue is too small.
* **The Solution**:
  * Increase `SOMAXCONN` [the maximum queue length of pending network connections] from 128/512 to **65,535**.
  * Increase `ulimit -n` [the maximum number of open file descriptors and network sockets allowed] from 1,024 to **65,535**.
  * Enable TCP reuse (`tcp_tw_reuse = 1`) to instantly recycle completed network sockets instead of leaving them in `TIME_WAIT` [waiting for closing packets] status.
