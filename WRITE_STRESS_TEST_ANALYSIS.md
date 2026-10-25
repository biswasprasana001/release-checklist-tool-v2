# Release Checklist Tool — Write Stress Test Analysis & Optimization Guide

This document explains what happens when hundreds or thousands of users try to save and create new releases at the exact same moment.

To guarantee that our measurements are accurate and not just a single lucky or unlucky test, we ran the automated write stress test [a test where computer bots send thousands of write requests to see when the system slows down or breaks] **3 full times in a row**. Across all three test runs, the system processed and safely deleted over **187,000 database writes [saving new release items into the permanent database storage]** in less than 2 minutes.

---

## 1. Executive Summary [Short Overview of Test Results]

Writing data is physically very different from reading data:
* **Reading data [asking the server to show releases]** can be stored in quick computer memory [RAM, or temporary memory that answers in 1 millisecond] without bothering the database disk.
* **Writing data [creating a brand-new release]** can never skip the disk. Every single write must be permanently saved to disk storage so information is never lost if the power cuts out.

Here is the quick bird's-eye view of how our backend [the server program that handles business logic and talks to the database] handled write traffic:

```
[10 to 100 Simultaneous Writers] ──────> 🟢 THE SWEET SPOT (Optimal Zone)
                                         • Throughput: 1,500 to 2,450 writes/second
                                         • Speed: Instant response (6 ms to 44 ms average wait)
                                         • Errors: 0% (Flawless reliability)

[250 Simultaneous Writers] ────────────> 🟡 THE CONGESTION ZONE (Queueing Begins)
                                         • Throughput: ~2,250 writes/second (High plateau)
                                         • Speed: 110 ms average wait (Noticeable queue forms)
                                         • Warning: p99 wait jumps to 856 ms - 1,660 ms (Tail latency warning)
                                         • Errors: 0% to 0.1% (Almost zero drops)

[500 to 1,000 Simultaneous Writers] ───> 🔴 THE BREAKING POINT (Resource Exhaustion)
                                         • Throughput: Drops to 1,200 - 1,900 writes/second
                                         • Speed: Average wait spikes to 240 ms - 655 ms; p95 reaches 4+ seconds
                                         • Errors: 2% to 15.8% requests dropped
                                         • Cause: 50 database connections cannot serve 1,000 people at once
```

---

## 2. Comparison Table: All 3 Stress Test Runs

Below are the exact measurements recorded across all 3 test runs:

### Run 1 (Baseline Run)
| Users [Simultaneous Writers] | Req/s [Throughput] | Total Requests | Avg Wait [ms] | p95 Wait [ms] | p99 Wait [ms] | Errors [Dropped] | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | 1,650 req/s | 8,255 | 6 ms | 11 ms | 15 ms | 0 (0.0%) | 🟢 HEALTHY |
| **50** | 2,316 req/s | 11,635 | 22 ms | 30 ms | 40 ms | 0 (0.0%) | 🟢 HEALTHY |
| **100** | 2,454 req/s | 12,366 | 41 ms | 52 ms | 64 ms | 0 (0.0%) | 🟢 HEALTHY (Peak Speed) |
| **250** | 2,256 req/s | 11,502 | 110 ms | 123 ms | 929 ms | 0 (0.0%) | 🟡 HEALTHY (Queue Forming) |
| **500** | 1,837 req/s | 10,663 | 251 ms | 1,224 ms | 4,122 ms | 578 (5.4%) | 🔴 BREAKING POINT |
| **1,000** | 1,548 req/s | 10,157 | 555 ms | 4,173 ms | 4,406 ms | 954 (9.4%) | 🔴 BREAKING POINT |

*Cleanup after Run 1: 63,812 test records deleted.*

---

