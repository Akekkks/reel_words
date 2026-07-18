import { initializeApp } from 
"https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
getAuth,
createUserWithEmailAndPassword,
signInWithEmailAndPassword,
GoogleAuthProvider,
signInWithPopup
} from 
"https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
getFirestore,
doc,
setDoc
} from 
"https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


import { firebaseConfig } from "./firebase-config.js";


const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);


// EMAIL REGISTER

export async function registerUser(email,password){

const userCredential =
await createUserWithEmailAndPassword(
auth,
email,
password
);


const user = userCredential.user;


// create Firestore user profile

await setDoc(
doc(db,"users",user.uid),
{
email:user.email,
createdAt:new Date()
}
);


return user;

}


// EMAIL LOGIN

export async function loginUser(email,password){

const result =
await signInWithEmailAndPassword(
auth,
email,
password
);

return result.user;

}


// GOOGLE LOGIN

export async function googleLogin(){

const provider =
new GoogleAuthProvider();

const result =
await signInWithPopup(
auth,
provider
);

return result.user;

}
