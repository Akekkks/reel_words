<script type="module">
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyB1jpVnYCLHfXTZsnfI2fkID9vAK2c9a-o",
    authDomain: "reel-words.firebaseapp.com",
    projectId: "reel-words",
    storageBucket: "reel-words.firebasestorage.app",
    messagingSenderId: "709777327121",
    appId: "1:709777327121:web:5a099e68eb9de9df965db0",
    measurementId: "G-BTMSNGM8D4"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);
</script>
