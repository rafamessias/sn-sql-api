# ServiceNow JDBC · Python Container Setup Guide

Interactive step-by-step guide to configure a ServiceNow JDBC driver inside a Python Docker container. Supports **English** and **Portuguese (PT-BR)**.

🔗 **Live page:** `https://<your-github-username>.github.io/<your-repo-name>/`

---

## Deploy to GitHub Pages in 3 steps

### Step 1 — Create the repository

Go to [github.com/new](https://github.com/new) and create a new **public** repository.
Name it anything, e.g. `sn-jdbc-setup`.

> GitHub Pages requires the repository to be **public** on the free plan.

### Step 2 — Push this folder

```bash
# Inside this folder (where index.html and README.md are):
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

### Step 3 — Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to **Settings → Pages** (left sidebar).
3. Under **Source**, select **Deploy from a branch**.
4. Set branch to `main` and folder to `/ (root)`.
5. Click **Save**.

GitHub will show a green banner with the URL within ~60 seconds:
`https://<your-username>.github.io/<your-repo-name>/`

---

## Updating the page

Edit `index.html`, then push:

```bash
git add index.html
git commit -m "Update guide"
git push
```

GitHub Pages redeploys automatically on every push to `main`. Changes are live within ~30 seconds.

---

## Repository structure

```
.
├── index.html   ← the entire guide (self-contained, no dependencies)
└── README.md    ← this file
```

The guide is a single self-contained HTML file with no external dependencies beyond Google Fonts (loaded from CDN). It works offline too — fonts will fall back to system fonts.
