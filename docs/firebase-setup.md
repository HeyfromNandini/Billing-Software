# Firebase (Firestore) for this app

The app stores all billing data in **one Firestore document**: `billingAppData/main` with fields `companies`, `clients`, and `bills` (same shape as the previous `localStorage` export).

## 1. Create a Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/) → **Add project**.
2. In **Build** → **Firestore Database** → **Create database**. Start in **test mode** for a quick try, or **production mode** and deploy the rules from `firestore.rules` (see below).

## 2. Register a web app

1. Project **Settings** (gear) → **Your apps** → **Web** (`</>`).
2. Copy the `firebaseConfig` object values into a **`.env.local`** file in the project root (see `.env.example`).

```bash
cp .env.example .env.local
```

Fill in every `VITE_FIREBASE_*` variable. Restart the dev server after changing env.

## 3. Rules (security)

`firestore.rules` in this repo allows **anyone** to read/write `billingAppData/*`. That is **only OK for private prototypes**.

Before real use:

- **Firebase Authentication** (e.g. sign-in with Google or email), and
- Rules that **restrict** reads/writes to `billingAppData/<uid>` for the signed-in user.

Example direction (not wired in this app yet):

```text
match /billingAppData/{docId} {
  allow read, write: if request.auth != null && docId == request.auth.uid;
}
```

You would then store data under `billingAppData/<userId>` instead of `main`.

## 4. Behaviour

- **All env vars set** → data loads from Firestore and syncs after edits (debounced ~450ms). First run uploads existing local `localStorage` data if the Firestore doc is empty.
- **Any var missing** → behaviour unchanged: **localStorage only** (`billing-app-data` key).

## 5. Deploy rules (optional)

With Firebase CLI: `firebase deploy --only firestore:rules` after linking the project.
