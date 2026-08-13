import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
const firebaseConfig = {
  apiKey: "AIzaSyDqdpAchewxlYmGrhFb5WyJKqbL5UP2XsA",
  authDomain: "tikfinity-overlay.firebaseapp.com",
  databaseURL: "https://tikfinity-overlay-default-rtdb.firebaseio.com",
  projectId: "tikfinity-overlay",
  storageBucket: "tikfinity-overlay.firebasestorage.app",
  messagingSenderId: "943639302610",
  appId: "1:943639302610:web:5e747094f2f6151b70380b"
};
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
export { database, ref, set, get, onValue };
