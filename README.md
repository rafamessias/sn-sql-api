# ServiceNow JDBC · Python Container Setup Guide

Interactive step-by-step guide to configure a ServiceNow JDBC driver inside a Python Docker container.
Supports **English 🇺🇸** and **Portuguese PT-BR 🇧🇷**.

🔗 **Live page:** `https://<your-github-username>.github.io/<your-repo-name>/`

---

## Features

- 8-step wizard with progress tracking
- Live config panel — instance name, username, JAR path update all code snippets in real time
- **`.env` generator** — enter your password, preview the file, then download it with one click
- One-click copy on every code block
- Interactive prerequisites checklist
- Troubleshooting accordion (5 common errors)
- Full EN / PT-BR language toggle

---

## Deploy to GitHub Pages in 3 steps

### Step 1 — Create the repository

Go to [github.com/new](https://github.com/new) and create a new **public** repository.
Name it anything, e.g. `sn-jdbc-setup`.

> GitHub Pages requires the repository to be **public** on the free plan.

### Step 2 — Push this folder

```bash
# Inside this folder:
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

Your page will be live at `https://<your-username>.github.io/<your-repo-name>/` within ~60 seconds.

---

## Credentials and the .env file

The guide generates a `.env` file from the config panel on the left sidebar.

**Workflow for developers:**

```bash
# 1. Copy the safe template
cp .env.example .env

# 2. Fill in your real password
nano .env

# 3. Run the container
docker run --env-file .env sn-jdbc-app
```

> `.env` is in `.gitignore` and will never be committed.
> `.env.example` IS committed — it documents required variables without exposing values.

---

## Updating the page

Edit `index.html`, commit, and push. GitHub Pages redeploys automatically within ~30 seconds.

---

## Repository structure

```
.
├── index.html          ← full interactive guide (self-contained)
├── favicon.svg         ← modern browsers
├── favicon.ico         ← legacy browsers (16×16, 32×32, 48×48)
├── favicon-192.png     ← Apple touch icon
├── .env.example        ← safe credentials template (committed)
├── .gitignore          ← protects .env and drivers/ from being committed
└── README.md           ← this file
```

> `drivers/` and `.env` are both in `.gitignore`.
> Each developer downloads the JAR from their own ServiceNow instance.
