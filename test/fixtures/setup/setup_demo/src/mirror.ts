import { getFirestore, setDoc } from "firebase/firestore";

export function mirror(id: string, entry: { amount: number }) {
  const db = getFirestore();
  return setDoc(db, id, entry);
}