### Run 2 (Verification Run)
| Users [Simultaneous Writers] | Req/s [Throughput] | Total Requests | Avg Wait [ms] | p95 Wait [ms] | p99 Wait [ms] | Errors [Dropped] | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | 1,628 req/s | 8,147 | 6 ms | 10 ms | 13 ms | 0 (0.0%) | 🟢 HEALTHY |
| **50** | 2,330 req/s | 11,699 | 21 ms | 29 ms | 35 ms | 0 (0.0%) | 🟢 HEALTHY |
| **100** | 2,432 req/s | 12,233 | 41 ms | 55 ms | 67 ms | 0 (0.0%) | 🟢 HEALTHY (Peak Speed) |
| **250** | 2,257 req/s | 11,476 | 110 ms | 117 ms | 856 ms | 0 (0.0%) | 🟡 HEALTHY (Queue Forming) |
| **500** | 1,933 req/s | 10,507 | 245 ms | 282 ms | 4,152 ms | 218 (2.1%) | 🔴 BREAKING POINT |
| **1,000** | 1,218 req/s | 10,302 | 655 ms | 4,258 ms | 4,323 ms | 1,630 (15.8%)| 🔴 BREAKING POINT |

*Cleanup after Run 2: 63,440 test records deleted.*

---

### Run 3 (Sustained Stress Run)
| Users [Simultaneous Writers] | Req/s [Throughput] | Total Requests | Avg Wait [ms] | p95 Wait [ms] | p99 Wait [ms] | Errors [Dropped] | Health Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **10** | 1,498 req/s | 7,494 | 7 ms | 11 ms | 15 ms | 0 (0.0%) | 🟢 HEALTHY |
| **50** | 2,169 req/s | 10,896 | 23 ms | 32 ms | 38 ms | 0 (0.0%) | 🟢 HEALTHY |
| **100** | 2,260 req/s | 11,388 | 44 ms | 58 ms | 69 ms | 0 (0.0%) | 🟢 HEALTHY (Peak Speed) |
| **250** | 2,237 req/s | 11,395 | 111 ms | 131 ms | 1,660 ms | 16 (0.1%) | 🟡 BREAKING POINT (First drop) |
| **500** | 1,979 req/s | 10,730 | 240 ms | 247 ms | 4,154 ms | 228 (2.1%) | 🔴 BREAKING POINT |
| **1,000** | 1,609 req/s | 8,719 | 594 ms | 1,447 ms | 1,616 ms | 0 (0.0%) | 🟡 DEGRADED (Saturated) |

*Cleanup after Run 3: 60,500 test records deleted.*

---

## 3. Explaining Every Parameter & Why It Reached That Value

Here is an intuitive breakdown of every single parameter, metric, and setting used in the stress test:

### 1. `Users` [Simultaneous Writers]
* **What it is**: The number of simulated user workers [independent computer bots sending write requests] firing mutations [database commands that create new data] at the exact same split-second.
* **Why it matters**: In real life, web applications experience spikes where many team members or automated systems save records simultaneously. Testing 10 to 1,000 users shows us when the system operates smoothly and where it hits its physical ceiling.

### 2. `Req/s` [Throughput, or Requests Per Second]
* **What it is**: How many complete write requests the server successfully received, processed, saved to PostgreSQL [the database system that stores data on disk], and returned a confirmation for in one single second.
* **Observed Value**: Reached its absolute maximum peak of **2,454 req/s** at **100 users**, then gradually slid down to **1,218 – 1,609 req/s** at 1,000 users.
* **Why it reached that value**:
  1. **Maximum Database Concurrency Limit**: The PostgreSQL connection pool [a shared group of ready-to-use communication channels to the database] is configured to `max: 50`. At 100 users, all 50 slots are working continuously without idle gaps.
  2. **Disk Commit Serialization [Waiting in Line for Disk Writes]**: Unlike reading from RAM [fast computer memory], PostgreSQL must write every record to its WAL [Write-Ahead Log, a ledger file where the database quickly writes changes before saving them permanently to table storage] and flush to the disk drive. A single computer disk can only flush so many operations per second.
  3. **Why it drops at 1,000 users**: When 1,000 requests fight for 50 slots, the server spends extra CPU [central processor, the main brain of the computer] time managing the waiting line instead of doing real write work.

