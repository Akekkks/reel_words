// firebase-config.js

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
