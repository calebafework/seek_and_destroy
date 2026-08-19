# Handoff — vulnlab: vulnerable pentest lab environments

Paste this into the new chat (and attach `meridian-lab.zip` + `bazaar-lab.zip` if
you want the new chat to edit the actual files). It captures the full state,
decisions, and next steps so work can continue without re-explaining.

---

## What this is

Building deliberately-vulnerable, real-world-style pentest **training labs**
(think OWASP Juice Shop / Kubernetes Goat) for **vulnlab**, a single-user,
pull-and-run local platform. Each lab is a self-contained bundle that vulnlab's
**Worker** (the deployer) stands up in a disposable, network-isolated **kind**
cluster, one per session. Labs cover web + API + Kubernetes attack surface with
lateral movement and multiple takeover paths.

> ⚠️ Every lab is intentionally insecure. Deploy ONLY into a throwaway, offline
> kind cluster. Never expose to a public network; never reuse the code.

### Platform terminology (settled)
- **Control plane** = vulnlab's API + Worker + Mongo/RabbitMQ/Elasticsearch.
  (Caleb previously called this the "orchestrator"; reserve "orchestrator" for
  Kubernetes itself.)
- **Worker** = lab deployer / lifecycle agent (consumes Rabbit jobs).
- **Lab** = the vulnerable target bundle.

---

## Status at a glance

| Lab | id | shape | status |
|-----|----|-------|--------|
| Lab 1 · Meridian Bank | `meridian-bank` | linear (deep) | **fully built**, statically validated, not yet run on a live cluster |
| Lab 2 · Bazaar | `bazaar-market` | parallel (wide) | **design sketch + lab.yaml skeleton only** (no service code) |

"Statically validated" = chart YAML parses, all Node services pass `node --check`,
`lab.yaml` parses, `checker.ts` type-checks under `tsc --strict`, `smoke-test.sh`
passes `bash -n`, CI YAML parses. **Not** yet run end-to-end against a real kind
cluster — first live pass is the CI smoke job or `bash orchestrator/smoke-test.sh`.

---

## The bundle contract (reuse for EVERY lab)

A lab bundle is deployed purely from its `lab.yaml`; the Worker needs no
app-specific knowledge. Keep these conventions across labs:

- `lab.yaml` fields: `metadata` (id, name, version, difficulty, theme, shape,
  tags), `images[]` (name+context to build), `runtime.isolation`, `lifecycle`
  (deploy/ready/reset/destroy command lists with `{{cluster}}` / `{{registry}}`
  substitution), `objectives[]` (id, name, points, flag and/or state proof),
  `scoring` (checker path + invariants/poll commands + `stateVerified` list),
  `vulnerabilities[]` (documented inventory).
- **Isolation (non-negotiable):** one ephemeral kind cluster per session on its
  own Docker network; `controlPlaneReachable: false`; `internetEgress: false`;
  default-deny NetworkPolicies opening only the intra-cluster hops the chain
  needs; teardown = `kind delete cluster`. A learner reaching cluster-admin owns
  only a throwaway world.
- **Naming:** flags `LABNAME{...}`; `shape: linear|parallel`; only the intended
  web/API surface exposed via NodePort bound to loopback.
- **Scoring — two models, both wired:** flag-submission (control-plane compares a
  submitted string) for shallow objectives; **state-polling via `checker.ts`** for
  objectives that must be unfakeable.
- **Unfakeable cluster-admin proof pattern:** because an over-permissioned SA can
  often already *read* secrets, secret-read never proves admin. Require a *write*
  the foothold SA cannot do — create a gated ConfigMap in `kube-system`; the
  checker polls for it + matches the session id.

---

## Lab 1 — Meridian Bank (built)

Neobank: `web` (frontend) → `api` (gateway) → `ledger` (internal, ClusterIP) +
`postgres`. Chain: **SQLi/creds → BOLA drain → JWT forge or stored-XSS → admin →
SSRF into ledger → command-injection RCE → stolen SA token → cluster-admin.**
Multiple paths at each boundary.

