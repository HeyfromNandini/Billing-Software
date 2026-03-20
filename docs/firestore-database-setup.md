# Proper Firestore “database” setup for this project

Firestore does **not** use SQL tables. You **do not** create collections or fields by hand in the console for this app. The app writes one document; Firestore creates the path automatically on first write.

## What gets stored

| Location | Contents |
|----------|----------|
| Collection `billingAppData` | Single document |
| Document ID `main` | Fields: `companies`, `clients`, `bills` (arrays, same shape as the old `localStorage` export) |

After you run the app with a valid `.env.local`, open **Firestore → Data**. You should see `billingAppData` → `main` appear (or after your first save).

## Checklist (proper setup)

### 1. Firebase project

- [Firebase Console](https://console.firebase.google.com/) → your project exists.

### 2. Firestore API enabled

- **Build → Firestore Database** → **Create database** (if you have not).
- Choose a **location** (region) once; it cannot be changed later. Pick one close to your users.
- **Production mode** is fine if you immediately set rules (step 4). **Test mode** is OK for quick tries (rules expire; replace with real rules).

### 3. Web app config → `.env.local`

- **Project settings → Your apps → Web** → copy `firebaseConfig` into **six** lines in `.env.local` (see `.env.example`). **All six** `VITE_FIREBASE_*` variables must be non-empty or the app stays on `localStorage` only.
- Restart dev server after any change: `npm run dev`.

### 4. Security rules (required for “proper” setup)

**Development / single user (current sample in repo)**  
File [`firestore.rules`](../firestore.rules) allows read/write to `billingAppData/*`. Anyone with your client config could hit that path, so treat it as **dev-only**.

**Publish rules**

- **Option A – Console:** Firestore → **Rules** → paste the contents of `firestore.rules` → **Publish**.
- **Option B – CLI (keeps repo as source of truth):**
  1. Install tools: `npm install -g firebase-tools` (or use `npx firebase-tools`).
  2. `firebase login`
  3. In this project folder: `firebase use --add` and select your Firebase project (creates/updates `.firebaserc`).
  4. `firebase deploy --only firestore:rules`

[`firebase.json`](../firebase.json) tells the CLI where the rules file lives.

### 5. No indexes needed (for this app)

This project only reads/writes **one document by path**. You do **not** need to create composite indexes in the console for the current code.

### 6. Verify

1. Run the app with complete `.env.local`.
2. Change something (e.g. edit a bill).
3. Firestore → **Data** → `billingAppData` → `main` → fields update after ~450ms debounce.

## Production-oriented next step (not implemented in code yet)

For multiple users or real security:

1. Add **Firebase Authentication** (email, Google, etc.).
2. Change rules so each user can only access their own document, e.g. `billingAppData/{userId}` with `request.auth.uid`.
3. Update the app code to read/write that path instead of `main`.

Until then, keep the project and API keys private and use the open rules only for local/solo testing.