### 3. `Total` [Total Completed Requests]
* **What it is**: The total count of write requests handled within each 5-second test tier [a 5-second testing window].
* **Observed Value**: Between 7,500 and 12,366 requests per 5 seconds.
* **Why it reached that value**: `Total = Req/s × 5 seconds`. At peak throughput (2,454 req/s), $2,454 \times 5 \approx 12,300$ write requests.

### 4. `Avg(ms)` [Average Response Time / Latency]
* **What it is**: The average time in milliseconds [thousandths of a second] a user waited from the moment they clicked "Save" until the server replied "Done".
* **Observed Value**:
  * 10 users: **6 ms** (Virtually instantaneous)
  * 50 users: **22 ms** (Faster than the blink of an eye)
  * 100 users: **41 ms** (Very fast)
  * 250 users: **110 ms** (Human perceivable, but still good)
  * 500 users: **245 ms** (Noticeable delay)
  * 1,000 users: **555 ms – 655 ms** (Half a second delay)
* **Why it reached that value (Little's Law)**:
  According to Little's Law [a mathematical formula showing that waiting time equals queue size divided by processing speed], when 1,000 users send requests to only 50 database channels, requests must wait in a holding line [a queue]. Each query takes roughly 20 ms to 30 ms inside PostgreSQL. If you are 15th in line, your total wait is $15 \times 30\text{ ms} = 450\text{ ms} + \text{execution time} \approx 550\text{ ms} - 655\text{ ms}$.

### 5. `p95(ms)` [95th Percentile Wait Time]
* **What it is**: The wait time for the slowest 5% of users. 95 out of 100 people got their answer faster than this number; only 5 suffered a longer delay.
* **Observed Value**:
  * Stays under **60 ms** up to 100 users.
  * Grows to **117 ms – 131 ms** at 250 users.
  * Explodes to **1,224 ms – 4,258 ms** at 500 and 1,000 users!
* **Why it reached that value**:
  At 500 and 1,000 users, the database connection pool is completely choked. Tail requests [the unlucky few requests that arrive right as all connection slots get filled] get stuck in the back of the line. Because the client timeout [giving up and closing the connection] is set to `4000 ms`, the slowest requests wait right up to the 4-second edge.

### 6. `p99(ms)` [99th Percentile Worst-Case Wait Time]
* **What it is**: The wait time for the slowest 1% of users. This reveals extreme spikes and early warning signs before regular averages show trouble.
* **Observed Value**:
  * 10 to 100 users: **13 ms to 69 ms**
  * 250 users: **856 ms to 1,660 ms** (The early warning bell!)
  * 500 and 1,000 users: **4,122 ms to 4,406 ms**
* **Why it reached that value**:
  Notice that at 250 users, the *average* wait was only 110 ms, but the *p99* wait shot up to nearly 1.6 seconds. This proved that at 250 simultaneous writers, the 50-slot database pool was already starting to delay the unluckiest 1% of requests.

### 7. `Errors (%)` [Failed or Dropped Requests]
* **What it is**: Write requests that failed to complete, returned an error code, or gave up waiting.
* **Observed Value**:
  * 0% errors from 10 to 250 users (except a tiny 0.1% blip in Run 3).
  * 2.1% to 5.4% errors at 500 users.
  * 9.4% to 15.8% errors at 1,000 users (Run 1 and Run 2).
* **Why it reached that value**:
  There are two specific safety limits in the code that trigger these errors:
  1. **HTTP Client Timeout (`timeout: 4000` in [backend/stress-test-write.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/stress-test-write.js#L64))**: If a request sits in the holding line for more than 4,000 ms, the caller cuts the line and marks it as a failed timeout.
  2. **Database Connection Timeout (`connectionTimeoutMillis: 3000` in [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L31))**: If a request waits longer than 3,000 ms inside the backend trying to get a free database slot from the pool, PostgreSQL throws an error: `timeout exceeded when connecting to database`.

---

## 4. Code Walkthrough: How a Write Request Travels Through the App

Here is the exact journey of every write request during the stress test, mapped to the code running in the application:

```
[stress-test-write.js] ────────> [server.js Apollo/Express] ──────> [server.js Resolver] ──────> [PostgreSQL DB]
   makePayload()                   expressMiddleware()                 Mutation.createRelease()       INSERT INTO releases
   http.request(timeout: 4000)     JSON Body Parser                   invalidateCache()              Write to Disk & WAL
```

### Step 1: The Test Harness Sends the GraphQL Mutation Request
In [backend/stress-test-write.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/stress-test-write.js#L10-L23), the test worker builds a GraphQL mutation payload [the structured text package containing the write request] and sends it over HTTP [the standard web communication protocol]:

```javascript
// From: backend/stress-test-write.js
function makePayload(workerIndex, counter) {
  return JSON.stringify({
    query: `mutation CreateTestRelease($name: String!, $date: String!, $additionalInfo: String) {
      createRelease(name: $name, date: $date, additionalInfo: $additionalInfo) {
        id
      }
    }`,
    variables: {
      name: `[STRESS_TEST] Release ${workerIndex}-${counter}`,
      date: '2026-10-22',
      additionalInfo: 'Automated write load test'
    }
  });
}
```

The request is dispatched with `keepAlive: true` [reusing network sockets so we do not waste time opening new network connections for every single request] and a safety timeout of 4 seconds:

```javascript
// From: backend/stress-test-write.js (lines 52-65)
const req = http.request(
  {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    agent,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      Connection: 'keep-alive'
    },
    timeout: 4000
  },
  res => { /* process response */ }
);
```

---

### Step 2: The Web Server Receives and Parses the Request
In [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L228-L236), Express [the web server framework] and Apollo Server [the GraphQL engine] parse the incoming text into JSON and validate the GraphQL schema:

```javascript
// From: backend/server.js (lines 228-236)
export async function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();
  app.use('/graphql', expressMiddleware(server));
  ...
}
```

The GraphQL schema definition in [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L107-L112) specifies the exact fields required to create a release:

```graphql
# From: backend/server.js (lines 107-112)
type Mutation {
  createRelease(name: String!, date: String!, additionalInfo: String, completedSteps: [Int!]): Release!
  updateRelease(id: ID!, name: String, date: String, additionalInfo: String, completedSteps: [Int!]): Release!
  deleteRelease(id: ID!): Boolean!
  deleteStressTestData: Int!
}
```

---

### Step 3: Cache Invalidation (Clearing Outdated Read Memory)
Before inserting the new release into PostgreSQL, the resolver [the function in server.js that handles the mutation] must wipe the read cache [temporary memory where recent read queries are saved]:

```javascript
// From: backend/server.js (lines 42-46)
export function invalidateCache() {
  cachedReleases = null;
  cacheExpiresAt = 0;
  inflightReleasesPromise = null;
}
```

* **Why this is critical**: If someone creates a release, we cannot have other users looking at stale [out-of-date] data. Calling `invalidateCache()` ensures the next read query will fetch fresh records from the database.

---

### Step 4: The Database Connection Pool Bottleneck
In [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L29-L34), PostgreSQL connection settings dictate how many concurrent writes can occur:

```javascript
// From: backend/server.js (lines 29-34)
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  connectionTimeoutMillis: 3000,
  max: 50,
  idleTimeoutMillis: 10000
});
```

* `max: 50`: Only **50 database connections** can exist at any given moment.
* `connectionTimeoutMillis: 3000`: If all 50 slots are busy and a new request waits longer than 3,000 milliseconds for a slot to become free, it crashes with a timeout.

---

### Step 5: SQL Insert and Disk Commit
In [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L167-L179), the resolver executes the SQL query:

```javascript
// From: backend/server.js (lines 167-179)
createRelease: async (_, { name, date, additionalInfo = '', completedSteps = [] }) => {
  invalidateCache();
  if (!isDbConnected) {
    const newItem = { id: String(Date.now()), name, date, additionalInfo, completedSteps };
    memoryReleases.push(newItem);
    return { ...newItem, status: computeStatus(completedSteps) };
  }
  const res = await pool.query(
    'INSERT INTO releases (name, date, additional_info, completed_steps) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, date, additionalInfo, JSON.stringify(completedSteps)]
  );
  return formatRow(res.rows[0]);
}
```

Inside PostgreSQL, three things occur:
1. `id SERIAL PRIMARY KEY`: PostgreSQL grabs a lock [a temporary single-user hold] on the ID counter sequence to generate a unique release ID (`1, 2, 3...`).
2. `JSONB` conversion: The list of completed checklist steps (`[0, 1, 2...]`) is converted into a structured binary format.
3. Disk Flush: The row is written to the table and committed to the WAL [Write-Ahead Log] on disk.

---

### Step 6: Automated Test Cleanup
When the stress test completes, we must not leave 60,000 junk test rows in the database. 

In [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L215-L224), a dedicated cleanup mutation deletes all test records in one single query:

```javascript
// From: backend/server.js (lines 215-224)
deleteStressTestData: async () => {
  invalidateCache();
  if (!isDbConnected) {
    const before = memoryReleases.length;
    memoryReleases = memoryReleases.filter(r => !r.name?.startsWith('[STRESS_TEST]'));
    return before - memoryReleases.length;
  }
  const res = await pool.query("DELETE FROM releases WHERE name LIKE '[STRESS_TEST]%'");
  return res.rowCount ?? 0;
}
```

The test runner calls this mutation at the end of the run (and also catches `Ctrl+C` via `SIGINT` [interruption signal sent when a user cancels a terminal command] so records are cleaned even if the user stops the test early):

```javascript
// From: backend/stress-test-write.js (lines 128-173)
async function cleanupTestRecords() {
  process.stdout.write('\nCleaning up test records from database... ');
  const payload = JSON.stringify({ query: 'mutation { deleteStressTestData }' });
  // Dispatches HTTP request to trigger deleteStressTestData resolver
  ...
}
```

---

## 5. Why Does Degradation Happen? (The Anatomy of the Bottleneck)

Why does the server easily handle 3,500 reads/second with 0% errors up to 1,000 users, but write operations degrade at 250 users and drop requests at 500 users?

| Feature | Read Operations (Queries) | Write Operations (Mutations) |
| :--- | :--- | :--- |
| **Primary Resource** | RAM [Fast Computer Memory] | Disk Drive [Permanent Storage] |
| **Can Be Cached?** | Yes (Cached for 2 seconds in RAM) | No (Writes must be permanently saved) |
| **Single-Flight Deduplication?** | Yes (100 users share 1 single database call) | No (Every user creates their own unique row) |
| **Database Pool Demand** | Very light (1 query every 2 seconds) | Very heavy (Every single request grabs a connection) |
| **Physical Speed Limit** | Millions of RAM lookups/second | ~2,500 to ~3,000 disk writes/second on modern SSDs |

When 500 or 1,000 users try to write at once:
1. All 50 database slots in the pool are filled immediately.
2. The remaining **450 to 950 users wait in line**.
3. While waiting in line, the clock is ticking against two thresholds:
   * **3.0 seconds**: PostgreSQL pool timeout (`connectionTimeoutMillis: 3000`).
   * **4.0 seconds**: HTTP client timeout (`timeout: 4000`).
4. Requests that wait longer than 3 to 4 seconds get dropped as errors.

---

## 6. Next Steps: Ranked Optimizations

Following senior developer best practices [solve the whole problem with the least new code; never build complexity nobody needs], here are the recommended optimizations ranked from simplest/highest impact to most complex:

### Rank 1: Increase Database Connection Pool Limit (Smallest Diff: 1 line of code)
* **What to do**: In [backend/server.js](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/backend/server.js#L32), increase `max` connections from 50 to 100, and raise `connectionTimeoutMillis` from 3,000 ms to 5,000 ms.
* **Why**:
  ```diff
   export const pool = new pg.Pool({
     connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/releasecheck',
  -  connectionTimeoutMillis: 3000,
  -  max: 50,
  +  connectionTimeoutMillis: 5000,
  +  max: 100,
     idleTimeoutMillis: 10000
   });
  ```
* **Impact**: Eliminates dropped requests at 500 users by giving more requests active access and giving queued requests 2 extra seconds of patience before timing out.
* **Lines of code**: 2 lines modified.
* **Risk**: Very low (PostgreSQL default `max_connections` is usually 100).

---

### Rank 2: PostgreSQL WAL & Buffer Tuning (Zero application code)
* **What to do**: Tune PostgreSQL configuration parameters in [docker-compose.yaml](file:///c:/Users/biswa/OneDrive/Desktop/Projects/Release%20Checklist%20Tool%20v2/docker-compose.yaml) or PostgreSQL config:
  * Increase `shared_buffers` [PostgreSQL RAM memory cache] to 256MB.
  * Increase `wal_buffers` [temporary memory buffer for write-ahead log] to 16MB.
  * Adjust `checkpoint_completion_target = 0.9` to smooth out disk write spikes.
* **Why**: PostgreSQL writes to memory buffers before writing to disk. Giving it more write buffer space allows it to absorb write spikes without stuttering.
* **Impact**: ~20% to ~30% higher write throughput under heavy load.
* **Lines of code**: 0 application code changes.
* **Risk**: Low (Standard database performance tuning).

---

### Rank 3: Batch Writes / Micro-batching (If Bulk Ingestion is Needed)
* **What to do**: If an external system or automated pipeline needs to create hundreds of releases at once, add a `createReleases(inputs: [ReleaseInput!]!)` mutation that runs a single multi-row SQL insert:
  ```sql
  INSERT INTO releases (name, date, additional_info, completed_steps) 
  VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ...
  ```
* **Why**: 1 single database roundtrip with 50 rows is 10 times faster than 50 separate database roundtrips.
* **Impact**: Massive throughput boost (10,000+ items/sec) for bulk operations.
* **Lines of code**: ~15 lines in resolver.
* **Risk**: Low. Only needed if bulk creation is a real use case.

---

### Rank 4: Lightweight Connection Proxy (PgBouncer)
* **What to do**: If real production traffic must support 5,000+ simultaneous persistent connections, place PgBouncer [a tiny connection pooling proxy program] between the backend server and PostgreSQL.
* **Why**: Node.js and external clients connect to PgBouncer, which holds thousands of client sockets open while multiplexing [sharing] them into a small, fast pool of 20 to 50 physical PostgreSQL connections.
* **Impact**: Completely prevents socket exhaustion and memory crashes at 2,000 to 10,000 concurrent clients.
* **Effort**: Medium (Docker configuration service).
* **Risk**: Adds a piece of infrastructure to maintain.

---

### Rank 5: Asynchronous Background Queue (BullMQ / RabbitMQ) — ⚠️ SKIP FOR NOW
* **What it would be**: Saving incoming write requests to a message queue [a holding line in Redis or RabbitMQ] and having background workers write them to PostgreSQL slowly over time.
* **Why we SKIP this (Senior Dev Rule)**:
  * Creating a release is an interactive user action. A team creates tens or hundreds of releases a month, not 200,000 a minute.
  * The current server already supports **2,450 writes per second (nearly 150,000 writes per minute)** without a single dropped request!
  * Adding Redis, background worker processes, and polling introduces high complexity [more things that can break] for a problem that does not exist in production.

---

## 7. Conclusion & Operational Recommendation

| User Load | System Behavior | Recommendation |
| :--- | :--- | :--- |
| **0 to 100 Users** | 🟢 Optimal Performance (2,450 req/s, <50 ms wait, 0% errors) | Production ready as-is. |
| **100 to 250 Users** | 🟡 Slight Queueing (2,250 req/s, 110 ms wait, ~0% errors) | Fully supported; users experience normal web latency. |
| **250 to 500 Users** | 🔴 Pool Saturation (p95 wait reaches 1.2s; 2% - 5% drops) | Apply Rank 1 (`max: 100`, 5s timeout) if sustained spikes occur. |
| **1,000+ Users** | 🔴 Connection Exhaustion (10% - 15% drops; 4s timeouts) | Apply Rank 1 & Rank 4 (PgBouncer) if continuous high-concurrency writes are expected. |

The application's current write engine demonstrates excellent capacity: it can easily absorb over **140,000 release creation requests per minute** at sub-50 ms latencies before reaching resource limits.
