import { initializeApp } from 'firebase/app';
import { indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { initializeFirestore, persistentLocalCache } from 'firebase/firestore';

// These values identify the project and ship with every client. Access is controlled by the
// database security rules, not by keeping them private.
export const firebaseConfig = {
  apiKey: 'AIzaSyAD0X3FtRMxyaCwiouqzES8En6_XwAmkcg',
  authDomain: 't-music-b8301.firebaseapp.com',
  databaseURL: 'https://t-music-b8301-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 't-music-b8301',
  storageBucket: 't-music-b8301.firebasestorage.app',
  messagingSenderId: '520412577442',
  appId: '1:520412577442:web:ae2d0a53998bf9506621fb',
};

export const firebaseApp = initializeApp(firebaseConfig);

// initializeAuth instead of getAuth: the default also loads popup sign-in code, which can't work here.
export const auth = initializeAuth(firebaseApp, { persistence: indexedDBLocalPersistence });

// The on-disk cache keeps changes made offline until they can be sent.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache(),
  ignoreUndefinedProperties: true,
});

export const rtdb = getDatabase(firebaseApp);
