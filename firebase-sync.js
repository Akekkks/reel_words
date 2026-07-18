// firebase-sync.js

import { app } from "./firebase-config.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";


import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const auth = getAuth(app);

const db = getFirestore(app);


const googleProvider = new GoogleAuthProvider();



window.ReelWordsCloud = {


enabled:true,


onAuthChange(callback){
  onAuthStateChanged(auth, callback);
},



async signInGoogle(){

  return signInWithPopup(
    auth,
    googleProvider
  );

},



async signUpEmail(email,password){

 return createUserWithEmailAndPassword(
    auth,
    email,
    password
 );

},



async signInEmail(email,password){

 return signInWithEmailAndPassword(
    auth,
    email,
    password
 );

},



async signOutUser(){

 return signOut(auth);

},



async syncStateToCloud(uid,state){

 await setDoc(
   doc(db,"users",uid),
   {
    state:state,
    updated:new Date()
   }
 );

},



async loadStateFromCloud(uid){

 const snap = await getDoc(
    doc(db,"users",uid)
 );


 if(snap.exists()){

   return snap.data().state;

 }


 return null;

},



async signInApple(){

 throw new Error(
  "Apple Sign-In is not configured yet."
 );

}


};
