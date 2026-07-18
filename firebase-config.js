// firebase-config.js
// Central place for your Firebase project credentials.
// These values are safe to ship to the client — Firebase Web API keys are
// not secret; access is controlled by your Firestore/Auth security rules,
// not by hiding this key. Still, keep this file separate so it's easy to
// swap per-environment (dev/staging/prod) without touching app logic.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyB1jpVnYCLHfXTZsnfI2fkID9vAK2c9a-o",
  authDomain: "reel-words.firebaseapp.com",
  projectId: "reel-words",
  storageBucket: "reel-words.firebasestorage.app",
  messagingSenderId: "709777327121",
  appId: "1:709777327121:web:5a099e68eb9de9df965db0",
  measurementId: "G-BTMSNGM8D4"
};

export const app = initializeApp(firebaseConfig);
