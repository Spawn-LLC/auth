# Releasing @spawn-llc/auth

Publishing is **tag-triggered** (mirrors `@spawn-llc/design-system`). Pushing commits never
publishes — only a `vX.Y.Z` tag does.

## One-time setup

Add an `NPM_TOKEN` GitHub Actions secret to this repo — an npm **Automation** token for a member of
the `@spawn-llc` npm org (npmjs.com → Access Tokens → Generate → Automation). If it's an org-level
secret, the repo inherits it.

```bash
gh secret set NPM_TOKEN --repo Spawn-LLC/auth   # paste the token when prompted
```

## Cut a release

From a clean `main`:

```bash
pnpm run release          # patch
pnpm run release:minor
pnpm run release:major
```

That bumps `package.json`, commits, and pushes the matching `vX.Y.Z` tag, which triggers
`.github/workflows/publish.yml` → typecheck → build → `pnpm publish --access public`. The published
version comes from the tag.