**App vulns (11):** SQLi (`/api/login`), BOLA/IDOR (`/api/accounts/:id`,
`/api/transfer`), JWT `alg:none`, weak/hardcoded HS256 secret, role trusted from
token, stored XSS (support→agent inbox), reflected XSS (`/search`), SSRF
(`/api/webhooks/test`), info disclosure (ledger `/internal/config`), OS command
injection (ledger `/internal/report`), plaintext creds + verbose SQL errors.

**K8s misconfigs (8):** over-permissioned `ledger-sa` (cluster-wide `secrets
get/list`, `pods create/exec`, **`serviceaccounts/token create`** = TokenRequest
abuse, `nodes list`); `automountServiceAccountToken: true`; secrets as plaintext
env; shared cluster-readable Secret; containers run as root, no securityContext;
no Pod Security admission; cluster-scoped RBAC where namespaced would do; no
resource limits.

**Bundle layout:**
```
meridian-lab/
├── lab.yaml, README.md, docker-compose.yml   # compose = app-tier smoke only
├── app/{web,api,ledger}/                      # Node services + Dockerfiles
├── chart/                                     # Helm: the full lab incl K8s vulns
│   ├── templates/{00-base,10-rbac,20-networkpolicy,30-postgres,40-apps}.yaml
│   └── files/seed.sql
├── attack/WALKTHROUGH.md                      # instructor solution guide
└── orchestrator/
    ├── INTEGRATION.md      # isolation model + Worker lifecycle + TS glue
    ├── checker.ts          # invariants (CI/deploy gate) + progress (scoring)
    ├── smoke-test.sh       # kind-based end-to-end smoke (source of truth)
    ├── kind-config.yaml    # loopback-bound, per-session cluster
    └── gitlab-ci.snippet.yml
└── .github/workflows/lab-smoke.yml            # CI wrapper around smoke-test.sh
```

`checker.ts`: `invariants` asserts the lab is *correctly vulnerable* (RBAC lets
ledger-sa read secrets / create pods / mint tokens; app reachable; SQLi actually
works) — CI/deploy gate. `progress --session <id>` state-polls `bola` (reads
account 1003 balance from Postgres) and `cluster-admin` (the gated ConfigMap).

---

## Lab 2 — Bazaar (sketch only)

Multi-tenant marketplace, **three independent footholds, any one wins**,
converging on one crown jewel (the `payments` API-keys Secret) + cluster-admin.
- **Path A · AppSec:** SSTI in seller store-theme render → RCE.
- **Path B · Cloud/supply-chain:** public MinIO bucket leaks a CI deploy token →
  push poisoned image to an unauth internal registry a Deployment auto-pulls.
- **Path C · API/authz:** GraphQL introspection + mass assignment (`role:admin`
  on own profile) → platform-admin → internal diagnostics SSRF. (Different authz
  axis than lab 1's BOLA — field tampering, not object ownership.)

Completion rule: `count(foothold-*) >= 1 AND crown-jewel`; all three paths =
mastery bonus. `bazaar-lab/lab.yaml` (skeleton) + `LAB2-DESIGN.md` (topology,
per-path vuln + K8s misconfig inventory, build order) exist; **no service code
yet.**

---

## Suggested next steps (pick up here)

1. **Live-validate lab 1:** run `bash meridian-lab/orchestrator/smoke-test.sh`
   (needs docker/kind/kubectl/helm/node18/jq) or push to trigger the CI job; fix
   anything the first real deploy surfaces.
2. **Wire scoring into the control plane:** Worker runs `checker.ts invariants`
   post-deploy (gate) and `progress` on a poll loop → store per-session results in
   Mongo; emit NetworkPolicy-denial / kube-audit events to Elasticsearch for the
   "detection" box.
3. **Start building lab 2:** crown jewel + shared RBAC/NetworkPolicy first, then
   Path C (fastest, exercises convergence + checker end-to-end), then A, then B.
   Extend `checker.ts` with 3 per-path invariants + 2 progress proofs.
4. **Platform-level:** decide TTL/auto-destroy, per-session NodePort/proxy
   binding, and CPU/mem caps in kind config (defense-in-depth already sketched in
   INTEGRATION.md).

## Guardrails to keep in mind
Intentionally vulnerable targets; isolation is what makes "own the cluster" safe.
Keep labs offline + disposable, expose only the intended surface on loopback, set
a session TTL, never mount host paths or the Docker socket into lab pods.
