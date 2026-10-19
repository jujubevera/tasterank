# Setting up TasteRank for real

TasteRank works straight away in **demo mode**: ratings are sample data and anything you do stays on your own device. To make it real (shared ratings, real Google sign-in, feedback by email, visitor stats), create four free accounts and paste one key from each into the `CONFIG` block near the top of the script in `index.html`.

None of these keys is a password. They're designed to sit in a public web page. **The one thing never to paste anywhere is Supabase's `secret` / `service_role` key.**

| Step | Service | What it does | Time |
|---|---|---|---|
| 1 | GitHub Pages | Hosts the website | 5 min |
| 2 | Supabase | Shared database and sign-in | 10 min |
| 3 | Google Cloud | The "Continue with Google" button | 15 min |
| 4 | Web3Forms | Emails you the feedback (your address stays private) | 2 min |
| 5 | GoatCounter | Visitor statistics without cookies | 3 min |

---

## 0. Try it on your Mac first

Double-clicking `index.html` works for demo mode. To test real sign-in on your Mac, you need a small local web server (Google sign-in doesn't work from a file). In Terminal:

```
cd ~/Projects/tasterank
python3 -m http.server 8000
```

Then open http://localhost:8000. Press `Ctrl + C` in Terminal to stop the server.

## 1. Put the site online (GitHub Pages)

1. Upload the project to GitHub (this creates a public repo):
   ```
   cd ~/Projects/tasterank
   gh repo create tasterank --public --source=. --push
   ```
2. On github.com, open the **tasterank** repo → **Settings** → **Pages**. Under "Branch" pick **main** and **/(root)**, then **Save**.
3. After a minute or two the site is live at **https://jujubevera.github.io/tasterank/**.

## 2. Database and accounts (Supabase)

1. Go to [supabase.com](https://supabase.com), sign up (you can use your GitHub account) and click **New project**.
   - Name: `tasterank`. Region: **London** (closest to you and your testers).
   - It asks for a database password: let it generate one and save it in your password manager. The website doesn't need it.
2. Once it's ready, open **SQL Editor** → **New query**. Paste in everything from `supabase/setup.sql`, then press **Run**. You should see "Success". This creates the tables, the security rules and the 22 starter foods.
3. Open **Project Settings** → **API Keys**. Copy:
   - the **Project URL** (looks like `https://abcdxyz.supabase.co`) into `SUPABASE_URL`
   - the **publishable** key (or, under "Legacy API keys", the **anon public** key) into `SUPABASE_ANON_KEY`
4. Open **Authentication** → **URL Configuration**:
   - **Site URL:** `https://jujubevera.github.io/tasterank/`
   - **Redirect URLs:** add `https://jujubevera.github.io/tasterank/` and `http://localhost:8000/`

## 3. "Continue with Google" (Google Cloud)

1. In Supabase, open **Authentication** → **Sign In / Providers** → **Google**. Keep this tab open: it shows a **Callback URL** (ending in `/auth/v1/callback`) that you'll need in a moment.
2. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project called `TasteRank`.
3. Open **Google Auth Platform** (also called "OAuth consent screen") → **Get started**:
   - App name `TasteRank`, your email as support email, audience **External**.
   - Under **Audience**, press **Publish app**. Otherwise only people you add by hand can sign in.
4. Open **Clients** → **Create client** → type **Web application**:
   - **Authorised JavaScript origins:** `https://jujubevera.github.io` and `http://localhost:8000`
   - **Authorised redirect URIs:** the Callback URL from step 1
   - Press **Create** and copy the **Client ID** and **Client secret**.
5. Back in Supabase's Google page: switch Google **on**, paste the Client ID and Client secret, then **Save**.

(Apple sign-in needs a paid Apple Developer account, $99 a year, so it's left out for now.)

## 4. Feedback to your email (Web3Forms)

1. Go to [web3forms.com](https://web3forms.com), enter your email address and click **Create Access Key**.
2. They email you a key. Paste it into `WEB3FORMS_KEY`.

Your email address is stored only in your Web3Forms account, never in the website. The key can only send messages *to* you. A "💬 Feedback" button appears on the site once the key is in.

## 5. Visitor statistics (GoatCounter)

1. Go to [goatcounter.com](https://www.goatcounter.com) and sign up. Choose the code `tasterank` (or similar).
2. Paste that code into `GOATCOUNTER_CODE`.
3. Your stats live at `https://tasterank.goatcounter.com`. Besides page views, it counts sign-ins, ratings, votes, submissions and feedback as events.

## 6. Publish your changes

Every time you change `index.html` (for example, after pasting the keys):

```
cd ~/Projects/tasterank
git add -A
git commit -m "Add service keys"
git push
```

`git add` picks up your changes, `commit` saves a snapshot with a note, and `push` uploads it. The live site updates within a couple of minutes.

## 7. Your own domain (optional)

1. Buy the domain (Cloudflare, Porkbun or Namecheap: about $10–15 a year).
2. GitHub repo → **Settings** → **Pages** → **Custom domain**: type it in and **Save**. GitHub shows the DNS records to add at the shop where you bought the domain. Once it works, tick **Enforce HTTPS**.
3. Add the new address everywhere the GitHub one appears:
   - Supabase **Site URL** and **Redirect URLs** (step 2.4)
   - Google **Authorised JavaScript origins** (step 3.4)

## Day to day

- **See ratings, new foods and category suggestions:** Supabase → **Table Editor**.
- **Remove a bad submission:** Table Editor → `items` → select the row → delete.
- **Feedback:** arrives in your email.
- **Visitors:** your GoatCounter dashboard.
